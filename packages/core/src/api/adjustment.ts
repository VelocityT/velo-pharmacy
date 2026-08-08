import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import {
  createAdjustment, approveAdjustment, countSheet, AdjustmentError,
} from "@velocare/core/server/services/adjustment.service";
import { InsufficientStockError, StoreOwnershipError } from "@velocare/core/server/services/stock.service";

/**
 * GET   /api/adjustment?storeId=…&expiredOnly=  → count sheet
 * GET   /api/adjustment?id=…                    → one adjustment
 * POST  /api/adjustment                         → create as DRAFT
 * PATCH /api/adjustment?id=…&action=approve     → post to the ledger
 */

const CREATE_ROLES = [
  "SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "STORE_KEEPER", "PHARMACIST",
];
// Approving is deliberately narrower than creating. Anyone who can
// silently write stock off is anyone who can steal.
const APPROVE_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER"];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, CREATE_ROLES);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const h = auth.user.hospitalId;

  if (id) {
    const adj = await prisma.stockAdjustment.findFirst({
      where: { id, hospitalId: h },
      include: { lines: true },
    });
    if (!adj) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const [items, batches, creator] = await Promise.all([
      prisma.item.findMany({
        where: { id: { in: adj.lines.map((l) => l.itemId) } },
        select: { id: true, name: true, code: true },
      }),
      prisma.batch.findMany({
        where: { id: { in: adj.lines.map((l) => l.batchId) } },
        select: { id: true, batchNo: true, expiryDate: true },
      }),
      prisma.user.findUnique({ where: { id: adj.createdBy }, select: { name: true } }),
    ]);

    return NextResponse.json({
      adjustment: {
        ...adj,
        createdByName: creator?.name ?? "—",
        lines: adj.lines.map((l) => ({
          ...l,
          itemName: items.find((i) => i.id === l.itemId)?.name ?? "—",
          itemCode: items.find((i) => i.id === l.itemId)?.code ?? "",
          batchNo: batches.find((b) => b.id === l.batchId)?.batchNo ?? "",
          expiryDate: batches.find((b) => b.id === l.batchId)?.expiryDate ?? null,
        })),
      },
      canApprove: APPROVE_ROLES.includes(auth.user.role) && adj.createdBy !== auth.user.id,
    });
  }

  const storeId = url.searchParams.get("storeId");
  const expiredOnly = url.searchParams.get("expiredOnly") === "true";

  const stores = await prisma.store.findMany({
    where: { hospitalId: h, deletedAt: null, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  const rows = storeId ? await countSheet(h, storeId, expiredOnly) : [];

  return NextResponse.json({
    stores,
    rows: rows.map((r) => ({
      ...r,
      systemQty: Number(r.systemQty),
      rate: Number(r.rate),
      value: Number(r.value),
    })),
  });
}

const schema = z.object({
  storeId: z.string().min(1, "Select a store."),
  reason: z.enum(["EXPIRY", "BREAKAGE", "THEFT", "PHYSICAL_COUNT", "RECALL", "OTHER"]),
  remarks: z.string().max(400).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        batchId: z.string().min(1),
        actualQty: z.coerce.number().min(0),
      }),
    )
    .min(1, "Add at least one line."),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, CREATE_ROLES);
  if ("error" in auth) return auth.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
  }

  try {
    const adj = await createAdjustment(
      { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId },
      parsed.data,
    );
    return NextResponse.json({ adjustment: adj }, { status: 201 });
  } catch (e) {
    return mapError(e, "create the adjustment");
  }
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  if (!id || action !== "approve") {
    return NextResponse.json({ error: "Missing id, or unsupported action." }, { status: 400 });
  }

  const auth = await requireAuth(req, APPROVE_ROLES);
  if ("error" in auth) return auth.error;

  try {
    const adj = await approveAdjustment(
      { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId },
      id,
    );
    return NextResponse.json({ adjustment: adj });
  } catch (e) {
    return mapError(e, "approve the adjustment");
  }
}

function mapError(e: unknown, what: string) {
  if (e instanceof AdjustmentError) {
    return NextResponse.json({ error: e.message, code: "ADJ_RULE" }, { status: 422 });
  }
  if (e instanceof InsufficientStockError) {
    return NextResponse.json({ error: e.message, code: "INSUFFICIENT_STOCK" }, { status: 409 });
  }
  if (e instanceof StoreOwnershipError) {
    return NextResponse.json({ error: e.message, code: "STORE_OWNERSHIP" }, { status: 409 });
  }
  console.error(`[adjustment: ${what}]`, e);
  return NextResponse.json(
    { error: `Could not ${what}.`, detail: e instanceof Error ? e.message : String(e) },
    { status: 500 },
  );
}
