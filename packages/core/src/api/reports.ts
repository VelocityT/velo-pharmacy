import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";

/**
 * GET /api/reports/<report>?from=&to=
 *
 * Reports are read-only aggregates, so they live apart from the list
 * engine: they have date ranges, grand totals, and a CSV export that
 * an accountant actually opens in Excel.
 *
 * The GST reports are deliberately framed as "what your CA needs to
 * file", not "filed returns". We are not a GST filing utility, and
 * pretending otherwise creates a liability nobody wants.
 */

const FINANCE = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "ACCOUNTANT", "AUDITOR"];

interface ReportDef {
  title: string;
  subtitle: string;
  roles: string[];
  columns: Array<{ key: string; label: string; type?: "money" | "qty" | "date" | "badge"; align?: "right" }>;
  /** Money columns to grand-total in the footer. */
  totals?: string[];
  sql: (p: { hospitalId: string; from: string; to: string }) => Prisma.Sql;
}

export const REPORTS: Record<string, ReportDef> = {
  "gstr1-b2c": {
    title: "GSTR-1 · B2C Summary",
    subtitle: "Rate-wise outward supplies to unregistered persons — what your CA files from",
    roles: FINANCE,
    totals: ["taxableAmt", "cgst", "sgst", "igst", "total"],
    columns: [
      { key: "gstRate", label: "Rate %", type: "qty", align: "right" },
      { key: "invoices", label: "Invoices", type: "qty", align: "right" },
      { key: "taxableAmt", label: "Taxable Value", type: "money", align: "right" },
      { key: "cgst", label: "CGST", type: "money", align: "right" },
      { key: "sgst", label: "SGST", type: "money", align: "right" },
      { key: "igst", label: "IGST", type: "money", align: "right" },
      { key: "total", label: "Invoice Value", type: "money", align: "right" },
    ],
    sql: ({ hospitalId, from, to }) => Prisma.sql`
      SELECT sl."gstRate",
             COUNT(DISTINCT s."id")            AS invoices,
             SUM(sl."taxableAmt")              AS "taxableAmt",
             SUM(sl."gstAmt") / 2              AS cgst,
             SUM(sl."gstAmt") - SUM(sl."gstAmt") / 2 AS sgst,
             0::numeric                        AS igst,
             SUM(sl."lineTotal")               AS total
      FROM sale_lines sl
      JOIN sales s ON s."id" = sl."saleId"
      WHERE s."hospitalId" = ${hospitalId}
        AND s."isCancelled" = FALSE
        AND s."billDate" >= ${from}::date
        AND s."billDate" <  ${to}::date + INTERVAL '1 day'
      GROUP BY sl."gstRate"
      ORDER BY sl."gstRate"
    `,
  },

  "hsn-summary": {
    title: "HSN Summary",
    subtitle: "The annexure GSTR-1 requires — HSN-wise quantity and tax",
    roles: FINANCE,
    totals: ["taxableAmt", "cgst", "sgst", "total"],
    columns: [
      { key: "hsnCode", label: "HSN" },
      { key: "description", label: "Description" },
      { key: "uqc", label: "UQC" },
      { key: "qty", label: "Quantity", type: "qty", align: "right" },
      { key: "gstRate", label: "Rate %", type: "qty", align: "right" },
      { key: "taxableAmt", label: "Taxable Value", type: "money", align: "right" },
      { key: "cgst", label: "CGST", type: "money", align: "right" },
      { key: "sgst", label: "SGST", type: "money", align: "right" },
      { key: "total", label: "Total", type: "money", align: "right" },
    ],
    sql: ({ hospitalId, from, to }) => Prisma.sql`
      SELECT COALESCE(i."hsnCode", 'UNMAPPED')  AS "hsnCode",
             MIN(i."name")                      AS description,
             MIN(i."unitOfSale")                AS uqc,
             SUM(sl."qty")                      AS qty,
             sl."gstRate",
             SUM(sl."taxableAmt")               AS "taxableAmt",
             SUM(sl."gstAmt") / 2               AS cgst,
             SUM(sl."gstAmt") - SUM(sl."gstAmt") / 2 AS sgst,
             SUM(sl."lineTotal")                AS total
      FROM sale_lines sl
      JOIN sales s ON s."id" = sl."saleId"
      JOIN items i ON i."id" = sl."itemId"
      WHERE s."hospitalId" = ${hospitalId}
        AND s."isCancelled" = FALSE
        AND s."billDate" >= ${from}::date
        AND s."billDate" <  ${to}::date + INTERVAL '1 day'
      GROUP BY COALESCE(i."hsnCode", 'UNMAPPED'), sl."gstRate"
      ORDER BY 1
    `,
  },

  "purchase-register": {
    title: "Purchase Register",
    subtitle: "Input tax credit — inward supplies for GSTR-2 reconciliation",
    roles: FINANCE,
    totals: ["taxableAmt", "gst", "netAmount"],
    columns: [
      { key: "grnDate", label: "Date", type: "date" },
      { key: "grnNo", label: "GRN No" },
      { key: "supplier", label: "Supplier" },
      { key: "gstin", label: "GSTIN" },
      { key: "invoiceNo", label: "Invoice No" },
      { key: "taxableAmt", label: "Taxable", type: "money", align: "right" },
      { key: "gst", label: "GST", type: "money", align: "right" },
      { key: "netAmount", label: "Invoice Value", type: "money", align: "right" },
    ],
    sql: ({ hospitalId, from, to }) => Prisma.sql`
      SELECT g."grnDate", g."grnNo", sup."name" AS supplier,
             COALESCE(sup."gstin", '—') AS gstin,
             g."supplierInvoiceNo" AS "invoiceNo",
             g."taxableAmt",
             (g."cgstAmt" + g."sgstAmt" + g."igstAmt") AS gst,
             g."netAmount"
      FROM grns g
      JOIN suppliers sup ON sup."id" = g."supplierId"
      WHERE g."hospitalId" = ${hospitalId}
        AND g."isPosted" = TRUE
        AND g."grnDate" >= ${from}::date
        AND g."grnDate" <  ${to}::date + INTERVAL '1 day'
      ORDER BY g."grnDate" DESC
    `,
  },

  "day-book": {
    title: "Day Book",
    subtitle: "Every transaction, day by day — the first thing an owner checks",
    roles: FINANCE,
    totals: ["sales", "purchases"],
    columns: [
      { key: "d", label: "Date", type: "date" },
      { key: "bills", label: "Bills", type: "qty", align: "right" },
      { key: "sales", label: "Sales", type: "money", align: "right" },
      { key: "grns", label: "GRNs", type: "qty", align: "right" },
      { key: "purchases", label: "Purchases", type: "money", align: "right" },
    ],
    sql: ({ hospitalId, from, to }) => Prisma.sql`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date, '1 day')::date AS d
      )
      SELECT days.d,
             COALESCE(s.bills, 0)      AS bills,
             COALESCE(s.total, 0)      AS sales,
             COALESCE(g.grns, 0)       AS grns,
             COALESCE(g.total, 0)      AS purchases
      FROM days
      LEFT JOIN (
        SELECT "billDate"::date AS d, count(*) AS bills, SUM("netAmount") AS total
        FROM sales WHERE "hospitalId" = ${hospitalId} AND "isCancelled" = FALSE
        GROUP BY 1
      ) s ON s.d = days.d
      LEFT JOIN (
        SELECT "grnDate"::date AS d, count(*) AS grns, SUM("netAmount") AS total
        FROM grns WHERE "hospitalId" = ${hospitalId} AND "isPosted" = TRUE
        GROUP BY 1
      ) g ON g.d = days.d
      WHERE COALESCE(s.bills,0) > 0 OR COALESCE(g.grns,0) > 0
      ORDER BY days.d DESC
    `,
  },

  "supplier-outstanding": {
    title: "Supplier Outstanding",
    subtitle: "What you owe, and how overdue it is",
    roles: FINANCE,
    totals: ["purchased", "paid", "outstanding"],
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "creditDays", label: "Credit Days", type: "qty", align: "right" },
      { key: "invoices", label: "Invoices", type: "qty", align: "right" },
      { key: "purchased", label: "Purchased", type: "money", align: "right" },
      { key: "paid", label: "Paid", type: "money", align: "right" },
      { key: "outstanding", label: "Outstanding", type: "money", align: "right" },
      { key: "oldestDays", label: "Oldest (days)", type: "qty", align: "right" },
    ],
    sql: ({ hospitalId, from, to }) => Prisma.sql`
      SELECT sup."name" AS supplier, sup."creditDays",
             COUNT(g."id")                          AS invoices,
             COALESCE(SUM(g."netAmount"), 0)        AS purchased,
             COALESCE(SUM(pay.paid), 0)             AS paid,
             COALESCE(SUM(g."netAmount"), 0) - COALESCE(SUM(pay.paid), 0) + sup."openingBal" AS outstanding,
             COALESCE(MAX(CURRENT_DATE - g."grnDate"::date), 0) AS "oldestDays"
      FROM suppliers sup
      LEFT JOIN grns g
        ON g."supplierId" = sup."id" AND g."isPosted" = TRUE
       AND g."grnDate" >= ${from}::date
       AND g."grnDate" <  ${to}::date + INTERVAL '1 day'
      LEFT JOIN (
        SELECT "grnId", SUM("amount") AS paid FROM supplier_payments GROUP BY 1
      ) pay ON pay."grnId" = g."id"
      WHERE sup."hospitalId" = ${hospitalId} AND sup."deletedAt" IS NULL
      GROUP BY sup."id", sup."name", sup."creditDays", sup."openingBal"
      HAVING COUNT(g."id") > 0 OR sup."openingBal" <> 0
      ORDER BY outstanding DESC
    `,
  },

  "stock-valuation": {
    title: "Stock Valuation",
    subtitle: "Closing stock at cost — the figure your balance sheet needs",
    roles: FINANCE,
    totals: ["costValue", "mrpValue"],
    columns: [
      { key: "store", label: "Store" },
      { key: "category", label: "Category" },
      { key: "batches", label: "Batches", type: "qty", align: "right" },
      { key: "units", label: "Units", type: "qty", align: "right" },
      { key: "costValue", label: "Value at Cost", type: "money", align: "right" },
      { key: "mrpValue", label: "Value at MRP", type: "money", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT st."code" AS store, c."name" AS category,
             COUNT(*)                                  AS batches,
             SUM(sb."quantity")                        AS units,
             SUM(sb."quantity" * b."purchaseRate")     AS "costValue",
             SUM(sb."quantity" * b."mrp")              AS "mrpValue"
      FROM stock_balances sb
      JOIN batches b        ON b."id" = sb."batchId"
      JOIN items i          ON i."id" = sb."itemId"
      JOIN item_categories c ON c."id" = i."categoryId"
      JOIN stores st        ON st."id" = sb."storeId"
      WHERE sb."hospitalId" = ${hospitalId} AND sb."quantity" > 0
      GROUP BY st."code", c."name"
      ORDER BY "costValue" DESC
    `,
  },
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ report: string }> }) {
  const { report } = await ctx.params;
  const def = REPORTS[report];
  if (!def) return NextResponse.json({ error: `Unknown report '${report}'.` }, { status: 404 });

  const auth = await requireAuth(req, def.roles);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const from = url.searchParams.get("from") || monthStart;
  const to = url.searchParams.get("to") || today;

  try {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>(
      def.sql({ hospitalId: auth.user.hospitalId, from, to }),
    );

    const clean = rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          typeof v === "bigint" ? Number(v) : v instanceof Prisma.Decimal ? Number(v) : v,
        ]),
      ),
    );

    const totals = def.totals
      ? Object.fromEntries(
          def.totals.map((k) => [k, clean.reduce((a, r) => a + Number(r[k] ?? 0), 0)]),
        )
      : null;

    // CSV export — an accountant will open this in Excel, not the app.
    if (url.searchParams.get("format") === "csv") {
      const head = def.columns.map((c) => c.label).join(",");
      const body = clean
        .map((r) =>
          def.columns
            .map((c) => {
              const v = r[c.key];
              const s = v == null ? "" : String(v);
              return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(","),
        )
        .join("\n");
      return new NextResponse(`${def.title}\n${from} to ${to}\n\n${head}\n${body}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report}-${from}-to-${to}.csv"`,
        },
      });
    }

    return NextResponse.json({
      report,
      title: def.title,
      subtitle: def.subtitle,
      columns: def.columns,
      from,
      to,
      rows: clean,
      totals,
    });
  } catch (e) {
    console.error(`[GET /api/reports/${report}]`, e);
    return NextResponse.json(
      { error: "Could not run this report.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
