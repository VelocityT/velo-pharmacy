import { Prisma, LedgerTxnType, IndentStatus } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { D, qty, gt, ZERO } from "@velocare/core/lib/money";
import { allocateFefo, applyMovements, type StockContext } from "./stock.service";
import { nextDocNumber } from "./sequence.service";
import { enqueue } from "@velocare/core/server/sync/outbox";

/**
 * ────────────────────────────────────────────────────────────────
 *  INDENT — ward requests stock from the main store
 * ────────────────────────────────────────────────────────────────
 *
 *  This is the module that makes the product a hospital pharmacy
 *  rather than a Marg clone. Marg has no concept of a ward asking
 *  the main store for drugs, an authorised person approving a
 *  reduced quantity, goods travelling, and the ward acknowledging
 *  receipt — so hospitals using retail software end up running
 *  ward supply on a paper register beside the computer.
 *
 *  DRAFT → SUBMITTED → APPROVED → ISSUED → RECEIVED
 *
 *  Two-phase transfer, and the reason for it: goods in transit
 *  belong to neither store. Issuing decrements the main store;
 *  receiving increments the ward. Between the two, the quantity is
 *  visible as in-transit and someone is accountable for it. A
 *  single-step transfer hides trolley losses forever.
 *
 *  Batches are chosen at ISSUE time by FEFO, never at request time —
 *  the ward asks for "20 Paracetamol", not for a batch number.
 */

export class IndentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndentError";
  }
}

export interface CreateIndentInput {
  fromStoreId: string;
  toStoreId: string;
  isEmergency?: boolean;
  remarks?: string;
  lines: Array<{ itemId: string; qtyRequested: number | string }>;
  clientUuid?: string;
}

export async function createIndent(ctx: StockContext, input: CreateIndentInput) {
  if (input.fromStoreId === input.toStoreId) {
    throw new IndentError("An indent cannot be raised against the same store.");
  }
  if (!input.lines.length) throw new IndentError("An indent must have at least one line.");

  return prisma.$transaction(async (tx) => {
    const hospital = await tx.hospital.findUniqueOrThrow({
      where: { id: ctx.hospitalId },
      select: { fyStartMonth: true },
    });

    const [from, to] = await Promise.all([
      tx.store.findFirstOrThrow({
        where: { id: input.fromStoreId, hospitalId: ctx.hospitalId },
        select: { id: true, code: true },
      }),
      tx.store.findFirstOrThrow({
        where: { id: input.toStoreId, hospitalId: ctx.hospitalId },
        select: { id: true, code: true },
      }),
    ]);

    const indentNo = await nextDocNumber(tx, {
      hospitalId: ctx.hospitalId,
      storeId: to.id,
      storeCode: to.code,
      docType: "INDENT",
      date: new Date(),
      fyStartMonth: hospital.fyStartMonth,
      nodeId: ctx.nodeId,
    });

    const indent = await tx.indent.create({
      data: {
        hospitalId: ctx.hospitalId,
        indentNo,
        indentDate: new Date(),
        status: IndentStatus.SUBMITTED,
        fromStoreId: from.id,
        toStoreId: to.id,
        isEmergency: input.isEmergency ?? false,
        remarks: input.remarks,
        requestedBy: ctx.userId,
        originNodeId: ctx.nodeId,
        clientUuid: input.clientUuid,
        lines: {
          createMany: {
            data: input.lines.map((l) => ({
              itemId: l.itemId,
              qtyRequested: qty(l.qtyRequested),
            })),
          },
        },
      },
      include: { lines: true },
    });

    await enqueue(tx, ctx, {
      entity: "Indent",
      entityId: indent.id,
      op: "UPSERT",
      payload: indent as unknown as Prisma.InputJsonValue,
    });

    return indent;
  });
}

/**
 * Approve, optionally cutting quantities. A store manager approving
 * less than was asked for is the normal case, not an exception —
 * wards habitually over-request.
 */
export async function approveIndent(
  ctx: StockContext,
  indentId: string,
  approvals: Array<{ lineId: string; qtyApproved: number | string }>,
) {
  return prisma.$transaction(async (tx) => {
    const indent = await tx.indent.findFirstOrThrow({
      where: { id: indentId, hospitalId: ctx.hospitalId },
      include: { lines: true },
    });

    if (indent.status !== IndentStatus.SUBMITTED) {
      throw new IndentError(`Indent ${indent.indentNo} is ${indent.status}, not SUBMITTED.`);
    }

    for (const a of approvals) {
      const line = indent.lines.find((l) => l.id === a.lineId);
      if (!line) throw new IndentError(`Line ${a.lineId} does not belong to this indent.`);

      const approved = qty(a.qtyApproved);
      if (approved.greaterThan(D(line.qtyRequested))) {
        throw new IndentError(
          `Cannot approve more than requested on line ${a.lineId} ` +
            `(${approved.toFixed(3)} > ${D(line.qtyRequested).toFixed(3)}).`,
        );
      }
      await tx.indentLine.update({
        where: { id: a.lineId },
        data: { qtyApproved: approved },
      });
    }

    const updated = await tx.indent.update({
      where: { id: indentId },
      data: {
        status: IndentStatus.APPROVED,
        approvedBy: ctx.userId,
        approvedAt: new Date(),
      },
      include: { lines: true },
    });

    await tx.auditLog.create({
      data: {
        hospitalId: ctx.hospitalId,
        userId: ctx.userId,
        action: "APPROVE",
        entityType: "Indent",
        entityId: indentId,
        newValue: { indentNo: indent.indentNo },
      },
    });

    return updated;
  });
}

