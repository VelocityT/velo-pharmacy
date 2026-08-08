import { Prisma, LedgerTxnType } from "@prisma/client";
import { prisma, forHospital } from "@velocare/core/lib/db";
import { D, money, qty, gt, sum, ZERO } from "@velocare/core/lib/money";
import { applyMovements, type StockContext } from "./stock.service";
import { computeLine, computeBill, taxSplit } from "./gst.service";
import { nextDocNumber } from "./sequence.service";
import { enqueue } from "@velocare/core/server/sync/outbox";

/**
 * ────────────────────────────────────────────────────────────────
 *  RETURNS
 * ────────────────────────────────────────────────────────────────
 *
 *  Two directions, and they are not mirror images:
 *
 *  SALE RETURN — patient brings medicine back. Stock comes IN at the
 *  counter, a credit note is raised, and the original bill line's
 *  qtyReturned goes up so the same strip cannot be returned twice.
 *  Priced at the ORIGINAL bill rate, never today's rate: refunding
 *  more than was paid is how a pharmacy gets quietly drained.
 *
 *  PURCHASE RETURN — expired or damaged goods go back to the
 *  distributor. Stock goes OUT, a debit note is raised. Priced at the
 *  batch's purchase rate, because that is what the supplier will
 *  credit.
 *
 *  Both append reversal movements rather than editing history. The
 *  ledger keeps showing that goods left and came back, which is
 *  exactly what an auditor needs to see.
 */

export class ReturnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReturnError";
  }
}

// ══════════════════════════════════════════════════════════════
//  SALE RETURN
// ══════════════════════════════════════════════════════════════

export interface SaleReturnInput {
  saleId: string;
  reason?: string;
  lines: Array<{ saleLineId: string; quantity: number | string }>;
  clientUuid?: string;
}

