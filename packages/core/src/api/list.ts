import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import { RESOURCES } from "./resources";

/**
 * GET /api/list/<resource>?q=&limit=&offset=&sort=&dir=
 *
 * One endpoint behind every list screen.
 *
 * Security posture:
 *  · WHITELIST — an unknown resource key 404s. The endpoint can never
 *    be pointed at a table it was not designed to expose.
 *  · Role check per resource, server-side. Hiding a sidebar link is
 *    not access control; anyone can curl.
 *  · hospitalId is bound into every resource's SQL as a parameter,
 *    so a tenant can never read another's rows.
 *  · Sort column is validated against the resource's declared
 *    columns before it reaches the query — never interpolated raw.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ resource: string }> },
) {
  const { resource } = await ctx.params;
  const def = RESOURCES[resource];
  if (!def) {
    return NextResponse.json({ error: `Unknown resource '${resource}'.` }, { status: 404 });
  }

  const auth = await requireAuth(req, def.roles);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const dir = url.searchParams.get("dir") === "asc" ? "ASC" : "DESC";

  // Only a column this resource actually declares may be sorted on.
  const requested = url.searchParams.get("sort");
  const sortCol = def.columns.find((c) => c.key === requested)?.key ?? def.columns[0].key;

  const base = def.sql({ hospitalId: auth.user.hospitalId });

  // Wrap the resource query so search and paging apply to its output
  // without each resource having to implement them.
  const searchable = def.columns.map((c) => c.key);
  const search =
    q && def.searchable
      ? Prisma.sql`WHERE ${Prisma.join(
          searchable.map((c) => Prisma.sql`COALESCE(t.${Prisma.raw(`"${c}"`)}::text,'') ILIKE ${"%" + q + "%"}`),
          " OR ",
        )}`
      : Prisma.empty;

  try {
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT * FROM (${base}) t
      ${search}
      ORDER BY t.${Prisma.raw(`"${sortCol}"`)} ${Prisma.raw(dir)} NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) AS count FROM (${base}) t ${search}
    `);

    return NextResponse.json({
      resource,
      title: def.title,
      subtitle: def.subtitle ?? null,
      columns: def.columns,
      searchable: def.searchable,
      total: Number(count),
      offset,
      limit,
      rows: rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k,
            typeof v === "bigint" ? Number(v) : v instanceof Prisma.Decimal ? v.toString() : v,
          ]),
        ),
      ),
    });
  } catch (e) {
    console.error(`[GET /api/list/${resource}]`, e);
    return NextResponse.json(
      { error: "Could not load this list.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
