import { Prisma, LedgerTxnType, SaleType, PaymentMode, DrugSchedule } from "@prisma/client";
import { prisma, forHospital } from "@velocare/core/lib/db";
import type { Tx } from "@velocare/core/lib/db";
import { D, money, qty, gt, ZERO } from "@velocare/core/lib/money";
import { allocateFefo, applyMovements, type StockContext } from "./stock.service";
import { computeLine, computeBill, taxSplit, assertWithinMrp, type LineTax } from "./gst.service";
import { nextDocNumber } from "./sequence.service";
import { enqueue } from "@velocare/core/server/sync/outbox";

/**
 * ────────────────────────────────────────────────────────────────
 *  SALE / DISPENSING
 * ────────────────────────────────────────────────────────────────
 *
 *  One transaction does all of this or none of it:
 *    · lock and take the bill number
 *    · FEFO-allocate batches (row-locked, so no oversell)
 *    · compute GST out of MRP
 *    · write Sale + SaleLine
 *    · append stock ledger + update balance cache
 *    · write Schedule H1 register rows for H1 drugs
 *    · write narcotic register rows with running balance
 *    · enqueue the sync outbox row
 *
 *  Isolation is Serializable. Pharmacy billing is low-volume enough
 *  (tens of bills per minute, not thousands) that the cost is
 *  irrelevant, and the failure mode it prevents — two counters
 *  overselling the last strip — is one a pharmacist cannot fix.
 */

export interface SaleLineInput {
  itemId: string;
  quantity: number | string;
  /** Pharmacist override; otherwise FEFO decides. */
  batchId?: string;
  discountPct?: number | string;
}

export interface CreateSaleInput {
  storeId: string;
  saleType?: SaleType;
  paymentMode?: PaymentMode;
  paidAmount?: number | string;

  patientId?: string;
  visitId?: string;
  rxId?: string;
  customerName?: string;
  customerPhone?: string;

  lines: SaleLineInput[];

  /** Minted by the counter BEFORE posting. Makes a retried flush idempotent. */
  clientUuid?: string;
  isOfflineOrigin?: boolean;
  billDate?: Date;
}

export interface SaleContext extends StockContext {
  storeCode?: string;
}

export class DispensingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispensingError";
  }
}

