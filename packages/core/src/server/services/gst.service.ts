import { Prisma } from "@prisma/client";
import { D, money, qty, pct, sum, roundBill, ZERO } from "@velocare/core/lib/money";

/**
 * ────────────────────────────────────────────────────────────────
 *  GST CALCULATION
 * ────────────────────────────────────────────────────────────────
 *
 *  Two things about Indian pharmacy that trip up generic billing code:
 *
 *  1. MRP IS TAX-INCLUSIVE. Drug MRP is printed on the strip and is
 *     legally the maximum a patient can be charged INCLUSIVE of GST.
 *     So a counter sale back-computes the taxable value out of the
 *     price, while a supplier's purchase invoice quotes rates
 *     EXCLUSIVE of GST and adds it on top. Same schema, opposite
 *     direction — hence `priceIncludesTax`.
 *
 *  2. Place of supply decides the split. Same state code as the
 *     hospital → CGST + SGST at half the rate each. Different state
 *     → IGST at the full rate. A patient walking into the pharmacy
 *     is always intra-state; a supplier in another state is not.
 */

export type TaxSplit = "INTRA" | "INTER";

export function taxSplit(hospitalStateCode?: string | null, partyStateCode?: string | null): TaxSplit {
  if (!hospitalStateCode || !partyStateCode) return "INTRA";
  return hospitalStateCode.trim() === partyStateCode.trim() ? "INTRA" : "INTER";
}

export interface LineInput {
  quantity: Prisma.Decimal | number | string;
  /** MRP for a sale, purchase rate for a GRN. */
  rate: Prisma.Decimal | number | string;
  discountPct?: Prisma.Decimal | number | string;
  gstRate: Prisma.Decimal | number | string;
  cessRate?: Prisma.Decimal | number | string;
  /** true for patient sales (MRP inclusive), false for purchase invoices. */
  priceIncludesTax: boolean;
}

