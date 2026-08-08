import { Prisma, LedgerTxnType, AdjustmentReason } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { D, money, qty, gt, lt } from "@velocare/core/lib/money";
import { applyMovements, type StockContext } from "./stock.service";
import { nextDocNumber } from "./sequence.service";

/**
 * ────────────────────────────────────────────────────────────────
 *  STOCK ADJUSTMENT
 * ────────────────────────────────────────────────────────────────
 *
 *  The controlled way to make the system agree with the shelf. Four
 *  situations, one mechanism:
 *
 *    EXPIRY         · write off what is past date
 *    BREAKAGE       · a dropped vial, a crushed strip
 *    THEFT          · shrinkage, found during count
 *    PHYSICAL_COUNT · reconcile to a stocktake
 *    RECALL         · quarantine a batch a manufacturer has recalled
 *
 *  Two rules that matter more than the mechanics:
 *
 *  1. An adjustment is DRAFT until someone approves it. Anyone able to
 *     silently write stock off is anyone able to steal — the approval
 *     step is the internal control, not a workflow nicety.
 *
 *  2. Adjustments post through applyMovements like everything else.
 *     There is no back door that writes a balance directly, so a
 *     write-off still leaves an immutable ledger row with a name
 *     against it.
 */

export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentError";
  }
}

export interface AdjustmentInput {
  storeId: string;
  reason: AdjustmentReason;
  remarks?: string;
  lines: Array<{
    itemId: string;
    batchId: string;
    /** What the shelf actually has. The difference against system stock is the movement. */
    actualQty: number | string;
  }>;
}

/** Create as DRAFT. Nothing moves until it is approved. */
export async function createAdjustment(ctx: StockContext, input: AdjustmentInput) {
  if (!input.lines.length) throw new AdjustmentError("Add at least one line.");

  return prisma.$transaction(async (tx) => {
    const hospital = await tx.hospital.findUniqueOrThrow({
      where: { id: ctx.hospitalId },
      select: { fyStartMonth: true },
    });

    const store = await tx.store.findFirstOrThrow({
      where: { id: input.storeId, hospitalId: ctx.hospitalId },
      select: { code: true },
    });

    const adjNo = await nextDocNumber(tx, {
      hospitalId: ctx.hospitalId,
      storeId: input.storeId,
      storeCode: store.code,
      docType: "ADJ",
      date: new Date(),
      fyStartMonth: hospital.fyStartMonth,
      nodeId: ctx.nodeId,
    });

    const lines: Prisma.StockAdjustmentLineCreateManyAdjInput[] = [];

    for (const l of input.lines) {
      const bal = await tx.stockBalance.findUnique({
        where: { storeId_batchId: { storeId: input.storeId, batchId: l.batchId } },
        select: { quantity: true },
      });
      const systemQty = qty(bal?.quantity ?? 0);
      const actualQty = qty(l.actualQty);
      const diffQty = qty(actualQty.minus(systemQty));

      // A line with no difference is noise on an audit document.
      if (diffQty.isZero()) continue;

      const batch = await tx.batch.findFirstOrThrow({
        where: { id: l.batchId, hospitalId: ctx.hospitalId },
        select: { purchaseRate: true },
      });

      lines.push({
        itemId: l.itemId,
        batchId: l.batchId,
        systemQty,
        actualQty,
        diffQty,
        rate: money(batch.purchaseRate),
      });
    }

    if (!lines.length) {
      throw new AdjustmentError("No differences found — system stock already matches the count.");
    }

    const adj = await tx.stockAdjustment.create({
      data: {
        hospitalId: ctx.hospitalId,
        adjNo,
        adjDate: new Date(),
        storeId: input.storeId,
        reason: input.reason,
        remarks: input.remarks,
        isPosted: false,
        createdBy: ctx.userId,
        lines: { createMany: { data: lines } },
      },
      include: { lines: true },
    });

    await tx.auditLog.create({
      data: {
        hospitalId: ctx.hospitalId,
        userId: ctx.userId,
        action: "CREATE",
        entityType: "StockAdjustment",
        entityId: adj.id,
        newValue: { adjNo, reason: input.reason, lines: lines.length },
      },
    });

    return adj;
  });
}

