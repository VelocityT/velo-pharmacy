import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import {
  createSaleReturn, createPurchaseReturn, returnableBatches, ReturnError,
} from "@velocare/core/server/services/return.service";
import { InsufficientStockError, StoreOwnershipError } from "@velocare/core/server/services/stock.service";

/**
 * GET  /api/returns?type=sale&billNo=…   → the bill, with returnable qty per line
 * GET  /api/returns?type=purchase&storeId=… → batches worth sending back
 * POST /api/returns?type=sale|purchase
 */

const SALE_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PHARMACIST"];
const PURCHASE_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PURCHASE_OFFICER"];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "sale";

  const auth = await requireAuth(req, type === "sale" ? SALE_ROLES : PURCHASE_ROLES);
  if ("error" in auth) return auth.error;
  const h = auth.user.hospitalId;

  if (type === "sale") {
    const billNo = url.searchParams.get("billNo");
    if (!billNo) return NextResponse.json({ error: "Enter a bill number." }, { status: 422 });

    const sale = await prisma.sale.findFirst({
      where: { hospitalId: h, billNo },
      include: {
        lines: true,
        store: { select: { code: true, name: true } },
        patient: { select: { name: true, phone: true } },
      },
    });
    if (!sale) return NextResponse.json({ error: `No bill found with number ${billNo}.` }, { status: 404 });
    if (sale.isCancelled) {
      return NextResponse.json({ error: "This bill is cancelled." }, { status: 422 });
    }

    const [items, batches] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: sale.lines.map((l) => l.itemId) } },
        select: { id: true, name: true, schedule: true },
      }),
      prisma.batch.findMany({
        where: { id: { in: sale.lines.map((l) => l.batchId) } },
        select: { id: true, batchNo: true, expiryDate: true },
      }),
    ]);

    return NextResponse.json({
      sale: {
        id: sale.id,
        billNo: sale.billNo,
        billDate: sale.billDate,
        netAmount: Number(sale.netAmount),
        store: sale.store,
        customer: sale.patient?.name ?? sale.customerName ?? "Walk-in",
        lines: sale.lines.map((l) => {
          const it = items.find((i) => i.id === l.itemId);
          const b = batches.find((x) => x.id === l.batchId);
          return {
            id: l.id,
            itemId: l.itemId,
            itemName: it?.name ?? "—",
            schedule: it?.schedule ?? "NONE",
            batchId: l.batchId,
            batchNo: b?.batchNo ?? "",
            expiryDate: b?.expiryDate ?? null,
            qty: Number(l.qty),
            qtyReturned: Number(l.qtyReturned),
            returnable: Number(l.qty) - Number(l.qtyReturned),
            rate: Number(l.rate),
            mrp: Number(l.mrp),
            lineTotal: Number(l.lineTotal),
          };
        }),
      },
    });
  }

  // Purchase return: what's worth sending back, plus who to send it to.
  const storeId = url.searchParams.get("storeId");
  const withinDays = Number(url.searchParams.get("days") ?? 90);

  const [stores, suppliers] = await Promise.all([
    prisma.store.findMany({
      where: { hospitalId: h, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.supplier.findMany({
      where: { hospitalId: h, deletedAt: null, isActive: true },
      select: { id: true, name: true, stateCode: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const batches = storeId ? await returnableBatches(h, storeId, withinDays) : [];

  return NextResponse.json({
    stores,
    suppliers,
    batches: batches.map((b) => ({
      ...b,
      quantity: Number(b.quantity),
      purchaseRate: Number(b.purchaseRate),
      value: Number(b.value),
      daysLeft: Number(b.daysLeft),
    })),
  });
}

const saleSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().max(200).optional(),
  lines: z
    .array(z.object({ saleLineId: z.string().min(1), quantity: z.coerce.number().positive() }))
    .min(1, "Select at least one line."),
});

const purchaseSchema = z.object({
  supplierId: z.string().min(1, "Select a supplier."),
  storeId: z.string().min(1, "Select a store."),
  reason: z.enum(["EXPIRY", "NEAR_EXPIRY", "DAMAGE", "WRONG_SUPPLY", "RECALL"]),
  remarks: z.string().max(400).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        batchId: z.string().min(1),
        quantity: z.coerce.number().positive(),
        rate: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1, "Select at least one batch."),
});

export async function POST(req: NextRequest) {
  const type = new URL(req.url).searchParams.get("type") ?? "sale";
  const auth = await requireAuth(req, type === "sale" ? SALE_ROLES : PURCHASE_ROLES);
  if ("error" in auth) return auth.error;

  const ctx = { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId };
  const body = await req.json().catch(() => null);

  try {
    if (type === "sale") {
      const p = saleSchema.safeParse(body);
      if (!p.success) return badRequest(p.error);
      const ret = await createSaleReturn(ctx, { ...p.data, clientUuid: crypto.randomUUID() });
      return NextResponse.json({ return: ret }, { status: 201 });
    }

    const p = purchaseSchema.safeParse(body);
    if (!p.success) return badRequest(p.error);
    const ret = await createPurchaseReturn(ctx, { ...p.data, clientUuid: crypto.randomUUID() });
    return NextResponse.json({ return: ret }, { status: 201 });
  } catch (e) {
    if (e instanceof ReturnError) {
      return NextResponse.json({ error: e.message, code: "RETURN_RULE" }, { status: 422 });
    }
    if (e instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: e.message, code: "INSUFFICIENT_STOCK" },
        { status: 409 },
      );
    }
    if (e instanceof StoreOwnershipError) {
      return NextResponse.json({ error: e.message, code: "STORE_OWNERSHIP" }, { status: 409 });
    }
    console.error(`[POST /api/returns?type=${type}]`, e);
    return NextResponse.json(
      { error: "Could not post the return.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function badRequest(err: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const i of err.issues) errors[i.path.join(".")] = i.message;
  return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
}
