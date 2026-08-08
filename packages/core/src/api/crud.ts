import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth, type AuthUser } from "@velocare/core/server/auth";
import { FORMS } from "./forms";

/**
 * Generic master CRUD.
 *
 *   GET    /api/crud/<form>            → field definitions + lookups
 *   POST   /api/crud/<form>            → create
 *   PATCH  /api/crud/<form>?id=…       → update
 *   DELETE /api/crud/<form>?id=…       → soft delete
 *
 * Whitelisted by the FORM registry, role-checked per form, validated
 * server-side with the same Zod schema the UI renders from.
 *
 * Nothing is ever hard-deleted. Drug records are legally required to
 * be retrievable for three years, and a "cleanup" script that
 * actually removed rows would be a compliance failure, not a tidy-up.
 */

type Ctx = { params: Promise<{ form: string }> };

/** Reference data the form's dropdowns need, fetched with the definition. */
async function lookups(hospitalId: string) {
  const [categories, manufacturers, stores] = await Promise.all([
    prisma.itemCategory.findMany({
      where: { hospitalId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.manufacturer.findMany({
      where: { hospitalId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.store.findMany({
      where: { hospitalId, deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return {
    itemCategories: categories.map((c) => ({ value: c.id, label: c.name })),
    manufacturers: manufacturers.map((m) => ({ value: m.id, label: m.name })),
    stores: stores.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  };
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { form } = await ctx.params;
  const def = FORMS[form];
  if (!def) return NextResponse.json({ error: `Unknown form '${form}'.` }, { status: 404 });

  const auth = await requireAuth(req, def.roles);
  if ("error" in auth) return auth.error;

  const id = new URL(req.url).searchParams.get("id");
  let record: unknown = null;

  if (id) {
    const model = prisma[def.model as keyof typeof prisma] as unknown as {
      findFirst: (a: object) => Promise<unknown>;
    };
    record = await model.findFirst({ where: { id, hospitalId: auth.user.hospitalId } });
  }

  return NextResponse.json({
    form,
    title: def.title,
    singular: def.singular,
    fields: def.fields,
    lookups: await lookups(auth.user.hospitalId),
    record,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return write(req, ctx, "create");
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return write(req, ctx, "update");
}

async function write(req: NextRequest, ctx: Ctx, op: "create" | "update") {
  const { form } = await ctx.params;
  const def = FORMS[form];
  if (!def) return NextResponse.json({ error: `Unknown form '${form}'.` }, { status: 404 });

  const auth = await requireAuth(req, def.roles);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = def.schema.safeParse(body);
  if (!parsed.success) {
    // Field-keyed so the form can put each message under its input.
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] = i.message;
    return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
  }

  const data = clean(parsed.data as Record<string, unknown>);
  const hospitalId = auth.user.hospitalId;
  const id = new URL(req.url).searchParams.get("id");
  const model = prisma[def.model as keyof typeof prisma] as unknown as {
    create: (a: object) => Promise<{ id: string }>;
    update: (a: object) => Promise<{ id: string }>;
    findFirst: (a: object) => Promise<{ id: string } | null>;
  };

  try {
    if (op === "update" && !id) {
      return NextResponse.json({ error: "Missing id." }, { status: 400 });
    }

    // Scope the update to this tenant BEFORE writing — Prisma's
    // update() takes a unique where, which would otherwise let an id
    // from another hospital through.
    if (op === "update") {
      const owned = await model.findFirst({ where: { id, hospitalId } });
      if (!owned) return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const record =
      op === "create"
        ? await model.create({ data: { ...data, hospitalId } })
        : await model.update({ where: { id: id! }, data });

    await prisma.auditLog.create({
      data: {
        hospitalId,
        userId: auth.user.id,
        action: op === "create" ? "CREATE" : "UPDATE",
        entityType: def.singular,
        entityId: record.id,
        newValue: data as Prisma.InputJsonValue,
        ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
      },
    });

    return NextResponse.json({ record }, { status: op === "create" ? 201 : 200 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: def.uniqueMessage ?? "A record with these details already exists." },
        { status: 409 },
      );
    }
    console.error(`[${op} /api/crud/${form}]`, e);
    return NextResponse.json(
      { error: "Could not save.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { form } = await ctx.params;
  const def = FORMS[form];
  if (!def) return NextResponse.json({ error: `Unknown form '${form}'.` }, { status: 404 });

  const auth = await requireAuth(req, def.roles);
  if ("error" in auth) return auth.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const model = prisma[def.model as keyof typeof prisma] as unknown as {
    findFirst: (a: object) => Promise<{ id: string } | null>;
    update: (a: object) => Promise<unknown>;
  };

  const owned = await model.findFirst({ where: { id, hospitalId: auth.user.hospitalId } });
  if (!owned) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Soft delete only — see the note at the top of this file.
  await model.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });

  await prisma.auditLog.create({
    data: {
      hospitalId: auth.user.hospitalId,
      userId: auth.user.id,
      action: "DELETE",
      entityType: def.singular,
      entityId: id,
    },
  });

  return NextResponse.json({ ok: true });
}

/** Strip empty strings so optional columns store NULL, not "". */
function clean(d: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === "" ? null : v]));
}

export type { AuthUser };
