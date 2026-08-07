import { Prisma } from "@prisma/client";
import type { Tx } from "@velocare/core/lib/db";
import { env } from "@velocare/core/lib/env";

/**
 * ────────────────────────────────────────────────────────────────
 *  DOCUMENT NUMBERING
 * ────────────────────────────────────────────────────────────────
 *
 *  The single most common bug in Indian billing software is two
 *  counters generating the same bill number. Two mechanisms here,
 *  one for each deployment mode:
 *
 *  ONLINE  → row-locked counter. SELECT ... FOR UPDATE on the
 *            DocumentSequence row inside the same transaction as
 *            the document insert. The lock releases on commit, so
 *            a concurrent counter simply waits its turn.
 *
 *  OFFLINE → pre-reserved block. The node claims a contiguous
 *            range (e.g. 2001–3000) while it still has a
 *            connection, then bills from that range with no
 *            coordination at all. Ranges never overlap, so numbers
 *            never collide.
 *
 *  Gaps in the series when a block is abandoned are legally fine
 *  under GST — the requirement is uniqueness and sequence WITHIN a
 *  series, and each counter is its own series. A gap is defensible
 *  to an officer. A duplicate is not.
 */

export type DocType = "SALE" | "SALE_RETURN" | "GRN" | "PURCHASE_RETURN" | "INDENT" | "PO" | "ADJ";

/** Indian FY label for a date, e.g. 2025-08-06 → "2025-26". */
export function fyOf(date: Date, fyStartMonth = 4): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() + 1 >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

const DEFAULT_PREFIX: Record<DocType, string> = {
  SALE: "INV",
  SALE_RETURN: "CRN",
  GRN: "GRN",
  PURCHASE_RETURN: "DRN",
  INDENT: "IND",
  PO: "PO",
  ADJ: "ADJ",
};

function format(prefix: string, fyYear: string, n: number, storeCode?: string): string {
  const short = fyYear.replace("-", "-");
  return storeCode
    ? `${prefix}/${short}/${storeCode}/${String(n).padStart(5, "0")}`
    : `${prefix}/${short}/${String(n).padStart(5, "0")}`;
}

// ──────────────────────────────────────────────────────────────
//  ONLINE: row-locked counter
// ──────────────────────────────────────────────────────────────

/**
 * MUST be called inside the same transaction as the document insert.
 * Calling it in its own transaction defeats the entire mechanism —
 * the lock would release before the document is written and a
 * concurrent caller could take the same number.
 */
export async function nextNumberLocked(
  tx: Tx,
  params: {
    hospitalId: string;
    storeId?: string | null;
    storeCode?: string;
    docType: DocType;
    date: Date;
    fyStartMonth?: number;
  },
): Promise<string> {
  const fyYear = fyOf(params.date, params.fyStartMonth ?? 4);
  const storeId = params.storeId ?? null;
  const prefix = DEFAULT_PREFIX[params.docType];

  // FOR UPDATE serialises concurrent callers on this exact row.
  const locked = await tx.$queryRaw<Array<{ id: string; lastNumber: number; prefix: string }>>(
    Prisma.sql`
      SELECT "id", "lastNumber", "prefix"
      FROM "document_sequences"
      WHERE "hospitalId" = ${params.hospitalId}
        AND "docType"    = ${params.docType}
        AND "fyYear"     = ${fyYear}
        AND "storeId" IS NOT DISTINCT FROM ${storeId}
      FOR UPDATE
    `,
  );

  if (locked.length === 0) {
    const created = await tx.documentSequence.create({
      data: {
        hospitalId: params.hospitalId,
        storeId,
        docType: params.docType,
        prefix,
        fyYear,
        lastNumber: 1,
      },
    });
    return format(created.prefix, fyYear, 1, params.storeCode);
  }

  const row = locked[0];
  const next = row.lastNumber + 1;

  await tx.$executeRaw(Prisma.sql`
    UPDATE "document_sequences"
    SET "lastNumber" = ${next}, "updatedAt" = NOW()
    WHERE "id" = ${row.id}
  `);

  return format(row.prefix, fyYear, next, params.storeCode);
}

// ──────────────────────────────────────────────────────────────
//  OFFLINE: pre-reserved block
// ──────────────────────────────────────────────────────────────

/**
 * Claim the next contiguous range for a node. Called while online.
 * Reserving 1000 numbers is roughly two weeks of billing for a busy
 * counter — comfortably more runway than any realistic outage.
 */