export async function createSale(ctx: SaleContext, input: CreateSaleInput) {
  if (input.lines.length === 0) throw new DispensingError("Cannot bill an empty cart.");

  const db = forHospital(ctx.hospitalId);
  const billDate = input.billDate ?? new Date();

  // Idempotency: a counter flushing its offline queue may send the
  // same bill twice. Return the original rather than posting a duplicate.
  if (input.clientUuid) {
    const existing = await db.sale.findFirst({
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
        select: { id: true, code: true, canBillPatient: true },
      });

      if (!store.canBillPatient) {
        throw new DispensingError(
          `Store ${store.code} is not a billing counter. Move stock via an Indent first.`,
        );
      }

      // ── 1. Bill number (row-locked online, block-reserved offline)
      const billNo = await nextDocNumber(tx, {
        hospitalId: ctx.hospitalId,
        storeId: input.storeId,
        storeCode: store.code,
        docType: "SALE",
        date: billDate,
        fyStartMonth: hospital.fyStartMonth,
        nodeId: ctx.nodeId,
      });

      // ── 2. Allocate batches and compute tax, line by line
      const split = taxSplit(hospital.stateCode, hospital.stateCode); // patient sale is always intra-state
      const saleLines: Prisma.SaleLineCreateManySaleInput[] = [];
      const taxes: LineTax[] = [];
      const movements: Parameters<typeof applyMovements>[2] = [];
      const h1Rows: Array<{ itemId: string; batchId: string; qty: Prisma.Decimal }> = [];
      const narcoticRows: Array<{ itemId: string; batchId: string; qty: Prisma.Decimal }> = [];

      for (const line of input.lines) {
        const item = await tx.item.findFirstOrThrow({
          where: { id: line.itemId, hospitalId: ctx.hospitalId, isActive: true },
          select: {
            id: true,
            name: true,
            gstRate: true,
            cessRate: true,
            schedule: true,
            isNarcotic: true,
          },
        });

        const allocations = await allocateFefo(tx, ctx, {
          storeId: input.storeId,
          itemId: line.itemId,
          quantity: line.quantity,
          asOf: billDate,
          preferBatchId: line.batchId,
        });

        for (const a of allocations) {
          // Sale rate defaults to MRP; a configured saleRate may be lower,
          // never higher. NPPA ceiling is the MRP on the pack.
          const rate = a.saleRate.isZero() ? a.mrp : a.saleRate;
          assertWithinMrp(rate, a.mrp, item.name);

          const tax = computeLine({
            quantity: a.quantity,
            rate,
            discountPct: line.discountPct ?? 0,
            gstRate: item.gstRate,
            cessRate: item.cessRate,
            priceIncludesTax: true, // MRP is GST-inclusive
          });
          taxes.push(tax);

          saleLines.push({
            itemId: item.id,
            batchId: a.batchId,
            qty: a.quantity,
            mrp: a.mrp,
            rate,
            discountPct: D(line.discountPct ?? 0),
            taxableAmt: tax.taxableAmt,
            gstRate: tax.gstRate,
            gstAmt: tax.gstAmt,
            lineTotal: tax.lineTotal,
          });

          movements.push({
            storeId: input.storeId,
            itemId: item.id,
            batchId: a.batchId,
            txnType: LedgerTxnType.SALE,
            quantity: a.quantity,
            rate: a.purchaseRate, // valuation at cost, not at MRP
            refType: "SALE",
            refId: "", // back-filled once the sale id exists
            refNo: billNo,
          });

          if (item.schedule === DrugSchedule.H1) {
            h1Rows.push({ itemId: item.id, batchId: a.batchId, qty: a.quantity });
          }
          if (item.isNarcotic || item.schedule === DrugSchedule.NARCOTIC) {
            narcoticRows.push({ itemId: item.id, batchId: a.batchId, qty: a.quantity });
          }
        }
      }

      // ── 3. Compliance gate BEFORE anything is written
      if (h1Rows.length > 0 || narcoticRows.length > 0) {
        await assertPrescriptionPresent(tx, ctx, input, h1Rows.length > 0, narcoticRows.length > 0);
      }

      // ── 4. Bill totals (rupee rounding applied once, here)
      const totals = computeBill(taxes, split);

      const sale = await tx.sale.create({
        data: {
          hospitalId: ctx.hospitalId,
          billNo,
          billDate,
          storeId: input.storeId,
          saleType: input.saleType ?? SaleType.CASH,
          patientId: input.patientId,
          visitId: input.visitId,
          rxId: input.rxId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          grossAmount: totals.grossAmount,
          discountAmt: totals.discountAmt,
          taxableAmt: totals.taxableAmt,
          cgstAmt: totals.cgstAmt,
          sgstAmt: totals.sgstAmt,
          igstAmt: totals.igstAmt,
          roundOff: totals.roundOff,
          netAmount: totals.netAmount,
          paymentMode: input.paymentMode ?? PaymentMode.CASH,
          paidAmount: money(input.paidAmount ?? totals.netAmount),
          originNodeId: ctx.nodeId,
          clientUuid: input.clientUuid,
          isOfflineOrigin: input.isOfflineOrigin ?? false,
          syncedAt: ctx.nodeId ? null : new Date(),
          createdBy: ctx.userId,
          lines: { createMany: { data: saleLines } },
        },
        include: { lines: true },
      });

      // ── 5. Stock movements — the only path that touches the ledger
      await applyMovements(
        tx,
        ctx,
        movements.map((m) => ({ ...m, refId: sale.id })),
      );

      // ── 6. Compliance registers, written automatically.
      //     Never a manual data-entry screen — a register a human
      //     has to remember to fill is a register that is empty on
      //     the day the drug inspector visits.
      if (h1Rows.length) await writeH1Register(tx, ctx, sale.id, input, h1Rows, billDate);
      if (narcoticRows.length)
        await writeNarcoticRegister(tx, ctx, sale.id, input, narcoticRows, billDate);

      // ── 7. Mark prescription lines dispensed
      if (input.rxId) await markDispensed(tx, input.rxId, saleLines);

      // ── 8. Sync
      await enqueue(tx, ctx, {
        entity: "Sale",
        entityId: sale.id,
        op: "UPSERT",
        payload: sale as unknown as Prisma.InputJsonValue,
      });

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "CREATE",
          entityType: "Sale",
          entityId: sale.id,
          newValue: { billNo, netAmount: totals.netAmount.toFixed(2) },
        },
      });

      return sale;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 },
  );
}

// ──────────────────────────────────────────────────────────────
//  Compliance
// ──────────────────────────────────────────────────────────────

async function assertPrescriptionPresent(
  tx: Tx,
  ctx: StockContext,
  input: CreateSaleInput,
  needsH1: boolean,
  needsNarcotic: boolean,
) {
  if (!input.rxId) {
    throw new DispensingError(
      needsNarcotic
        ? "Narcotic drugs cannot be dispensed without a linked prescription (NDPS Act)."
        : "Schedule H1 drugs cannot be dispensed without a linked prescription.",
    );
  }

  const rx = await tx.prescription.findFirst({
    where: { id: input.rxId, hospitalId: ctx.hospitalId },
    select: { id: true, scanUrl: true, doctor: { select: { registrationNo: true, name: true } } },
  });

  if (!rx) throw new DispensingError("Linked prescription not found.");

  if (!rx.doctor.registrationNo) {
    throw new DispensingError(
      `Doctor ${rx.doctor.name} has no registration number on record. ` +
        `It is a mandatory column of the Schedule H1 register.`,
    );
  }
}

