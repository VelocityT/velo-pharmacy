import { NextResponse } from "next/server";
import { prisma } from "@velocare/core/lib/db";
import { env } from "@velocare/core/lib/env";

/** Names only — never values. Tells you WHICH var is blank, nothing more. */
function envReport() {
  const keys = [
    "NODE_MODE", "NODE_KEY", "DATABASE_URL", "DIRECT_URL",
    "JWT_SECRET", "JWT_EXPIRES_IN", "SYNC_ENABLED", "SEQUENCE_BLOCK_SIZE",
  ];
  return Object.fromEntries(
    keys.map((k) => {
      const v = process.env[k];
      if (v === undefined) return [k, "MISSING"];
      if (v === "") return [k, "EMPTY"];
      return [k, `ok (${v.length} chars)`];
    }),
  );
}

/**
 * GET /api/health
 *
 * Hit this first after every deploy. It separates "the app didn't
 * build" from "the app is up but can't reach the database" — which
 * are the two failure modes, and they look identical from the login
 * screen.
 */
/**
 * Deliberately UNAUTHENTICATED.
 *
 * A health check that requires a login cannot tell you your login is
 * broken — which is exactly when you need it. It returns no secrets:
 * only whether each variable is set, missing or blank, and the row
 * counts, which are not sensitive.
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
      env: envReport(),
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
        // Raw process.env, NOT the validated proxy: if config is bad,
        // reading the proxy throws and we lose the diagnosis entirely.
        mode: process.env.NODE_MODE || "(unset)",
        database: "unreachable",
        latencyMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
        env: envReport(),
        hint:
          "If a variable reads EMPTY, its value is blank in Vercel — delete it, " +
          "re-add it with the value pasted, and redeploy. Vercel only injects " +
          "environment variables at deploy time.",
      },
      { status: 503 },
    );
  }
}
