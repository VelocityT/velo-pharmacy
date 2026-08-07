import { NextResponse } from "next/server";
import { prisma } from "@velocare/core/lib/db";
import { env } from "@velocare/core/lib/env";

/**
 * GET /api/health
 *
 * Hit this first after every deploy. It separates "the app didn't
 * build" from "the app is up but can't reach the database" — which
 * are the two failure modes, and they look identical from the login
 * screen.
 */
export async function GET() {
  const started = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    const [hospitals, items, stores] = await Promise.all([
      prisma.hospital.count(),
      prisma.item.count(),
      prisma.store.count(),
    ]);

    return NextResponse.json({
      status: "ok",
      mode: env.NODE_MODE,
      database: "connected",
      latencyMs: Date.now() - started,
      seeded: hospitals > 0,
      counts: { hospitals, stores, items },
      hint:
        hospitals === 0
          ? "Database is reachable but empty. Run: npm run db:seed"
          : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: "error",
        mode: env.NODE_MODE,
        database: "unreachable",
        latencyMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
        hint:
          "Check DATABASE_URL. On a serverless host it must be the POOLED connection string, not the direct one.",
      },
      { status: 503 },
    );
  }
}