/**
 * Phase 1 of the transfer: goods leave the supplying store.
 * FEFO picks the batches. Ward issue demands 90 days of shelf life
 * by default — a ward cannot return near-expiry stock in time, so
 * sending it there is how it gets written off.
 */
export async function issueIndent(
  ctx: StockContext,
  indentId: string,
  opts?: { minShelfLifeDays?: number },
) {
  return prisma.$transaction(
    async (tx) => {
      const indent = await tx.indent.findFirstOrThrow({
        where: { id: indentId, hospitalId: ctx.hospitalId },
        include: { lines: true },
      });

      if (indent.status !== IndentStatus.APPROVED && indent.status !== IndentStatus.PARTIALLY_ISSUED) {
        throw new IndentError(`Indent ${indent.indentNo} is ${indent.status} — cannot issue.`);
      }

      const movements: Parameters<typeof applyMovements>[2] = [];
      let anyPending = false;

      for (const line of indent.lines) {
        const pending = qty(D(line.qtyApproved).minus(D(line.qtyIssued)));
        if (!gt(pending, 0)) continue;

        const allocations = await allocateFefo(tx, ctx, {
          storeId: indent.fromStoreId,
          itemId: line.itemId,
          quantity: pending,
          minShelfLifeDays: opts?.minShelfLifeDays ?? 90,
        });

        for (const a of allocations) {
          await tx.indentIssueBatch.create({
            data: {
              indentLineId: line.id,
              batchId: a.batchId,
              qty: a.quantity,
              rate: a.purchaseRate,
            },
          });

          movements.push({
            storeId: indent.fromStoreId,
            itemId: line.itemId,
            batchId: a.batchId,
            txnType: LedgerTxnType.INDENT_ISSUE,
            quantity: a.quantity,
            rate: a.purchaseRate,
            refType: "INDENT",
            refId: indent.id,
            refNo: indent.indentNo,
          });
        }

        await tx.indentLine.update({
          where: { id: line.id },
          data: { qtyIssued: qty(D(line.qtyApproved)) },
        });
        anyPending = true;
      }

      if (!anyPending) throw new IndentError("Nothing left to issue on this indent.");

      await applyMovements(tx, ctx, movements);

      return tx.indent.update({
        where: { id: indentId },
        data: { status: IndentStatus.ISSUED, issuedBy: ctx.userId, issuedAt: new Date() },
        include: { lines: { include: { issues: true } } },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

/**
 * Phase 2: the ward acknowledges receipt and stock lands there.
 * Until this runs, the quantity is in transit and belongs to nobody —
 * which is exactly the visibility a hospital needs.
 */
export async function receiveIndent(ctx: StockContext, indentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const indent = await tx.indent.findFirstOrThrow({
        where: { id: indentId, hospitalId: ctx.hospitalId },
        include: { lines: { include: { issues: true } } },
      });

      if (indent.status !== IndentStatus.ISSUED) {
        throw new IndentError(`Indent ${indent.indentNo} is ${indent.status} — nothing to receive.`);
      }

      const movements: Parameters<typeof applyMovements>[2] = [];
      for (const line of indent.lines) {
        for (const iss of line.issues) {
          movements.push({
            storeId: indent.toStoreId,
            itemId: line.itemId,
            batchId: iss.batchId,
            txnType: LedgerTxnType.INDENT_RECEIPT,
            quantity: iss.qty,
            rate: iss.rate,
            refType: "INDENT",
            refId: indent.id,
            refNo: indent.indentNo,
          });
        }
      }

      await applyMovements(tx, ctx, movements);

      const updated = await tx.indent.update({
        where: { id: indentId },
        data: { status: IndentStatus.RECEIVED, receivedBy: ctx.userId, receivedAt: new Date() },
      });

      await enqueue(tx, ctx, {
        entity: "Indent",
        entityId: indentId,
        op: "UPSERT",
        payload: updated as unknown as Prisma.InputJsonValue,
      });

      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Unused ward stock going back to the main store. */
export async function returnToMain(
  ctx: StockContext,
  input: {
    fromStoreId: string;
    toStoreId: string;
    lines: Array<{ itemId: string; batchId: string; quantity: number | string; rate: number | string }>;
    remarks?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const refNo = `WRET/${Date.now()}`;

    await applyMovements(tx, ctx, [
      ...input.lines.map((l) => ({
        storeId: input.fromStoreId,
        itemId: l.itemId,
        batchId: l.batchId,
        txnType: LedgerTxnType.WARD_RETURN,
        quantity: l.quantity,
        rate: l.rate,
        refType: "INDENT" as const,
        refId: refNo,
        refNo,
        remarks: input.remarks,
      })),
    ]);

    await applyMovements(tx, ctx, [
      ...input.lines.map((l) => ({
        storeId: input.toStoreId,
        itemId: l.itemId,
        batchId: l.batchId,
        txnType: LedgerTxnType.INDENT_RECEIPT,
        quantity: l.quantity,
        rate: l.rate,
        refType: "INDENT" as const,
        refId: refNo,
        refNo,
        remarks: `Ward return: ${input.remarks ?? ""}`.trim(),
      })),
    ]);

    return { refNo, lines: input.lines.length };
  });
}
