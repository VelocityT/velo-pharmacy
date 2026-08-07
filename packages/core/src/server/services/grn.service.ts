import { Prisma, LedgerTxnType } from "@prisma/client";
import { prisma, forHospital } from "@velocare/core/lib/db";
import { D, money, qty, sum, ZERO } from "@velocare/core/lib/money";
import { applyMovements, type StockContext } from "./stock.service";
import { computeLine, computeBill, taxSplit } from "./gst.service";
import { nextDocNumber } from "./sequence.service";
import { enqueue } from "@velocare/core/server/sync/outbox";

/**
 * ────────────────────────────────────────────────────────────────
 *  GRN — Goods Receipt Note (supplier invoice entry)
 * ────────────────────────────────────────────────────────────────
 *
 *  The hardest data-entry screen in the product, and the one that
 *  decides whether the whole system's stock is trustworthy. Three
 *  things it must get right that generic purchase modules do not:
 *
 *  1. BATCH + EXPIRY are mandatory and are what create the batch
 *     record. A pharmacy purchase without a batch number is not a
 *     pharmacy purchase.
 *
 *  2. FREE QTY is costed at zero but enters stock at full quantity.
 *     Distributor schemes ("10+1") are universal in Indian pharma.
 *     Booking free goods at rate inflates purchase value and
 *     destroys margin reporting.
 *
 *  3. DRAFT then POST. A GRN is keyed, checked against the physical
 *     invoice, and only then posted. Stock moves at POST, never at
 *     save — so a half-typed invoice never pollutes stock.
 */

export interface GrnLineInput {
  itemId: string;
  batchNo: string;
  expiryDate: Date | string;
  mfgDate?: Date | string;
  mrp: number | string;
  quantity: number | string;
  freeQty?: number | string;
  rate: number | string;
  discountPct?: number | string;
  /** Defaults to MRP if omitted. */
  saleRate?: number | string;
}

export interface CreateGrnInput {
  supplierId: string;
  storeId: string;
  poId?: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: Date | string;
  grnDate?: Date;
  lines: GrnLineInput[];
  clientUuid?: string;
}

export class GrnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrnError";
  }
}

/** Expiry is stored as the LAST day of the printed month — "06/27" means valid through 30 Jun 2027. */
export function endOfExpiryMonth(input: Date | string): Date {
  const d = new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59));
}

