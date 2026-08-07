import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth, requireStoreAccess } from "@velocare/core/server/auth";

/**
 * GET /api/items/search?q=&storeId=
 *
 * Counter search. Returns only batches that are actually in stock at
 * THIS store — a pharmacist must never be offered something the shelf
 * in front of them does not have.
 *
 * Match order matters at a counter: barcode exact first (a scan should
 * be instant and unambiguous), then item name, then salt so
 * "paracetamol" finds Crocin. Ordered by expiry so the FEFO batch is
 * the one at the top of the list — what the pharmacist sees is what
 * the server will allocate.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const storeId = searchParams.get("storeId") ?? "";
  const limit = Math.min(Number(searchParams.get("limit") ?? 20), 50);

  if (!storeId) return NextResponse.json({ error: "storeId is required." }, { status: 422 });
  if (q.length < 2) return NextResponse.json({ items: [] });

  if (!(await requireStoreAccess(auth.user, storeId))) {
    return NextResponse.json({ error: "No access to this store." }, { status: 403 });
  }

  const like = `%${q}%`;

  const items = await prisma.$queryRaw<
    Array<{
      itemId: string;
      itemName: string;
      batchId: string;
      batchNo: string;
      expiryDate: Date;
      quantity: Prisma.Decimal;
      mrp: Prisma.Decimal;
      saleRate: Prisma.Decimal;
      gstRate: Prisma.Decimal;
      schedule: string;
      barcode: string | null;
    }>
  >(Prisma.sql`
    SELECT DISTINCT
      i."id"        AS "itemId",
      i."name"      AS "itemName",
      b."id"        AS "batchId",
      b."batchNo"   AS "batchNo",
      b."expiryDate" AS "expiryDate",
      (sb."quantity" - sb."reserved") AS "quantity",
      b."mrp"       AS "mrp",
      b."saleRate"  AS "saleRate",
      i."gstRate"   AS "gstRate",
      i."schedule"::text AS "schedule",
      i."barcode"   AS "barcode"
    FROM "stock_balances" sb
    JOIN "batches" b ON b."id" = sb."batchId"
    JOIN "items"   i ON i."id" = sb."itemId"
    LEFT JOIN "item_salts" isl ON isl."itemId" = i."id"
    LEFT JOIN "salts" s        ON s."id" = isl."saltId"
    WHERE sb."hospitalId" = ${auth.user.hospitalId}
      AND sb."storeId"    = ${storeId}
      AND (sb."quantity" - sb."reserved") > 0
      AND b."expiryDate" > NOW()
      AND i."isActive" = TRUE
      AND i."deletedAt" IS NULL
      AND (
        i."barcode" = ${q}
        OR i."name" ILIKE ${like}
        OR i."code" ILIKE ${like}
        OR s."name" ILIKE ${like}
      )
    ORDER BY
      CASE WHEN i."barcode" = ${q} THEN 0 ELSE 1 END,
      b."expiryDate" ASC
    LIMIT ${limit}
  `);

  // Shape matches StockSnapshotRow so the UI renders online and
  // offline results through exactly one code path.
  return NextResponse.json({
    items: items.map((r) => ({
      key: `${r.itemId}:${r.batchId}`,
      itemId: r.itemId,
      itemName: r.itemName,
      batchId: r.batchId,
      batchNo: r.batchNo,
      expiryDate: r.expiryDate.toISOString().slice(0, 10),
      quantity: Number(r.quantity),
      mrp: r.mrp.toString(),
      saleRate: r.saleRate.toString(),
      gstRate: r.gstRate.toString(),
      schedule: r.schedule,
      barcode: r.barcode ?? undefined,
    })),
  });
}
