import { Prisma, LedgerTxnType } from "@prisma/client";
import type { Tx } from "@velocare/core/lib/db";
import { D, qty, money, gt, gte, ZERO } from "@velocare/core/lib/money";
import { enqueue } from "@velocare/core/server/sync/outbox";

/**
 * ────────────────────────────────────────────────────────────────
 *  STOCK SERVICE — the foundation every other module writes through
 * ────────────────────────────────────────────────────────────────
 *
 *  Contract, in full:
 *
 *  1. NOTHING outside this file writes stock_ledger or stock_balances.
 *     Not the sale service, not GRN, not a migration script. If you
 *     need a movement, call applyMovements().
 *
 *  2. Every function here takes a transaction client `tx`. Stock
 *     movement is never allowed to commit independently of the
 *     document that caused it — a bill that saved while its stock
 *     deduction failed is worse than a bill that failed outright.
 *
 *  3. Ledger rows are immutable. To reverse a movement, append the
 *     opposite movement. Never UPDATE, never DELETE.
 *
 *  4. StockBalance is a cache. If it ever disagrees with the ledger,
 *     the ledger is right — run scripts/rebuild-stock-balance.ts.
 *
 *  5. OFFLINE: a decrement may only be written by the node that owns
 *     the store (Store.owningNodeId). Enforced in assertCanDecrement().
 *     This single rule is what stops offline merges producing
 *     negative stock. See docs/ARCHITECTURE.md §2.
 */

// ──────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────

export interface Movement {
  storeId: string;
  itemId: string;
  batchId: string;
  txnType: LedgerTxnType;
  /** Positive quantity. Direction is derived from txnType. */
  quantity: Prisma.Decimal | string | number;
  /** Valuation rate at movement time. */
  rate: Prisma.Decimal | string | number;
  refType: "GRN" | "SALE" | "SALE_RETURN" | "PURCHASE_RETURN" | "INDENT" | "ADJUSTMENT" | "OPENING";
  refId: string;
  refNo: string;
  remarks?: string;
}

export interface FefoAllocation {
  batchId: string;
  batchNo: string;
  expiryDate: Date;
  quantity: Prisma.Decimal;
  mrp: Prisma.Decimal;
  saleRate: Prisma.Decimal;
  purchaseRate: Prisma.Decimal;
}

export interface StockContext {
  hospitalId: string;
  userId: string;
  /** Null in pure-cloud mode. */
  nodeId: string | null;
}

/**
 * Movement types that REDUCE stock in the named store.
 *
 * WARD_RETURN belongs here: it is stock LEAVING the ward. The
 * matching increase at the main store is a separate INDENT_RECEIPT
 * row, because a transfer is always two movements in two stores,
 * never one row with a sign.
 */
const OUTWARD: ReadonlySet<LedgerTxnType> = new Set<LedgerTxnType>([
  LedgerTxnType.SALE,
  LedgerTxnType.PURCHASE_RETURN,
  LedgerTxnType.INDENT_ISSUE,
  LedgerTxnType.WARD_RETURN,
  LedgerTxnType.EXPIRY_WRITE_OFF,
  LedgerTxnType.BREAKAGE,
  LedgerTxnType.ADJUSTMENT_OUT,
]);

export const isOutward = (t: LedgerTxnType) => OUTWARD.has(t);

export class InsufficientStockError extends Error {
  constructor(
    readonly itemId: string,
    readonly storeId: string,
    readonly requested: Prisma.Decimal,
    readonly available: Prisma.Decimal,
  ) {
    super(
      `Insufficient stock for item ${itemId} in store ${storeId}: ` +
        `requested ${requested.toFixed(3)}, available ${available.toFixed(3)}`,
    );
    this.name = "InsufficientStockError";
  }
}

export class StoreOwnershipError extends Error {
  constructor(storeId: string, ownerNodeId: string | null, actingNodeId: string | null) {
    super(
      `Store ${storeId} is owned by node ${ownerNodeId ?? "CLOUD"} — ` +
        `node ${actingNodeId ?? "CLOUD"} may not decrement its stock. ` +
        `Move goods with an Indent instead.`,
    );
    this.name = "StoreOwnershipError";
  }
}