export interface LineTax {
  grossAmount: Prisma.Decimal;
  discountAmt: Prisma.Decimal;
  taxableAmt: Prisma.Decimal;
  gstRate: Prisma.Decimal;
  gstAmt: Prisma.Decimal;
  cessAmt: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

/**
 * Per-line tax. NOTE: no rounding to rupees here — only to paise.
 * Rupee rounding happens once, at bill level, in `computeBill`.
 * Rounding each line is how a bill's lines stop adding up to its total.
 */
export function computeLine(input: LineInput): LineTax {
  const q = qty(input.quantity);
  const rate = money(input.rate);
  const disc = pct(input.discountPct ?? 0);
  const gstRate = pct(input.gstRate);
  const cessRate = pct(input.cessRate ?? 0);

  const gross = money(q.times(rate));
  const discountAmt = money(gross.times(disc).dividedBy(100));
  const afterDiscount = gross.minus(discountAmt);

  let taxableAmt: Prisma.Decimal;
  let gstAmt: Prisma.Decimal;
  let cessAmt: Prisma.Decimal;

  if (input.priceIncludesTax) {
    // Back-compute out of an MRP-inclusive price.
    const divisor = D(100).plus(gstRate).plus(cessRate);
    taxableAmt = money(afterDiscount.times(100).dividedBy(divisor));
    gstAmt = money(taxableAmt.times(gstRate).dividedBy(100));
    cessAmt = money(taxableAmt.times(cessRate).dividedBy(100));
  } else {
    taxableAmt = money(afterDiscount);
    gstAmt = money(taxableAmt.times(gstRate).dividedBy(100));
    cessAmt = money(taxableAmt.times(cessRate).dividedBy(100));
  }

  return {
    grossAmount: gross,
    discountAmt,
    taxableAmt,
    gstRate,
    gstAmt,
    cessAmt,
    lineTotal: money(taxableAmt.plus(gstAmt).plus(cessAmt)),
  };
}

export interface BillTotals {
  grossAmount: Prisma.Decimal;
  discountAmt: Prisma.Decimal;
  taxableAmt: Prisma.Decimal;
  cgstAmt: Prisma.Decimal;
  sgstAmt: Prisma.Decimal;
  igstAmt: Prisma.Decimal;
  cessAmt: Prisma.Decimal;
  roundOff: Prisma.Decimal;
  netAmount: Prisma.Decimal;
}

export function computeBill(lines: LineTax[], split: TaxSplit): BillTotals {
  const grossAmount = money(sum(lines.map((l) => l.grossAmount)));
  const discountAmt = money(sum(lines.map((l) => l.discountAmt)));
  const taxableAmt = money(sum(lines.map((l) => l.taxableAmt)));
  const totalGst = money(sum(lines.map((l) => l.gstAmt)));
  const cessAmt = money(sum(lines.map((l) => l.cessAmt)));

  // Halving CGST/SGST: round the half UP, derive the other by
  // subtraction so the two always add back to the exact total.
  // Halving both independently loses a paisa at odd amounts.
  const cgstAmt = split === "INTRA" ? money(totalGst.dividedBy(2)) : ZERO;
  const sgstAmt = split === "INTRA" ? money(totalGst.minus(cgstAmt)) : ZERO;
  const igstAmt = split === "INTER" ? totalGst : ZERO;

  const beforeRound = taxableAmt.plus(totalGst).plus(cessAmt);
  const { rounded, roundOff } = roundBill(beforeRound);

  return {
    grossAmount,
    discountAmt,
    taxableAmt,
    cgstAmt,
    sgstAmt,
    igstAmt,
    cessAmt,
    roundOff,
    netAmount: rounded,
  };
}

/** HSN-wise summary — the annexure GSTR-1 asks for. */
export interface HsnRow {
  hsnCode: string;
  gstRate: Prisma.Decimal;
  quantity: Prisma.Decimal;
  taxableAmt: Prisma.Decimal;
  cgstAmt: Prisma.Decimal;
  sgstAmt: Prisma.Decimal;
  igstAmt: Prisma.Decimal;
  cessAmt: Prisma.Decimal;
}

export function summariseHsn(
  rows: Array<{
    hsnCode: string | null;
    gstRate: Prisma.Decimal | number;
    quantity: Prisma.Decimal | number;
    taxableAmt: Prisma.Decimal | number;
    gstAmt: Prisma.Decimal | number;
    cessAmt?: Prisma.Decimal | number;
    split: TaxSplit;
  }>,
): HsnRow[] {
  const map = new Map<string, HsnRow>();

  for (const r of rows) {
    const hsn = r.hsnCode?.trim() || "UNMAPPED";
    const rate = pct(r.gstRate);
    const key = `${hsn}|${rate.toFixed(2)}`;

    const cur =
      map.get(key) ??
      {
        hsnCode: hsn,
        gstRate: rate,
        quantity: ZERO,
        taxableAmt: ZERO,
        cgstAmt: ZERO,
        sgstAmt: ZERO,
        igstAmt: ZERO,
        cessAmt: ZERO,
      };

    const gst = money(r.gstAmt);
    const half = money(gst.dividedBy(2));

    cur.quantity = qty(cur.quantity.plus(D(r.quantity)));
    cur.taxableAmt = money(cur.taxableAmt.plus(D(r.taxableAmt)));
    cur.cessAmt = money(cur.cessAmt.plus(D(r.cessAmt ?? 0)));

    if (r.split === "INTRA") {
      cur.cgstAmt = money(cur.cgstAmt.plus(half));
      cur.sgstAmt = money(cur.sgstAmt.plus(gst.minus(half)));
    } else {
      cur.igstAmt = money(cur.igstAmt.plus(gst));
    }

    map.set(key, cur);
  }

  return [...map.values()].sort(
    (a, b) => a.hsnCode.localeCompare(b.hsnCode) || a.gstRate.comparedTo(b.gstRate),
  );
}

/**
 * NPPA ceiling-price guard. Scheduled-drug MRP is capped by
 * notification; billing above the cap is a compliance breach, not
 * a pricing choice. Called by the sale service before posting.
 */
export function assertWithinMrp(
  rate: Prisma.Decimal | number,
  mrp: Prisma.Decimal | number,
  itemName: string,
): void {
  if (money(rate).greaterThan(money(mrp))) {
    throw new Error(
      `Cannot bill ${itemName} above MRP: rate ₹${money(rate).toFixed(2)} > MRP ₹${money(mrp).toFixed(2)}.`,
    );
  }
}