export async function createGrn(ctx: StockContext, input: CreateGrnInput) {
  if (!input.lines.length) throw new GrnError("A GRN must have at least one line.");

  const db = forHospital(ctx.hospitalId);
  const grnDate = input.grnDate ?? new Date();

  if (input.clientUuid) {
    const existing = await db.grn.findFirst({
      where: { clientUuid: input.clientUuid },
      include: { lines: true },
    });
    if (existing) return existing;
  }

  return prisma.$transaction(
    async (tx) => {
      const hospital = await tx.hospital.findUniqueOrThrow({
        where: { id: ctx.hospitalId },
        select: { stateCode: true, fyStartMonth: true },
      });

      const store = await tx.store.findFirstOrThrow({
        where: { id: input.storeId, hospitalId: ctx.hospitalId },
        select: { code: true, canReceivePurchase: true },
      });

      if (!store.canReceivePurchase) {
        throw new GrnError(
          `Store ${store.code} may not receive purchases directly. ` +
            `Goods enter at the main store and reach sub-stores by indent.`,
        );
      }

      const supplier = await tx.supplier.findFirstOrThrow({
        where: { id: input.supplierId, hospitalId: ctx.hospitalId },
        select: { stateCode: true, name: true },
      });

      // Duplicate supplier-invoice guard is a DB constraint, but a
      // clean error beats a constraint violation in the UI.
      const dupe = await tx.grn.findFirst({
        where: {
          hospitalId: ctx.hospitalId,
          supplierId: input.supplierId,
          supplierInvoiceNo: input.supplierInvoiceNo,
        },
        select: { grnNo: true },
      });
      if (dupe) {
        throw new GrnError(
          `Invoice ${input.supplierInvoiceNo} from ${supplier.name} is already entered as ${dupe.grnNo}.`,
        );
      }

      const grnNo = await nextDocNumber(tx, {
        hospitalId: ctx.hospitalId,
        storeId: input.storeId,
        storeCode: store.code,
        docType: "GRN",
        date: grnDate,
        fyStartMonth: hospital.fyStartMonth,
        nodeId: ctx.nodeId,
      });

      const split = taxSplit(hospital.stateCode, supplier.stateCode);
      const taxes = [];
      const grnLines: Prisma.GrnLineCreateManyGrnInput[] = [];
      const movements: Parameters<typeof applyMovements>[2] = [];

      for (const line of input.lines) {
        const item = await tx.item.findFirstOrThrow({
          where: { id: line.itemId, hospitalId: ctx.hospitalId },
          select: { id: true, name: true, gstRate: true, cessRate: true },
        });

        const expiryDate = endOfExpiryMonth(line.expiryDate);
        if (expiryDate <= grnDate) {
          throw new GrnError(
            `${item.name} batch ${line.batchNo} expires ${expiryDate.toDateString()} — ` +
              `already expired. Refuse the goods, do not receive them.`,
          );
        }

        const mrp = money(line.mrp);
        const rate = money(line.rate);
        if (rate.greaterThan(mrp)) {
          throw new GrnError(
            `${item.name}: purchase rate ₹${rate.toFixed(2)} exceeds MRP ₹${mrp.toFixed(2)}. Check the invoice.`,
          );
        }

        // Batch is hospital-wide and created once per (item, batchNo, expiry).
        const batch = await tx.batch.upsert({
          where: {
            hospitalId_itemId_batchNo_expiryDate: {
              hospitalId: ctx.hospitalId,
              itemId: item.id,
              batchNo: line.batchNo.trim().toUpperCase(),
              expiryDate,
            },
          },
          create: {
            hospitalId: ctx.hospitalId,
            itemId: item.id,
            batchNo: line.batchNo.trim().toUpperCase(),
            expiryDate,
            mfgDate: line.mfgDate ? new Date(line.mfgDate) : null,
            mrp,
            purchaseRate: rate,
            saleRate: money(line.saleRate ?? mrp),
          },
          // Latest purchase wins on rate — margin reports read the batch,
          // and the batch is the thing physically on the shelf.
          update: { mrp, purchaseRate: rate, saleRate: money(line.saleRate ?? mrp) },
        });

        const billedQty = qty(line.quantity);
        const freeQty = qty(line.freeQty ?? 0);

        // Tax is charged on billed quantity only. Free goods are
        // costed at zero but enter stock at full count.
        const tax = computeLine({
          quantity: billedQty,
          rate,
          discountPct: line.discountPct ?? 0,
          gstRate: item.gstRate,
          cessRate: item.cessRate,
          priceIncludesTax: false, // supplier invoices quote ex-GST
        });
        taxes.push(tax);

        grnLines.push({
          itemId: item.id,
          batchId: batch.id,
          qty: billedQty,
          freeQty,
          rate,
          discountPct: D(line.discountPct ?? 0),
          taxableAmt: tax.taxableAmt,
          gstRate: tax.gstRate,
          gstAmt: tax.gstAmt,
          lineTotal: tax.lineTotal,
        });

        const totalIn = qty(billedQty.plus(freeQty));
        // Weighted cost: free goods pull the effective rate down.
        // This is the number that must feed margin reporting.
        const effectiveRate = money(tax.taxableAmt.dividedBy(totalIn));

        movements.push({
          storeId: input.storeId,
          itemId: item.id,
          batchId: batch.id,
          txnType: LedgerTxnType.GRN,
          quantity: totalIn,
          rate: effectiveRate,
          refType: "GRN",
          refId: "",
          refNo: grnNo,
          remarks: freeQty.isZero() ? undefined : `incl. ${freeQty.toFixed(0)} free`,
        });
      }

      const totals = computeBill(taxes, split);

      const grn = await tx.grn.create({
        data: {
          hospitalId: ctx.hospitalId,
          grnNo,
          grnDate,
          supplierId: input.supplierId,
          storeId: input.storeId,
          poId: input.poId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          supplierInvoiceDate: new Date(input.supplierInvoiceDate),
          grossAmount: totals.grossAmount,
          discountAmt: totals.discountAmt,
          taxableAmt: totals.taxableAmt,
          cgstAmt: totals.cgstAmt,
          sgstAmt: totals.sgstAmt,
          igstAmt: totals.igstAmt,
          cessAmt: totals.cessAmt,
          roundOff: totals.roundOff,
          netAmount: totals.netAmount,
          isPosted: true,
          postedAt: new Date(),
          originNodeId: ctx.nodeId,
          clientUuid: input.clientUuid,
          createdBy: ctx.userId,
          lines: { createMany: { data: grnLines } },
        },
        include: { lines: true },
      });

      await applyMovements(tx, ctx, movements.map((m) => ({ ...m, refId: grn.id })));

      if (input.poId) await updatePoReceipt(tx, input.poId, grnLines);

      await enqueue(tx, ctx, {
        entity: "Grn",
        entityId: grn.id,
        op: "UPSERT",
        payload: grn as unknown as Prisma.InputJsonValue,
      });

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "POST",
          entityType: "Grn",
          entityId: grn.id,
          newValue: { grnNo, netAmount: totals.netAmount.toFixed(2) },
        },
      });

      return grn;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