// ──────────────────────────────────────────────────────────────
//  Ownership guard
// ──────────────────────────────────────────────────────────────

/**
 * A store's stock may only be decremented by its owning node.
 * Increments are always safe (append-only, converges by union),
 * so only outward movements are checked.
 */
export async function assertCanDecrement(
  tx: Tx,
  ctx: StockContext,
  storeId: string,
): Promise<void> {
  const store = await tx.store.findFirst({
    where: { id: storeId, hospitalId: ctx.hospitalId },
    select: { owningNodeId: true, isActive: true, deletedAt: true },
  });

  if (!store || store.deletedAt || !store.isActive) {
    throw new Error(`Store ${storeId} is not an active store of this hospital.`);
  }

  // Cloud-owned store (owningNodeId null) is writable by the cloud node only.
  const owner = store.owningNodeId;
  const acting = ctx.nodeId;

  if (owner === null && acting === null) return; // pure cloud mode
  if (owner === acting) return;

  throw new StoreOwnershipError(storeId, owner, acting);
}

// ──────────────────────────────────────────────────────────────
//  FEFO allocation
// ──────────────────────────────────────────────────────────────

/**
 * First-Expiry-First-Out batch picking.
 *
 * Takes a row-level lock (`FOR UPDATE OF sb`) on the candidate
 * balance rows for the life of the transaction. Without this lock,
 * two counters billing the same item at the same moment both read
 * the same available quantity and both succeed — the classic
 * oversell. The lock serialises them; the second one either takes
 * the next batch or fails cleanly.
 *
 * Ordering: earliest expiry first, then smallest quantity first so
 * part-used batches are cleared rather than left as dust.
 *
 * @param minShelfLifeDays refuse batches expiring sooner than this.
 *        Ward issue typically demands more shelf life than a
 *        counter sale, so callers pass their own value.
 */
