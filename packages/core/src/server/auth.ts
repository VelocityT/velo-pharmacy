import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { env } from "@velocare/core/lib/env";

/**
 * Auth + authorisation.
 *
 * Two independent checks on every protected route:
 *   1. ROLE      — is this kind of user allowed to do this at all?
 *   2. STORE     — is this specific user allowed to act in this store?
 *
 * The second is not optional. A ward storekeeper holding a perfectly
 * valid token must still not be able to bill at the OPD counter, and
 * role alone cannot express that.
 */

/**
 * Lazy, like env and prisma. Reading JWT_SECRET at module load would
 * make `next build` require the signing key just to collect page data.
 */
let _secret: Uint8Array | null = null;
const secret = () => (_secret ??= new TextEncoder().encode(env.JWT_SECRET));

export interface AuthUser {
  id: string;
  hospitalId: string;
  role: UserRole;
  name: string;
}

export async function signToken(user: AuthUser, nodeId?: string | null) {
  return new SignJWT({ ...user, nodeId: nodeId ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret());
}

type AuthResult =
  | { user: AuthUser; nodeId: string | null }
  | { error: NextResponse };

/**
 * DEV-ONLY LOGIN BYPASS.
 *
 * Set AUTH_DISABLED=true in .env and every route accepts the first
 * admin user in the database without a token. Role checks are skipped
 * too, so /users and /narcotics open like everything else.
 *
 * Read straight from process.env, not the validated `env` proxy: if
 * config is broken this must still work, and that is exactly when it
 * gets used.
 *
 * Hard-refused in production. A pharmacy holds patient names,
 * prescriptions and a narcotic register; an open door to that is a
 * regulatory problem, not just a bug. Flip it off before any client
 * demo on a real server.
 */
const authDisabled = () =>
  process.env.AUTH_DISABLED === "true" && process.env.NODE_ENV !== "production";

/** The stand-in identity used while AUTH_DISABLED is on. */
let _devUser: { user: AuthUser; nodeId: string | null } | null = null;

async function devUser(): Promise<AuthResult> {
  if (_devUser) return _devUser;

  const u = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ["SUPER_ADMIN", "HOSPITAL_ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, hospitalId: true, role: true, name: true },
  });

  if (!u) {
    return {
      error: NextResponse.json(
        {
          error:
            "AUTH_DISABLED is on, but no admin user exists to impersonate. " +
            "Run: npm run db:seed",
        },
        { status: 500 },
      ),
    };
  }

  _devUser = { user: u as AuthUser, nodeId: null };
  return _devUser;
}

export async function requireAuth(
  req: NextRequest,
  allowedRoles?: UserRole[] | string[],
): Promise<AuthResult> {
  if (authDisabled()) return devUser();

  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies.get("vp_token")?.value;

  if (!token) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  try {
    const { payload } = await jwtVerify(token, secret());
    const user: AuthUser = {
      id: String(payload.id),
      hospitalId: String(payload.hospitalId),
      role: payload.role as UserRole,
      name: String(payload.name ?? ""),
    };

    if (allowedRoles?.length && !(allowedRoles as string[]).includes(user.role)) {
      return {
        error: NextResponse.json(
          { error: `Role ${user.role} is not permitted to perform this action.` },
          { status: 403 },
        ),
      };
    }

    return { user, nodeId: (payload.nodeId as string | null) ?? null };
  } catch {
    return { error: NextResponse.json({ error: "Session expired." }, { status: 401 }) };
  }
}

export async function requireStoreAccess(user: AuthUser, storeId: string): Promise<boolean> {
  // With the bypass on there is no real user, so store-level checks
  // have nothing meaningful to check against.
  if (authDisabled()) return true;

  if (user.role === "SUPER_ADMIN" || user.role === "HOSPITAL_ADMIN") {
    const store = await prisma.store.findFirst({
      where: { id: storeId, hospitalId: user.hospitalId },
      select: { id: true },
    });
    return Boolean(store);
  }

  const access = await prisma.userStore.findFirst({
    where: { userId: user.id, storeId, store: { hospitalId: user.hospitalId } },
    select: { id: true },
  });
  return Boolean(access);
}