async function updatePoReceipt(
  tx: Prisma.TransactionClient,
  poId: string,
  lines: Prisma.GrnLineCreateManyGrnInput[],
) {
  for (const l of lines) {
    await tx.purchaseOrderLine.updateMany({
      where: { poId, itemId: l.itemId },
      data: { qtyRecd: { increment: qty(l.qty as never) } },
    });
  }

  const open = await tx.purchaseOrderLine.count({
    where: { poId, qtyRecd: { equals: 0 } },
  });
  const all = await tx.purchaseOrderLine.findMany({
    where: { poId },
    select: { qty: true, qtyRecd: true },
  });
  const fullyReceived = all.every((l) => D(l.qtyRecd).greaterThanOrEqualTo(D(l.qty)));

  await tx.purchaseOrder.update({
    where: { id: poId },
    data: { status: fullyReceived ? "RECEIVED" : open === all.length ? "APPROVED" : "PARTIALLY_RECEIVED" },
  });
}

/** Batches expiring within `days`, worth returning to the supplier while they still have credit value. */
export async function nearExpiry(ctx: StockContext, days = 90, storeId?: string) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  return prisma.$queryRaw<
    Array<{
      itemName: string;
      batchNo: string;
      expiryDate: Date;
      storeName: string;
      quantity: Prisma.Decimal;
      value: Prisma.Decimal;
    }>
  >(Prisma.sql`
    SELECT i."name"     AS "itemName",
           b."batchNo"  AS "batchNo",
           b."expiryDate" AS "expiryDate",
           st."name"    AS "storeName",
           sb."quantity" AS "quantity",
           (sb."quantity" * b."purchaseRate") AS "value"
    FROM "stock_balances" sb
    JOIN "batches" b  ON b."id"  = sb."batchId"
    JOIN "items"   i  ON i."id"  = sb."itemId"
    JOIN "stores"  st ON st."id" = sb."storeId"
    WHERE sb."hospitalId" = ${ctx.hospitalId}
      AND sb."quantity" > 0
      AND b."expiryDate" <= ${cutoff}
      ${storeId ? Prisma.sql`AND sb."storeId" = ${storeId}` : Prisma.empty}
    ORDER BY b."expiryDate" ASC
  `);
}
