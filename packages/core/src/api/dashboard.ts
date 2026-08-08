import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";

/**
 * GET /api/dashboard
 *
 * The figures a pharmacy manager actually opens the software to see,
 * in one round trip. Every number is a live query — nothing cached,
 * nothing hardcoded.
 *
 * Chosen deliberately: money in today, what's about to expire, what's
 * about to run out, and what's waiting on someone. Those four are the
 * ones that cost real money when missed.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;
  const h = auth.user.hospitalId;

  try {
    const [today, week, stock, expiry, low, indents, compliance, topItems, recent] =
      await Promise.all([
        prisma.$queryRaw<Array<{ bills: bigint; net: Prisma.Decimal | null; gst: Prisma.Decimal | null }>>(Prisma.sql`
          SELECT count(*) AS bills, SUM("netAmount") AS net,
                 SUM("cgstAmt"+"sgstAmt"+"igstAmt") AS gst
          FROM sales
          WHERE "hospitalId"=${h} AND "isCancelled"=FALSE
            AND "billDate"::date = CURRENT_DATE`),

        prisma.$queryRaw<Array<{ d: Date; net: Prisma.Decimal }>>(Prisma.sql`
          SELECT "billDate"::date AS d, SUM("netAmount") AS net
          FROM sales
          WHERE "hospitalId"=${h} AND "isCancelled"=FALSE
            AND "billDate" >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY 1 ORDER BY 1`),

        prisma.$queryRaw<Array<{ skus: bigint; units: Prisma.Decimal | null; value: Prisma.Decimal | null }>>(Prisma.sql`
          SELECT count(*) AS skus, SUM(sb."quantity") AS units,
                 SUM(sb."quantity" * b."purchaseRate") AS value
          FROM stock_balances sb JOIN batches b ON b."id"=sb."batchId"
          WHERE sb."hospitalId"=${h} AND sb."quantity" > 0`),

        prisma.$queryRaw<Array<{ bucket: string; batches: bigint; value: Prisma.Decimal | null }>>(Prisma.sql`
          SELECT CASE
                   WHEN b."expiryDate" < CURRENT_DATE THEN 'expired'
                   WHEN b."expiryDate" <= CURRENT_DATE + INTERVAL '30 days'  THEN 'd30'
                   WHEN b."expiryDate" <= CURRENT_DATE + INTERVAL '90 days'  THEN 'd90'
                   ELSE 'd180' END AS bucket,
                 count(*) AS batches,
                 SUM(sb."quantity" * b."purchaseRate") AS value
          FROM stock_balances sb JOIN batches b ON b."id"=sb."batchId"
          WHERE sb."hospitalId"=${h} AND sb."quantity" > 0
            AND b."expiryDate" <= CURRENT_DATE + INTERVAL '180 days'
          GROUP BY 1`),

        prisma.$queryRaw<Array<{ name: string; onHand: Prisma.Decimal; minStock: Prisma.Decimal }>>(Prisma.sql`
          SELECT i."name", COALESCE(SUM(sb."quantity"),0) AS "onHand", i."minStock"
          FROM items i
          LEFT JOIN stock_balances sb ON sb."itemId"=i."id"
          WHERE i."hospitalId"=${h} AND i."deletedAt" IS NULL
            AND i."isActive"=TRUE AND i."minStock" > 0
          GROUP BY i."id", i."name", i."minStock"
          HAVING COALESCE(SUM(sb."quantity"),0) <= i."minStock"
          ORDER BY (COALESCE(SUM(sb."quantity"),0) - i."minStock") ASC
          LIMIT 8`),

        prisma.$queryRaw<Array<{ status: string; n: bigint }>>(Prisma.sql`
          SELECT "status"::text AS status, count(*) AS n
          FROM indents WHERE "hospitalId"=${h}
            AND "status" IN ('SUBMITTED','APPROVED','ISSUED','PARTIALLY_ISSUED')
          GROUP BY 1`),

        prisma.$queryRaw<Array<{ h1: bigint; narcotic: bigint; missing_reg: bigint }>>(Prisma.sql`
          SELECT
            (SELECT count(*) FROM schedule_h1_register WHERE "hospitalId"=${h}) AS h1,
            (SELECT count(*) FROM narcotic_register   WHERE "hospitalId"=${h}) AS narcotic,
            (SELECT count(*) FROM doctors WHERE "hospitalId"=${h}
               AND "deletedAt" IS NULL AND ("registrationNo" IS NULL OR "registrationNo"='')) AS missing_reg`),

        prisma.$queryRaw<Array<{ name: string; qty: Prisma.Decimal; value: Prisma.Decimal }>>(Prisma.sql`
          SELECT i."name", SUM(sl."qty") AS qty, SUM(sl."lineTotal") AS value
          FROM sale_lines sl
          JOIN sales s ON s."id"=sl."saleId"
          JOIN items i ON i."id"=sl."itemId"
          WHERE s."hospitalId"=${h} AND s."isCancelled"=FALSE
            AND s."billDate" >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY i."id", i."name" ORDER BY value DESC LIMIT 5`),

        prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT s."billNo", s."billDate", s."netAmount",
                 COALESCE(p."name", s."customerName", 'Walk-in') AS customer,
                 st."code" AS store
          FROM sales s
          JOIN stores st ON st."id"=s."storeId"
          LEFT JOIN patients p ON p."id"=s."patientId"
          WHERE s."hospitalId"=${h}
          ORDER BY s."createdAt" DESC LIMIT 6`),
      ]);

    const bucket = (k: string) => expiry.find((e) => e.bucket === k);
    const n = (v: unknown) => (v == null ? 0 : Number(v));

    return NextResponse.json({
      today: {
        bills: n(today[0]?.bills),
        net: n(today[0]?.net),
        gst: n(today[0]?.gst),
      },
      week: week.map((w) => ({ date: w.d, net: n(w.net) })),
      stock: {
        skus: n(stock[0]?.skus),
        units: n(stock[0]?.units),
        value: n(stock[0]?.value),
      },
      expiry: {
        expired: { batches: n(bucket("expired")?.batches), value: n(bucket("expired")?.value) },
        d30: { batches: n(bucket("d30")?.batches), value: n(bucket("d30")?.value) },
        d90: { batches: n(bucket("d90")?.batches), value: n(bucket("d90")?.value) },
        d180: { batches: n(bucket("d180")?.batches), value: n(bucket("d180")?.value) },
      },
      lowStock: low.map((l) => ({ name: l.name, onHand: n(l.onHand), minStock: n(l.minStock) })),
      indents: Object.fromEntries(indents.map((i) => [i.status, n(i.n)])),
      compliance: {
        h1Entries: n(compliance[0]?.h1),
        narcoticEntries: n(compliance[0]?.narcotic),
        doctorsMissingRegNo: n(compliance[0]?.missing_reg),
      },
      topItems: topItems.map((t) => ({ name: t.name, qty: n(t.qty), value: n(t.value) })),
      recentBills: recent.map((r) => ({ ...r, netAmount: n(r.netAmount) })),
    });
  } catch (e) {
    console.error("[GET /api/dashboard]", e);
    return NextResponse.json(
      { error: "Could not load the dashboard.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
