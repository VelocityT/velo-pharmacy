import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSale, DispensingError } from "@velocare/core/server/services/sale.service";
import { InsufficientStockError, StoreOwnershipError } from "@velocare/core/server/services/stock.service";
import { requireAuth, requireStoreAccess } from "@velocare/core/server/auth";

/**
 * POST /api/sales — post a bill.
 *
 * Authorisation is enforced HERE, in the route, not only in the UI.
 * A hidden menu item is not access control: anyone with a valid
 * token can curl the endpoint. Every route in this app checks role
 * AND store access before it does anything.
 */

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.union([z.number().positive(), z.string()]),
  batchId: z.string().optional(),
  discountPct: z.union([z.number(), z.string()]).optional(),
});

const bodySchema = z.object({
  storeId: z.string().min(1),
  saleType: z.enum(["CASH", "CREDIT_IPD", "CREDIT_TPA", "STAFF"]).optional(),
  paymentMode: z.enum(["CASH", "UPI", "CARD", "CREDIT", "MIXED"]).optional(),
  paidAmount: z.union([z.number(), z.string()]).optional(),
  patientId: z.string().optional(),
  visitId: z.string().optional(),
  rxId: z.string().optional(),
  customerName: z.string().max(120).optional(),
  customerPhone: z.string().max(20).optional(),
  lines: z.array(lineSchema).min(1, "Cannot bill an empty cart."),
  clientUuid: z.string().uuid().optional(),
  isOfflineOrigin: z.boolean().optional(),
  billDate: z.coerce.date().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, [
    "PHARMACIST",
    "PHARMACY_MANAGER",
    "HOSPITAL_ADMIN",
    "SUPER_ADMIN",
  ]);
  if ("error" in auth) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const storeOk = await requireStoreAccess(auth.user, parsed.data.storeId);
  if (!storeOk) {
    return NextResponse.json(
      { error: "You do not have access to this billing counter." },
      { status: 403 },
    );
  }

  try {
    const sale = await createSale(
      {
        hospitalId: auth.user.hospitalId,
        userId: auth.user.id,
        nodeId: auth.nodeId,
      },
      parsed.data,
    );
    return NextResponse.json({ sale }, { status: 201 });
  } catch (e) {
    // 4xx vs 5xx matters: the counter's offline queue parks 4xx for a
    // human and keeps retrying 5xx. Getting this wrong means either
    // an infinite retry loop or a silently dropped bill.
    if (e instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: e.message, code: "INSUFFICIENT_STOCK" },
        { status: 409 },
      );
    }
    if (e instanceof DispensingError) {
      return NextResponse.json({ error: e.message, code: "DISPENSING" }, { status: 422 });
    }
    if (e instanceof StoreOwnershipError) {
      return NextResponse.json({ error: e.message, code: "STORE_OWNERSHIP" }, { status: 409 });
    }
    console.error("[POST /api/sales]", e);
    return NextResponse.json({ error: "Could not post the bill." }, { status: 500 });
  }
}
