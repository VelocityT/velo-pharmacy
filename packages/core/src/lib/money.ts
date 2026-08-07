import { Prisma } from "@prisma/client";

/**
 * Money and quantity helpers.
 *
 * RULE: money and quantity never touch the JS `number` type.
 * GST at 5/12/18% computed on floats produces ₹0.01 drift that
 * surfaces as a GSTR-1 mismatch months later. Decimal everywhere.
 */

export type Num = Prisma.Decimal | string | number;

export const D = (v: Num): Prisma.Decimal => new Prisma.Decimal(v ?? 0);

export const ZERO = D(0);

/** Money: 2 dp, half-up (Indian invoicing convention). */
export const money = (v: Num): Prisma.Decimal =>
  D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Quantity: 3 dp — loose tablets and ml fractions are real. */
export const qty = (v: Num): Prisma.Decimal =>
  D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

/** Rate/percentage: 2 dp. */
export const pct = (v: Num): Prisma.Decimal =>
  D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export const sum = (xs: Num[]): Prisma.Decimal =>
  xs.reduce<Prisma.Decimal>((a, b) => a.plus(D(b)), ZERO);

export const isZero = (v: Num) => D(v).isZero();
export const gt = (a: Num, b: Num) => D(a).greaterThan(D(b));
export const gte = (a: Num, b: Num) => D(a).greaterThanOrEqualTo(D(b));
export const lt = (a: Num, b: Num) => D(a).lessThan(D(b));

/**
 * Bill-level rounding. Applied ONCE on the invoice total, never
 * per line — per-line rounding is what makes a bill's lines fail
 * to add up to its total.
 */
export function roundBill(net: Prisma.Decimal): {
  rounded: Prisma.Decimal;
  roundOff: Prisma.Decimal;
} {
  const rounded = net.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return { rounded: money(rounded), roundOff: money(rounded.minus(net)) };
}

/** ₹ formatting for print/UI only. Never feed this back into a calculation. */
export const inr = (v: Num) =>
  "₹" +
  money(v)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