export async function allocateFefo(
  tx: Tx,
  ctx: StockContext,
  params: {
    storeId: string;
    itemId: string;
    quantity: Prisma.Decimal | string | number;
    asOf?: Date;
    minShelfLifeDays?: number;
    /** Force a specific batch (pharmacist override). Still lock-checked. */
    preferBatchId?: string;
  },
): Promise<FefoAllocation[]> {
  const want = qty(params.quantity);
  if (!gt(want, 0)) throw new Error("allocateFefo: quantity must be > 0");

  const asOf = params.asOf ?? new Date();
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() + (params.minShelfLifeDays ?? 0));

  const rows = await tx.$queryRaw<
    Array<{
      batchId: string;
      batchNo: string;
      expiryDate: Date;
      available: Prisma.Decimal;
      mrp: Prisma.Decimal;
      saleRate: Prisma.Decimal;
      purchaseRate: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT
      sb."batchId"                        AS "batchId",
      b."batchNo"                         AS "batchNo",
      b."expiryDate"                      AS "expiryDate",
      (sb."quantity" - sb."reserved")     AS "available",
      b."mrp"                             AS "mrp",
      b."saleRate"                        AS "saleRate",
      b."purchaseRate"                    AS "purchaseRate"
    FROM "stock_balances" sb
    JOIN "batches" b ON b."id" = sb."batchId"
    WHERE sb."hospitalId" = ${ctx.hospitalId}
      AND sb."storeId"    = ${params.storeId}
      AND sb."itemId"     = ${params.itemId}
      AND (sb."quantity" - sb."reserved") > 0
      AND b."expiryDate" > ${cutoff}
    ORDER BY
      CASE WHEN sb."batchId" = ${params.preferBatchId ?? ""} THEN 0 ELSE 1 END,
      b."expiryDate" ASC,
      (sb."quantity" - sb."reserved") ASC
    FOR UPDATE OF sb
  `);

  const out: FefoAllocation[] = [];
  let remaining = want;

  for (const r of rows) {
    if (!gt(remaining, 0)) break;
    const take = qty(Prisma.Decimal.min(D(r.available), remaining));
    if (!gt(take, 0)) continue;

    out.push({
      batchId: r.batchId,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate,
      quantity: take,
      mrp: money(r.mrp),
      saleRate: money(r.saleRate),
      purchaseRate: money(r.purchaseRate),
    });
    remaining = qty(remaining.minus(take));
  }

  if (gt(remaining, 0)) {
    const available = qty(want.minus(remaining));
    throw new InsufficientStockError(params.itemId, params.storeId, want, available);
  }

  return out;
}

// ──────────────────────────────────────────────────────────────
//  Movement application
// ──────────────────────────────────────────────────────────────

/**
 * Append ledger rows and refresh the balance cache, atomically.
 *
 * This is the ONLY writer of stock_ledger and stock_balances.
 * Balance is updated with a guarded conditional UPDATE so a
 * concurrent transaction cannot drive quantity negative even if
 * an upstream caller skipped allocateFefo().
 */
export async function applyMovements(
  tx: Tx,
  ctx: StockContext,
  movements: Movement[],
): Promise<void> {
  if (movements.length === 0) return;

  // Ownership is checked once per distinct store, not per line.
  const outwardStores = new Set(
    movements.filter((m) => isOutward(m.txnType)).map((m) => m.storeId),
  );
  for (const storeId of outwardStores) {
    await assertCanDecrement(tx, ctx, storeId);
  }

  for (const m of movements) {
    const q = qty(m.quantity);
    if (!gt(q, 0)) throw new Error("applyMovements: quantity must be > 0");

    const outward = isOutward(m.txnType);
    const qtyIn = outward ? ZERO : q;
    const qtyOut = outward ? q : ZERO;

    // 1. Immutable ledger row — the source of truth.
    const ledger = await tx.stockLedger.create({
      data: {
        hospitalId: ctx.hospitalId,
        storeId: m.storeId,
        itemId: m.itemId,
        batchId: m.batchId,
        txnType: m.txnType,
        qtyIn,
        qtyOut,
        rate: money(m.rate),
        refType: m.refType,
        refId: m.refId,
        refNo: m.refNo,
        remarks: m.remarks,
        createdBy: ctx.userId,
        originNodeId: ctx.nodeId,
      },
    });

    // 2. Balance cache.
    if (outward) {
      // Guarded: the WHERE clause makes overselling impossible even
      // under a race, because the row is already locked by the
      // FEFO SELECT ... FOR UPDATE in the same transaction.
      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE "stock_balances"
        SET "quantity" = "quantity" - ${q}, "updatedAt" = NOW()
        WHERE "storeId" = ${m.storeId}
          AND "batchId" = ${m.batchId}
          AND "quantity" >= ${q}
      `);

      if (updated === 0) {
        const bal = await tx.stockBalance.findUnique({
          where: { storeId_batchId: { storeId: m.storeId, batchId: m.batchId } },
          select: { quantity: true },
        });
        throw new InsufficientStockError(
          m.itemId,
          m.storeId,
          q,
          bal ? qty(bal.quantity) : ZERO,
        );
      }
    } else {
      await tx.stockBalance.upsert({
        where: { storeId_batchId: { storeId: m.storeId, batchId: m.batchId } },
        create: {
          hospitalId: ctx.hospitalId,
          storeId: m.storeId,
          itemId: m.itemId,
          batchId: m.batchId,
          quantity: q,
        },
        update: { quantity: { increment: q } },
      });
    }

    // 3. Sync outbox — same transaction, so it can never diverge
    //    from the movement it describes.
    await enqueue(tx, ctx, {
      entity: "StockLedger",
      entityId: ledger.id,
      op: "LEDGER_APPEND",
      payload: ledger as unknown as Prisma.InputJsonValue,
    });
  }
}

// ──────────────────────────────────────────────────────────────
//  Reservation (in-progress bill / approved-but-unissued indent)
// ──────────────────────────────────────────────────────────────

export async function reserve(
  tx: Tx,
  ctx: StockContext,
  items: Array<{ storeId: string; batchId: string; quantity: Prisma.Decimal | number | string }>,
): Promise<void> {
  for (const i of items) {
    const q = qty(i.quantity);
    const n = await tx.$executeRaw(Prisma.sql`
      UPDATE "stock_balances"
      SET "reserved" = "reserved" + ${q}, "updatedAt" = NOW()
      WHERE "storeId" = ${i.storeId}
        AND "batchId" = ${i.batchId}
        AND ("quantity" - "reserved") >= ${q}
    `);
    if (n === 0) {
      throw new Error(
        `Cannot reserve ${q.toFixed(3)} of batch ${i.batchId} in store ${i.storeId} — not available.`,
      );
    }
  }
}

