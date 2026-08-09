import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import { cancelSale, DispensingError } from "@velocare/core/server/services/sale.service";
import { traceBatch } from "@velocare/core/server/services/stock.service";

/**
 * GET  /api/recall?batchId=…   → every patient who received this batch
 * GET  /api/recall?q=…         → find batches by number or item name
 * POST /api/recall?cancel=…    → cancel a bill (reversal, never a delete)
 *
 * The recall trace is the question a drug inspector actually asks —
 * "who received batch XYZ123?" — and the reason stock is modelled as
 * an append-only ledger rather than a quantity column. Marg cannot
 * answer it, which makes this a genuine differentiator, not a
 * checkbox feature.
 */

const ROLES = [
  "SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PHARMACIST", "AUDITOR",
];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ROLES);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId");
  const q = (url.searchParams.get("q") ?? "").trim();
  const h = auth.user.hospitalId;

  if (!batchId) {
    if (q.length < 2) return NextResponse.json({ batches: [] });

    const batches = await prisma.$queryRaw<
      Array<{
        batchId: string; batchNo: string; itemName: string;
        expiryDate: Date; onHand: Prisma.Decimal; dispensed: Prisma.Decimal;
      }>
    >(Prisma.sql`
      SELECT b."id" AS "batchId", b."batchNo", i."name" AS "itemName", b."expiryDate",
             COALESCE((SELECT SUM(sb."quantity") FROM stock_balances sb WHERE sb."batchId"=b."id"),0) AS "onHand",
             COALESCE((SELECT SUM(sl."qty") FROM sale_lines sl
                       JOIN sales s ON s."id"=sl."saleId"
                       WHERE sl."batchId"=b."id" AND s."isCancelled"=FALSE),0) AS dispensed
      FROM batches b
      JOIN items i ON i."id"=b."itemId"
      WHERE b."hospitalId"=${h}
        AND (b."batchNo" ILIKE ${"%" + q + "%"} OR i."name" ILIKE ${"%" + q + "%"})
      ORDER BY b."expiryDate" DESC
      LIMIT 25
    `);

    return NextResponse.json({
      batches: batches.map((b) => ({
        ...b,
        onHand: Number(b.onHand),
        dispensed: Number(b.dispensed),
      })),
    });
  }

  const [batch, patients, movements] = await Promise.all([
    prisma.batch.findFirst({
      where: { id: batchId, hospitalId: h },
      select: {
        batchNo: true, expiryDate: true, mfgDate: true, mrp: true, purchaseRate: true,
        item: { select: { name: true, code: true, schedule: true } },
      },
    }),

    // The trace itself — one implementation, in stock.service.
    traceBatch(
      prisma as unknown as Parameters<typeof traceBatch>[0],
      { hospitalId: h, userId: auth.user.id, nodeId: auth.nodeId },
      batchId,
    ),

    prisma.$queryRaw<
      Array<{ txnType: string; qtyIn: Prisma.Decimal; qtyOut: Prisma.Decimal; refNo: string; store: string; createdAt: Date }>
    >(Prisma.sql`
      SELECT sl."txnType"::text AS "txnType", sl."qtyIn", sl."qtyOut", sl."refNo",
             st."code" AS store, sl."createdAt"
      FROM stock_ledger sl
      JOIN stores st ON st."id" = sl."storeId"
      WHERE sl."batchId" = ${batchId} AND sl."hospitalId" = ${h}
      ORDER BY sl."createdAt" DESC
    `),
  ]);

  if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

  return NextResponse.json({
    batch: {
      ...batch,
      mrp: Number(batch.mrp),
      purchaseRate: Number(batch.purchaseRate),
    },
    // traceBatch returns `quantity`; the screen reads `qty`. Renamed
    // here rather than in the service, because the service's shape is
    // also what the CLI recall report uses.
    patients: patients.map((p) => ({ ...p, qty: Number(p.quantity) })),
    movements: movements.map((m) => ({
      ...m,
      qtyIn: Number(m.qtyIn),
      qtyOut: Number(m.qtyOut),
    })),
    summary: {
      patientsAffected: new Set(
        patients
          .filter((p) => !p.isCancelled)
          .map((p) => p.patientPhone ?? p.patientName ?? p.billNo),
      ).size,
      unitsDispensed: patients
        .filter((p) => !p.isCancelled)
        .reduce((a, p) => a + Number(p.quantity), 0),
    },
  });
}

/**
 * POST /api/recall?cancel=<saleId>
 *
 * Cancelling appends reversal movements rather than editing history.
 * The ledger keeps showing that goods left and came back, which is
 * what an auditor needs, and the bill stays queryable forever.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, [
    "SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER",
  ]);
  if ("error" in auth) return auth.error;

  const saleId = new URL(req.url).searchParams.get("cancel");
  if (!saleId) return NextResponse.json({ error: "Missing sale id." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 3) {
    return NextResponse.json(
      { error: "A reason is required to cancel a bill — it goes into the audit log." },
      { status: 422 },
    );
  }

  try {
    const sale = await cancelSale(
      { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId },
      saleId,
      reason,
    );
    return NextResponse.json({ sale });
  } catch (e) {
    if (e instanceof DispensingError) {
      return NextResponse.json({ error: e.message, code: "CANCEL_RULE" }, { status: 422 });
    }
    console.error("[POST /api/recall?cancel]", e);
    return NextResponse.json(
      { error: "Could not cancel the bill.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
