import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth, requireStoreAccess } from "@velocare/core/server/auth";

/**
 * GET /api/stock/snapshot?storeId=
 *
 * The offline lifeline. Pulls this store's entire live stock so the
 * counter can search, FEFO-allocate and price a bill with no network.
 *
 * Without this the offline mode is decorative — IndexedDB would be
 * empty and an offline search would return nothing.
 *
 * Scoped to ONE store on purpose. A counter has no business holding a
 * copy of the ICU's stock, and the smaller payload keeps the refresh
 * cheap enough to run every few minutes.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  const storeId = new URL(req.url).searchParams.get("storeId") ?? "";
  if (!storeId) return NextResponse.json({ error: "storeId is required." }, { status: 422 });

  if (!(await requireStoreAccess(auth.user, storeId))) {
    return NextResponse.json({ error: "No access to this store." }, { status: 403 });
  }

  const rows = await prisma.$queryRaw<
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
    SELECT
      i."id" AS "itemId", i."name" AS "itemName",
      b."id" AS "batchId", b."batchNo" AS "batchNo", b."expiryDate" AS "expiryDate",
      (sb."quantity" - sb."reserved") AS "quantity",
      b."mrp" AS "mrp", b."saleRate" AS "saleRate",
      i."gstRate" AS "gstRate", i."schedule"::text AS "schedule", i."barcode" AS "barcode"
    FROM "stock_balances" sb
    JOIN "batches" b ON b."id" = sb."batchId"
    JOIN "items"   i ON i."id" = sb."itemId"
    WHERE sb."hospitalId" = ${auth.user.hospitalId}
      AND sb."storeId"    = ${storeId}
      AND (sb."quantity" - sb."reserved") > 0
      AND b."expiryDate" > NOW()
      AND i."isActive" = TRUE
      AND i."deletedAt" IS NULL
    ORDER BY i."name" ASC, b."expiryDate" ASC
  `);

  const snapshotAt = Date.now();

  return NextResponse.json({
    snapshotAt,
    count: rows.length,
    rows: rows.map((r) => ({
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
      snapshotAt,
    })),
  });
}