export async function release(
  tx: Tx,
  _ctx: StockContext,
  items: Array<{ storeId: string; batchId: string; quantity: Prisma.Decimal | number | string }>,
): Promise<void> {
  for (const i of items) {
    const q = qty(i.quantity);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "stock_balances"
      SET "reserved" = GREATEST("reserved" - ${q}, 0), "updatedAt" = NOW()
      WHERE "storeId" = ${i.storeId} AND "batchId" = ${i.batchId}
    `);
  }
}

// ──────────────────────────────────────────────────────────────
//  Queries
// ──────────────────────────────────────────────────────────────

export async function getAvailable(
  tx: Tx,
  ctx: StockContext,
  params: { storeId: string; itemId: string },
): Promise<Prisma.Decimal> {
  const r = await tx.stockBalance.aggregate({
    where: { hospitalId: ctx.hospitalId, storeId: params.storeId, itemId: params.itemId },
    _sum: { quantity: true, reserved: true },
  });
  return qty(D(r._sum.quantity ?? 0).minus(D(r._sum.reserved ?? 0)));
}

/**
 * Drug recall: every patient who received a given batch.
 * This is the question a drug inspector actually asks, and the
 * reason stock is a ledger rather than a column.
 */
export async function traceBatch(
  tx: Tx,
  ctx: StockContext,
  batchId: string,
): Promise<
  Array<{
    billNo: string;
    billDate: Date;
    patientName: string | null;
    patientPhone: string | null;
    quantity: Prisma.Decimal;
    store: string;
    isCancelled: boolean;
  }>
> {
  // Cancelled bills are INCLUDED, flagged rather than filtered. During
  // a recall you need to know a cancelled bill existed — the goods may
  // still have physically left the counter before it was voided.
  return tx.$queryRaw(Prisma.sql`
    SELECT
      s."billNo"        AS "billNo",
      s."billDate"      AS "billDate",
      COALESCE(p."name",  s."customerName")  AS "patientName",
      COALESCE(p."phone", s."customerPhone") AS "patientPhone",
      sl."qty"          AS "quantity",
      st."code"         AS "store",
      s."isCancelled"   AS "isCancelled"
    FROM "sale_lines" sl
    JOIN "sales" s     ON s."id" = sl."saleId"
    JOIN "stores" st   ON st."id" = s."storeId"
    LEFT JOIN "patients" p ON p."id" = s."patientId"
    WHERE sl."batchId" = ${batchId}
      AND s."hospitalId" = ${ctx.hospitalId}
    ORDER BY s."billDate" DESC
  `);
}

/**
 * Rebuild the balance cache from the ledger. Safe to run any time;
 * this is the disaster-recovery path and the post-sync-merge path.
 */
export async function rebuildBalances(
  tx: Tx,
  hospitalId: string,
  storeId?: string,
): Promise<number> {
  const scope = storeId ? Prisma.sql`AND "storeId" = ${storeId}` : Prisma.empty;

  return tx.$executeRaw(Prisma.sql`
    WITH computed AS (
      SELECT "hospitalId", "storeId", "itemId", "batchId",
             SUM("qtyIn" - "qtyOut") AS qty
      FROM "stock_ledger"
      WHERE "hospitalId" = ${hospitalId} ${scope}
      GROUP BY 1, 2, 3, 4
    )
    INSERT INTO "stock_balances"
      ("id", "hospitalId", "storeId", "itemId", "batchId", "quantity", "reserved", "updatedAt")
    SELECT
      md5(c."storeId" || c."batchId"), c."hospitalId", c."storeId",
      c."itemId", c."batchId", c.qty, 0, NOW()
    FROM computed c
    ON CONFLICT ("storeId", "batchId")
    DO UPDATE SET "quantity" = EXCLUDED."quantity", "updatedAt" = NOW()
  `);
}