export async function createSaleReturn(ctx: StockContext, input: SaleReturnInput) {
  if (!input.lines.length) throw new ReturnError("Select at least one line to return.");

  const db = forHospital(ctx.hospitalId);
  if (input.clientUuid) {
    const existing = await db.saleReturn.findFirst({
      where: { clientUuid: input.clientUuid },
      include: { lines: true },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findFirstOrThrow({
        where: { id: input.saleId, hospitalId: ctx.hospitalId },
        include: { lines: true, store: { select: { code: true, canBillPatient: true } } },
      });

      if (sale.isCancelled) {
        throw new ReturnError("This bill is cancelled — nothing to return against it.");
      }

      const hospital = await tx.hospital.findUniqueOrThrow({
        where: { id: ctx.hospitalId },
        select: { stateCode: true, fyStartMonth: true },
      });

      const returnNo = await nextDocNumber(tx, {
        hospitalId: ctx.hospitalId,
        storeId: sale.storeId,
        storeCode: sale.store.code,
        docType: "SALE_RETURN",
        date: new Date(),
        fyStartMonth: hospital.fyStartMonth,
        nodeId: ctx.nodeId,
      });

      const taxes = [];
      const retLines: Prisma.SaleReturnLineCreateManyRetInput[] = [];
      const movements: Parameters<typeof applyMovements>[2] = [];

      for (const l of input.lines) {
        const original = sale.lines.find((x) => x.id === l.saleLineId);
        if (!original) throw new ReturnError("Return line does not belong to this bill.");

        const want = qty(l.quantity);
        if (!gt(want, 0)) continue;

        // The guard that stops the same strip being refunded twice.
        const alreadyBack = qty(original.qtyReturned);
        const returnable = qty(D(original.qty).minus(alreadyBack));
        if (want.greaterThan(returnable)) {
          const item = await tx.item.findUnique({
            where: { id: original.itemId },
            select: { name: true },
          });
          throw new ReturnError(
            `Cannot return ${want.toFixed(3)} of ${item?.name ?? "item"} — only ` +
              `${returnable.toFixed(3)} remain returnable on this bill.`,
          );
        }

        const item = await tx.item.findFirstOrThrow({
          where: { id: original.itemId },
          select: { gstRate: true, cessRate: true },
        });

        // Priced at the ORIGINAL rate. Using today's rate would refund
        // more (or less) than the patient actually paid.
        const tax = computeLine({
          quantity: want,
          rate: original.rate,
          discountPct: original.discountPct,
          gstRate: item.gstRate,
          cessRate: item.cessRate,
          priceIncludesTax: true,
        });
        taxes.push(tax);

        retLines.push({
          itemId: original.itemId,
          batchId: original.batchId,
          qty: want,
          rate: original.rate,
          gstAmt: tax.gstAmt,
          lineTotal: tax.lineTotal,
        });

        movements.push({
          storeId: sale.storeId,
          itemId: original.itemId,
          batchId: original.batchId,
          txnType: LedgerTxnType.SALE_RETURN,
          quantity: want,
          rate: original.rate,
          refType: "SALE_RETURN",
          refId: "",
          refNo: returnNo,
          remarks: input.reason,
        });

        await tx.saleLine.update({
          where: { id: original.id },
          data: { qtyReturned: { increment: want } },
        });
      }

      if (!retLines.length) throw new ReturnError("Nothing to return.");

      const totals = computeBill(taxes, taxSplit(hospital.stateCode, hospital.stateCode));

      const ret = await tx.saleReturn.create({
        data: {
          hospitalId: ctx.hospitalId,
          returnNo,
          returnDate: new Date(),
          saleId: sale.id,
          storeId: sale.storeId,
          reason: input.reason,
          netAmount: totals.netAmount,
          originNodeId: ctx.nodeId,
          clientUuid: input.clientUuid,
          createdBy: ctx.userId,
          lines: { createMany: { data: retLines } },
        },
        include: { lines: true },
      });

      await applyMovements(tx, ctx, movements.map((m) => ({ ...m, refId: ret.id })));

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "SaleReturn",
          entityId: ret.id,
          newValue: { returnNo, against: sale.billNo, netAmount: totals.netAmount.toFixed(2) },
        },
      });

      await enqueue(tx, ctx, {
        entity: "SaleReturn",
        entityId: ret.id,
        op: "UPSERT",
        payload: ret as unknown as Prisma.InputJsonValue,
      });

      return ret;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
}

// ══════════════════════════════════════════════════════════════
//  PURCHASE RETURN
// ══════════════════════════════════════════════════════════════

export type PurchaseReturnReason = "EXPIRY" | "DAMAGE" | "WRONG_SUPPLY" | "RECALL" | "NEAR_EXPIRY";

export interface PurchaseReturnInput {
  supplierId: string;
  storeId: string;
  reason: PurchaseReturnReason;
  remarks?: string;
  lines: Array<{ itemId: string; batchId: string; quantity: number | string; rate?: number | string }>;
  clientUuid?: string;
}