export async function reserveBlock(
  tx: Tx,
  params: {
    hospitalId: string;
    nodeId: string;
    storeId?: string | null;
    docType: DocType;
    date: Date;
    size?: number;
    fyStartMonth?: number;
  },
): Promise<{ rangeStart: number; rangeEnd: number; prefix: string; fyYear: string }> {
  const fyYear = fyOf(params.date, params.fyStartMonth ?? 4);
  const size = params.size ?? env.SEQUENCE_BLOCK_SIZE;
  const storeId = params.storeId ?? null;
  const prefix = DEFAULT_PREFIX[params.docType];

  // Lock the master counter so two nodes cannot reserve overlapping ranges.
  const seq = await tx.$queryRaw<Array<{ id: string; lastNumber: number }>>(Prisma.sql`
    SELECT "id", "lastNumber" FROM "document_sequences"
    WHERE "hospitalId" = ${params.hospitalId}
      AND "docType"    = ${params.docType}
      AND "fyYear"     = ${fyYear}
      AND "storeId" IS NOT DISTINCT FROM ${storeId}
    FOR UPDATE
  `);

  let start: number;
  if (seq.length === 0) {
    await tx.documentSequence.create({
      data: {
        hospitalId: params.hospitalId,
        storeId,
        docType: params.docType,
        prefix,
        fyYear,
        lastNumber: size,
      },
    });
    start = 1;
  } else {
    start = seq[0].lastNumber + 1;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "document_sequences" SET "lastNumber" = ${start + size - 1}, "updatedAt" = NOW()
      WHERE "id" = ${seq[0].id}
    `);
  }

  const rangeEnd = start + size - 1;

  await tx.sequenceBlock.create({
    data: {
      hospitalId: params.hospitalId,
      nodeId: params.nodeId,
      storeId,
      docType: params.docType,
      fyYear,
      prefix,
      rangeStart: start,
      rangeEnd,
      nextNumber: start,
    },
  });

  return { rangeStart: start, rangeEnd, prefix, fyYear };
}

/** Take the next number from this node's reserved block. Works offline. */
export async function nextNumberFromBlock(
  tx: Tx,
  params: {
    hospitalId: string;
    nodeId: string;
    storeId?: string | null;
    storeCode?: string;
    docType: DocType;
    date: Date;
    fyStartMonth?: number;
  },
): Promise<string> {
  const fyYear = fyOf(params.date, params.fyStartMonth ?? 4);

  const rows = await tx.$queryRaw<
    Array<{ id: string; nextNumber: number; rangeEnd: number; prefix: string }>
  >(Prisma.sql`
    SELECT "id", "nextNumber", "rangeEnd", "prefix"
    FROM "sequence_blocks"
    WHERE "hospitalId" = ${params.hospitalId}
      AND "nodeId"     = ${params.nodeId}
      AND "docType"    = ${params.docType}
      AND "fyYear"     = ${fyYear}
      AND "exhausted"  = FALSE
    ORDER BY "rangeStart" ASC
    LIMIT 1
    FOR UPDATE
  `);

  if (rows.length === 0) {
    throw new Error(
      `No document-number block reserved for node ${params.nodeId} (${params.docType}, ${fyYear}). ` +
        `Reconnect once so a block can be reserved before billing offline.`,
    );
  }

  const b = rows[0];
  const n = b.nextNumber;
  const exhausted = n >= b.rangeEnd;

  await tx.$executeRaw(Prisma.sql`
    UPDATE "sequence_blocks"
    SET "nextNumber" = ${n + 1}, "exhausted" = ${exhausted}, "updatedAt" = NOW()
    WHERE "id" = ${b.id}
  `);

  return format(b.prefix, fyYear, n, params.storeCode);
}

/**
 * Single entry point — picks the right mechanism for the mode.
 * Callers never decide this themselves.
 */
export async function nextDocNumber(
  tx: Tx,
  params: Parameters<typeof nextNumberLocked>[1] & { nodeId?: string | null },
): Promise<string> {
  if (env.NODE_MODE === "EDGE_COUNTER" && params.nodeId) {
    return nextNumberFromBlock(tx, { ...params, nodeId: params.nodeId });
  }
  return nextNumberLocked(tx, params);
}

/** Remaining capacity, so the UI can warn before a block runs dry. */
export async function blockHeadroom(
  tx: Tx,
  hospitalId: string,
  nodeId: string,
  docType: DocType,
  date: Date,
): Promise<{ remaining: number; shouldReserve: boolean }> {
  const fyYear = fyOf(date);
  const b = await tx.sequenceBlock.findFirst({
    where: { hospitalId, nodeId, docType, fyYear, exhausted: false },
    orderBy: { rangeStart: "asc" },
  });
  if (!b) return { remaining: 0, shouldReserve: true };
  const remaining = b.rangeEnd - b.nextNumber + 1;
  const size = b.rangeEnd - b.rangeStart + 1;
  return { remaining, shouldReserve: remaining < size * 0.15 };
}
