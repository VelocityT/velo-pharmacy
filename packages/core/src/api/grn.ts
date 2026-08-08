import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import { createGrn, GrnError } from "@velocare/core/server/services/grn.service";

/**
 * GET  /api/grn   → the reference data the entry screen needs
 * POST /api/grn   → post a goods receipt
 *
 * The heavy lifting is in grn.service, which was written and tested
 * first. This route only authenticates, validates shape, and maps
 * domain errors onto status codes the UI can act on.
 */

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, [
    "SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PURCHASE_OFFICER",
  ]);
  if ("error" in auth) return auth.error;

  const [suppliers, stores, items] = await Promise.all([
    prisma.supplier.findMany({
      where: { hospitalId: auth.user.hospitalId, deletedAt: null, isActive: true },
      select: { id: true, name: true, stateCode: true, gstin: true, creditDays: true },
      orderBy: { name: "asc" },
    }),
    // Only stores flagged to receive purchases. Goods enter the
    // building once, at the main store, then move by indent.
    prisma.store.findMany({
      where: {
        hospitalId: auth.user.hospitalId,
        deletedAt: null,
        isActive: true,
        canReceivePurchase: true,
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.item.findMany({
      where: { hospitalId: auth.user.hospitalId, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, gstRate: true, packing: true, hsnCode: true },
      orderBy: { name: "asc" },
      take: 5000,
    }),
  ]);

  const hospital = await prisma.hospital.findUnique({
    where: { id: auth.user.hospitalId },
    select: { stateCode: true },
  });

  return NextResponse.json({
    suppliers,
    stores,
    items: items.map((i) => ({ ...i, gstRate: Number(i.gstRate) })),
    hospitalStateCode: hospital?.stateCode ?? null,
  });
}

const lineSchema = z.object({
  itemId: z.string().min(1),
  batchNo: z.string().min(1, "Batch number is required."),
  expiryDate: z.string().min(4),
  mfgDate: z.string().optional().nullable(),
  mrp: z.coerce.number().positive("MRP must be greater than zero."),
  quantity: z.coerce.number().positive("Quantity must be greater than zero."),
  freeQty: z.coerce.number().min(0).default(0),
  rate: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  saleRate: z.coerce.number().min(0).optional().nullable(),
});

const bodySchema = z.object({
  supplierId: z.string().min(1, "Select a supplier."),
  storeId: z.string().min(1, "Select a receiving store."),
  supplierInvoiceNo: z.string().min(1, "Supplier invoice number is required."),
  supplierInvoiceDate: z.string().min(4),
  grnDate: z.string().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line."),
  clientUuid: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, [
    "SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PURCHASE_OFFICER",
  ]);
  if ("error" in auth) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
  }

  try {
    const grn = await createGrn(
      { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId },
      {
        ...parsed.data,
        supplierInvoiceDate: new Date(parsed.data.supplierInvoiceDate),
        grnDate: parsed.data.grnDate ? new Date(parsed.data.grnDate) : undefined,
        lines: parsed.data.lines.map((l) => ({
          ...l,
          expiryDate: new Date(l.expiryDate),
          mfgDate: l.mfgDate ? new Date(l.mfgDate) : undefined,
          saleRate: l.saleRate ?? undefined,
        })),
      },
    );
    return NextResponse.json({ grn }, { status: 201 });
  } catch (e) {
    // GrnError is a business rule the user can fix (expired batch,
    // duplicate invoice, rate above MRP) — 422, not 500.
    if (e instanceof GrnError) {
      return NextResponse.json({ error: e.message, code: "GRN_RULE" }, { status: 422 });
    }
    console.error("[POST /api/grn]", e);
    return NextResponse.json(
      { error: "Could not post the goods receipt.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