async function writeH1Register(
  tx: Tx,
  ctx: StockContext,
  saleId: string,
  input: CreateSaleInput,
  rows: Array<{ itemId: string; batchId: string; qty: Prisma.Decimal }>,
  entryDate: Date,
) {
  const rx = input.rxId
    ? await tx.prescription.findFirst({
        where: { id: input.rxId, hospitalId: ctx.hospitalId },
        select: {
          rxNo: true,
          doctor: { select: { name: true, registrationNo: true } },
          patient: { select: { name: true, address: true } },
        },
      })
    : null;

  await tx.scheduleH1Register.createMany({
    data: rows.map((r) => ({
      hospitalId: ctx.hospitalId,
      entryDate,
      saleId,
      itemId: r.itemId,
      batchId: r.batchId,
      qty: r.qty,
      patientName: rx?.patient.name ?? input.customerName ?? "WALK-IN",
      patientAddress: rx?.patient.address ?? null,
      doctorName: rx?.doctor.name ?? "",
      doctorRegNo: rx?.doctor.registrationNo ?? null,
      rxNo: rx?.rxNo ?? null,
      dispensedBy: ctx.userId,
    })),
  });
}

/**
 * NDPS narcotic register. The running balance must reconcile daily,
 * so each row carries its own opening and closing figure rather
 * than being recomputed from the ledger at report time — the
 * register is a legal document in its own right and must show what
 * was true when it was signed.
 */
async function writeNarcoticRegister(
  tx: Tx,
  ctx: StockContext,
  saleId: string,
  input: CreateSaleInput,
  rows: Array<{ itemId: string; batchId: string; qty: Prisma.Decimal }>,
  entryDate: Date,
) {
  for (const r of rows) {
    const last = await tx.narcoticRegister.findFirst({
      where: {
        hospitalId: ctx.hospitalId,
        storeId: input.storeId,
        itemId: r.itemId,
        batchId: r.batchId,
      },
      orderBy: { createdAt: "desc" },
      select: { closingBal: true },
    });

    const opening = qty(last?.closingBal ?? 0);

    await tx.narcoticRegister.create({
      data: {
        hospitalId: ctx.hospitalId,
        entryDate,
        storeId: input.storeId,
        itemId: r.itemId,
        batchId: r.batchId,
        openingBal: opening,
        qtyIn: ZERO,
        qtyOut: r.qty,
        closingBal: qty(opening.minus(r.qty)),
        refType: "SALE",
        refId: saleId,
        patientName: input.customerName ?? null,
        createdBy: ctx.userId,
      },
    });
  }
}

async function markDispensed(
  tx: Tx,
  rxId: string,
  lines: Prisma.SaleLineCreateManySaleInput[],
) {
  const byItem = new Map<string, Prisma.Decimal>();
  for (const l of lines) {
    byItem.set(l.itemId, qty(D(byItem.get(l.itemId) ?? 0).plus(D(l.qty as never))));
  }

  for (const [itemId, q] of byItem) {
    await tx.prescriptionLine.updateMany({
      where: { rxId, itemId },
      data: { qtyDispensed: { increment: q } },
    });
  }

  const pending = await tx.prescriptionLine.count({
    where: { rxId, qtyDispensed: { equals: 0 } },
  });
  if (pending === 0) {
    await tx.prescription.update({ where: { id: rxId }, data: { isDispensed: true } });
  }
}

// ──────────────────────────────────────────────────────────────
//  Cancellation
// ──────────────────────────────────────────────────────────────

/**
 * A cancelled bill is never deleted and its stock is never "put
 * back" by editing a ledger row. Reversal movements are appended,
 * so the ledger still shows that the goods left and came back —
 * which is exactly what an auditor needs to see.
 */
export async function cancelSale(
  ctx: SaleContext,
  saleId: string,
  reason: string,
) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findFirstOrThrow({
        where: { id: saleId, hospitalId: ctx.hospitalId },
        include: { lines: true },
      });

      if (sale.isCancelled) throw new DispensingError("Bill is already cancelled.");

      const returned = sale.lines.reduce((a, l) => a.plus(D(l.qtyReturned)), ZERO);
      if (gt(returned, 0)) {
        throw new DispensingError(
          "Bill has returns against it. Reverse the returns before cancelling.",
        );
      }

      await applyMovements(
        tx,
        ctx,
        sale.lines.map((l) => ({
          storeId: sale.storeId,
          itemId: l.itemId,
          batchId: l.batchId,
          txnType: LedgerTxnType.SALE_RETURN,
          quantity: l.qty,
          rate: l.rate,
          refType: "SALE" as const,
          refId: sale.id,
          refNo: sale.billNo,
          remarks: `CANCELLED: ${reason}`,
        })),
      );

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: { isCancelled: true, cancelledAt: new Date(), cancelReason: reason },
      });

      await tx.auditLog.create({
        data: {
          hospitalId: ctx.hospitalId,
          userId: ctx.userId,
          action: "CANCEL",
          entityType: "Sale",
          entityId: saleId,
          oldValue: { billNo: sale.billNo },
          newValue: { reason },
        },
      });

      await enqueue(tx, ctx, {
        entity: "Sale",
        entityId: saleId,
        op: "UPSERT",
        payload: updated as unknown as Prisma.InputJsonValue,
      });

      return updated;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
