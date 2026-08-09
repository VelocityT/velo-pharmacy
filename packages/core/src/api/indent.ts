import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import {
  createIndent, approveIndent, issueIndent, receiveIndent, returnToMain, IndentError,
} from "@velocare/core/server/services/indent.service";
import { InsufficientStockError, StoreOwnershipError } from "@velocare/core/server/services/stock.service";

/**
 * GET  /api/indent            → reference data for the raise screen
 * GET  /api/indent?id=…       → one indent with lines, for approve/issue/receive
 * POST /api/indent            → raise
 * PATCH /api/indent?id=…&action=approve|issue|receive
 *
 * The four-step flow is deliberate. Goods in transit belong to neither
 * store: issuing decrements the main store, receiving increments the
 * ward, and between the two someone is accountable for the trolley.
 * A single-step transfer hides losses forever.
 */

const ROLES_RAISE = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "STORE_KEEPER", "PHARMACIST"];
const ROLES_APPROVE = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER"];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ROLES_RAISE);
  if ("error" in auth) return auth.error;

  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const indent = await prisma.indent.findFirst({
      where: { id, hospitalId: auth.user.hospitalId },
      include: {
        fromStore: { select: { code: true, name: true } },
        toStore: { select: { code: true, name: true } },
        lines: { include: { issues: true } },
      },
    });
    if (!indent) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // Attach item names and what the supplying store can actually give.
    const items = await prisma.item.findMany({
      where: { id: { in: indent.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, code: true, unitOfSale: true },
    });
    const avail = await prisma.stockBalance.groupBy({
      by: ["itemId"],
      where: { storeId: indent.fromStoreId, itemId: { in: indent.lines.map((l) => l.itemId) } },
      _sum: { quantity: true, reserved: true },
    });

    return NextResponse.json({
      indent: {
        ...indent,
        lines: indent.lines.map((l) => {
          const it = items.find((i) => i.id === l.itemId);
          const a = avail.find((x) => x.itemId === l.itemId);
          return {
            ...l,
            itemName: it?.name ?? "—",
            itemCode: it?.code ?? "",
            unitOfSale: it?.unitOfSale ?? "",
            available: Number(a?._sum.quantity ?? 0) - Number(a?._sum.reserved ?? 0),
          };
        }),
      },
    });
  }

  const [stores, items] = await Promise.all([
    prisma.store.findMany({
      where: { hospitalId: auth.user.hospitalId, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, type: true, parentStoreId: true },
      orderBy: { code: "asc" },
    }),
    prisma.item.findMany({
      where: { hospitalId: auth.user.hospitalId, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, unitOfSale: true },
      orderBy: { name: "asc" },
      take: 5000,
    }),
  ]);

  return NextResponse.json({ stores, items });
}

const createSchema = z.object({
  fromStoreId: z.string().min(1, "Select the supplying store."),
  toStoreId: z.string().min(1, "Select the requesting store."),
  isEmergency: z.boolean().default(false),
  remarks: z.string().max(400).optional(),
  lines: z
    .array(z.object({ itemId: z.string().min(1), qtyRequested: z.coerce.number().positive() }))
    .min(1, "Add at least one item."),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ROLES_RAISE);
  if ("error" in auth) return auth.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
  }

  try {
    const indent = await createIndent(
      { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId },
      { ...parsed.data, clientUuid: crypto.randomUUID() },
    );
    return NextResponse.json({ indent }, { status: 201 });
  } catch (e) {
    return mapError(e, "raise the indent");
  }
}

export async function PATCH(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  if (!id || !action) return NextResponse.json({ error: "Missing id or action." }, { status: 400 });

  // Approving is a manager decision — a storekeeper raising an indent
  // must not also be able to approve it. Separation of duties is the
  // whole point of having an approval step.
  const auth = await requireAuth(req, action === "approve" ? ROLES_APPROVE : ROLES_RAISE);
  if ("error" in auth) return auth.error;

  const ctx = { hospitalId: auth.user.hospitalId, userId: auth.user.id, nodeId: auth.nodeId };

  try {
    switch (action) {
      case "approve": {
        const body = await req.json().catch(() => ({}));
        const approvals = z
          .array(z.object({ lineId: z.string(), qtyApproved: z.coerce.number().min(0) }))
          .parse(body.approvals);
        return NextResponse.json({ indent: await approveIndent(ctx, id, approvals) });
      }
      case "issue":
        return NextResponse.json({ indent: await issueIndent(ctx, id) });
      case "receive":
        return NextResponse.json({ indent: await receiveIndent(ctx, id) });

      // Ward sends unused stock back. The common real case: issued 40,
      // consumed 30, ten strips go back on the main store's shelf
      // rather than quietly expiring in a ward cupboard.
      case "return": {
        const body = await req.json().catch(() => ({}));
        const parsed = z
          .object({
            remarks: z.string().max(300).optional(),
            lines: z
              .array(
                z.object({
                  itemId: z.string().min(1),
                  batchId: z.string().min(1),
                  quantity: z.coerce.number().positive(),
                  rate: z.coerce.number().min(0),
                }),
              )
              .min(1, "Select at least one batch to return."),
          })
          .parse(body);

        const indent = await prisma.indent.findFirst({
          where: { id, hospitalId: auth.user.hospitalId },
          select: { fromStoreId: true, toStoreId: true, status: true },
        });
        if (!indent) return NextResponse.json({ error: "Indent not found." }, { status: 404 });
        if (indent.status !== "RECEIVED") {
          return NextResponse.json(
            { error: "Only a received indent can have stock returned against it." },
            { status: 422 },
          );
        }

        return NextResponse.json({
          result: await returnToMain(ctx, {
            fromStoreId: indent.toStoreId,
            toStoreId: indent.fromStoreId,
            remarks: parsed.remarks,
            lines: parsed.lines,
          }),
        });
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 });
    }
  } catch (e) {
    return mapError(e, `${action} the indent`);
  }
}

/**
 * 4xx for things the user can fix, 5xx for things they cannot. Getting
 * this wrong means the UI either retries forever or hides a real bug.
 */
function mapError(e: unknown, what: string) {
  if (e instanceof IndentError) {
    return NextResponse.json({ error: e.message, code: "INDENT_RULE" }, { status: 422 });
  }
  if (e instanceof InsufficientStockError) {
    return NextResponse.json({ error: e.message, code: "INSUFFICIENT_STOCK" }, { status: 409 });
  }
  if (e instanceof StoreOwnershipError) {
    return NextResponse.json({ error: e.message, code: "STORE_OWNERSHIP" }, { status: 409 });
  }
  console.error(`[indent: ${what}]`, e);
  return NextResponse.json(
    { error: `Could not ${what}.`, detail: e instanceof Error ? e.message : String(e) },
    { status: 500 },
  );
}
