import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@velocare/core/lib/db";
import { signToken } from "@velocare/core/server/auth";
import { env } from "@velocare/core/lib/env";

/**
 * POST /api/auth/login
 *
 * Returns the token as an httpOnly cookie AND the list of stores the
 * user may transact in. The counter needs that list up front because
 * an offline session cannot go and ask later.
 *
 * The bcrypt compare runs even when the email is unknown, so response
 * timing does not reveal which emails exist.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  /** Which physical node this browser is. Set on offline-capable counters. */
  nodeKey: z.string().optional(),
});

const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 422 });
  }

  const { email, password, nodeKey } = parsed.data;

  const user = await prisma.user.findFirst({
    where: { email, isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      hospitalId: true,
      role: true,
      passwordHash: true,
      storeAccess: {
        select: {
          store: {
            select: { id: true, code: true, name: true, type: true, canBillPatient: true },
          },
        },
      },
    },
  });

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  // Admins get every store; everyone else only what UserStore grants.
  const stores =
    user.role === "HOSPITAL_ADMIN" || user.role === "SUPER_ADMIN"
      ? await prisma.store.findMany({
          where: { hospitalId: user.hospitalId, isActive: true, deletedAt: null },
          select: { id: true, code: true, name: true, type: true, canBillPatient: true },
        })
      : user.storeAccess.map((a) => a.store);

  let nodeId: string | null = null;
  if (nodeKey) {
    const node = await prisma.syncNode.findFirst({
      where: { hospitalId: user.hospitalId, nodeKey, isActive: true },
      select: { id: true },
    });
    nodeId = node?.id ?? null;
  }

  const token = await signToken(
    { id: user.id, hospitalId: user.hospitalId, role: user.role, name: user.name },
    nodeId,
  );

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role },
    stores,
    nodeId,
  });

  res.cookies.set("vp_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return res;
}