/**
 * Approve and post. This is where stock actually moves.
 *
 * The approver must be a different person from the creator — the whole
 * point of the control. Enforced here rather than only in the UI.
 */
export async function approveAdjustment(ctx: StockContext, adjId: string) {
  return prisma.$transaction(
    async (tx) => {
      const adj = await tx.stockAdjustment.findFirstOrThrow({
        where: { id: adjId, hospitalId: ctx.hospitalId },
        include: { lines: true },
      });

      if (adj.isPosted) throw new AdjustmentError("This adjustment is already posted.");
      if (adj.createdBy === ctx.userId) {
        throw new AdjustmentError(
          "An adjustment must be approved by someone other than the person who raised it.",
        );
      }

      const movements: Parameters<typeof applyMovements>[2] = [];

      for (const l of adj.lines) {
        const diff = qty(l.diffQty);
        if (diff.isZero()) continue;

        const increase = gt(diff, 0);

        // Direction of the write-off carries the reason. An expiry
        // write-off must be distinguishable from breakage in the
        // ledger, because they answer to different people.
        const txnType = increase
          ? LedgerTxnType.ADJUSTMENT_IN
          : adj.reason === "EXPIRY"
            ? LedgerTxnType.EXPIRY_WRITE_OFF
            : adj.reason === "BREAKAGE"
              ? LedgerTxnType.BREAKAGE
              : LedgerTxnType.ADJUSTMENT_OUT;

        movements.push({
          storeId: adj.storeId,
          itemId: l.itemId,
          batchId: l.batchId,
          txnType,
          quantity: diff.abs(),
          rate: l.rate,
          refType: "ADJUSTMENT",
          refId: adj.id,
          refNo: adj.adjNo,
          remarks: `${adj.reason}${adj.remarks ? `: ${adj.remarks}` : ""}`,
        });
      }

      await applyMovements(tx, ctx, movements);

      const posted = await tx.stockAdjustment.update({
        where: { id: adjId },
        data: {
          isPosted: true,
          approvedBy: ctx.userId,
          approvedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "POST",
          entityType: "StockAdjustment",
          entityId: adjId,
          newValue: {
            adjNo: adj.adjNo,
            reason: adj.reason,
            netUnits: adj.lines
              .reduce((a, l) => a.plus(D(l.diffQty)), D(0))
              .toFixed(3),
          },
        },
      });

      return posted;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

/**
 * Everything on the shelf at a store, for a physical count sheet.
 * Pre-filled with system quantity so the counter only types what
 * differs — typing 2,000 identical numbers is how counts get faked.
 */
export async function countSheet(hospitalId: string, storeId: string, expiredOnly = false) {
  return prisma.$queryRaw<
    Array<{
      itemId: string; itemName: string; itemCode: string;
      batchId: string; batchNo: string; expiryDate: Date;
      systemQty: Prisma.Decimal; rate: Prisma.Decimal; value: Prisma.Decimal;
      isExpired: boolean;
    }>
  >(Prisma.sql`
    SELECT i."id" AS "itemId", i."name" AS "itemName", i."code" AS "itemCode",
           b."id" AS "batchId", b."batchNo", b."expiryDate",
           sb."quantity" AS "systemQty",
           b."purchaseRate" AS rate,
           (sb."quantity" * b."purchaseRate") AS value,
           (b."expiryDate" < NOW()) AS "isExpired"
    FROM stock_balances sb
    JOIN batches b ON b."id" = sb."batchId"
    JOIN items i   ON i."id" = sb."itemId"
    WHERE sb."hospitalId" = ${hospitalId}
      AND sb."storeId" = ${storeId}
      AND sb."quantity" > 0
      ${expiredOnly ? Prisma.sql`AND b."expiryDate" < NOW()` : Prisma.empty}
    ORDER BY (b."expiryDate" < NOW()) DESC, i."name" ASC
  `);
}