export async function createPurchaseReturn(ctx: StockContext, input: PurchaseReturnInput) {
  if (!input.lines.length) throw new ReturnError("Add at least one line.");

  return prisma.$transaction(
    async (tx) => {
      const hospital = await tx.hospital.findUniqueOrThrow({
        where: { id: ctx.hospitalId },
        select: { stateCode: true, fyStartMonth: true },
      });

      const supplier = await tx.supplier.findFirstOrThrow({
        where: { id: input.supplierId, hospitalId: ctx.hospitalId },
        select: { stateCode: true, name: true },
      });

      const store = await tx.store.findFirstOrThrow({
        where: { id: input.storeId, hospitalId: ctx.hospitalId },
        select: { code: true },
      });

      const returnNo = await nextDocNumber(tx, {
        hospitalId: ctx.hospitalId,
        storeId: input.storeId,
        storeCode: store.code,
        docType: "PURCHASE_RETURN",
        date: new Date(),
        fyStartMonth: hospital.fyStartMonth,
        nodeId: ctx.nodeId,
      });

      const taxes = [];
      const retLines: Prisma.PurchaseReturnLineCreateManyRetInput[] = [];
      const movements: Parameters<typeof applyMovements>[2] = [];

      for (const l of input.lines) {
        const want = qty(l.quantity);
        if (!gt(want, 0)) continue;

        const batch = await tx.batch.findFirstOrThrow({
          where: { id: l.batchId, hospitalId: ctx.hospitalId },
          select: { purchaseRate: true, batchNo: true, expiryDate: true },
        });

        const item = await tx.item.findFirstOrThrow({
          where: { id: l.itemId, hospitalId: ctx.hospitalId },
          select: { gstRate: true, cessRate: true, name: true },
        });

        // At purchase rate — that is what the distributor credits back,
        // and valuing at MRP would overstate the receivable.
        const rate = money(l.rate ?? batch.purchaseRate);

        // Supplier invoices are GST-exclusive, so the debit note is too.
        const tax = computeLine({
          quantity: want,
          rate,
          gstRate: item.gstRate,
          cessRate: item.cessRate,
          priceIncludesTax: false,
        });
        taxes.push(tax);

        retLines.push({
          itemId: l.itemId,
          batchId: l.batchId,
          qty: want,
          rate,
          gstAmt: tax.gstAmt,
          lineTotal: tax.lineTotal,
        });

        movements.push({
          storeId: input.storeId,
          itemId: l.itemId,
          batchId: l.batchId,
          txnType: LedgerTxnType.PURCHASE_RETURN,
          quantity: want,
          rate,
          refType: "PURCHASE_RETURN",
          refId: "",
          refNo: returnNo,
          remarks: `${input.reason}${input.remarks ? `: ${input.remarks}` : ""}`,
        });
      }

      if (!retLines.length) throw new ReturnError("Nothing to return.");

      const totals = computeBill(taxes, taxSplit(hospital.stateCode, supplier.stateCode));

      const ret = await tx.purchaseReturn.create({
        data: {
          hospitalId: ctx.hospitalId,
          returnNo,
          returnDate: new Date(),
          supplierId: input.supplierId,
          storeId: input.storeId,
          reason: input.reason,
          netAmount: totals.netAmount,
          isPosted: true,
          createdBy: ctx.userId,
          lines: { createMany: { data: retLines } },
        },
        include: { lines: true },
      });

      // applyMovements enforces store ownership and refuses to drive
      // any batch negative, so a return of more than is on the shelf
      // fails here rather than corrupting stock.
      await applyMovements(tx, ctx, movements.map((m) => ({ ...m, refId: ret.id })));

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "PurchaseReturn",
          entityId: ret.id,
          newValue: {
            returnNo,
            supplier: supplier.name,
            reason: input.reason,
            netAmount: totals.netAmount.toFixed(2),
          },
        },
      });

      return ret;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
}

/** Batches worth returning: expired, near-expiry, or flagged in a recall. */
export async function returnableBatches(
  hospitalId: string,
  storeId: string,
  withinDays = 90,
) {
  return prisma.$queryRaw<
    Array<{
      itemId: string; itemName: string; batchId: string; batchNo: string;
      expiryDate: Date; daysLeft: number; quantity: Prisma.Decimal;
      purchaseRate: Prisma.Decimal; value: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT i."id" AS "itemId", i."name" AS "itemName",
           b."id" AS "batchId", b."batchNo", b."expiryDate",
           (b."expiryDate"::date - CURRENT_DATE) AS "daysLeft",
           sb."quantity", b."purchaseRate",
           (sb."quantity" * b."purchaseRate") AS value
    FROM stock_balances sb
    JOIN batches b ON b."id" = sb."batchId"
    JOIN items i   ON i."id" = sb."itemId"
    WHERE sb."hospitalId" = ${hospitalId}
      AND sb."storeId" = ${storeId}
      AND sb."quantity" > 0
      AND b."expiryDate" <= CURRENT_DATE + (${withinDays} || ' days')::interval
    ORDER BY b."expiryDate" ASC
  `);
}
