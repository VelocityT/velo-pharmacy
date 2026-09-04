import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";

/**
 * GET /api/auth/session
 *
 * Who am I, and which counter am I standing at?
 *
 * This exists for the AUTH_DISABLED bypass. Normally the login screen
 * writes the session into localStorage, including the storeId — the
 * billing counter cannot work without one, since stock is held per
 * store and a bill has to decrement a specific shelf.
 *
 * With login switched off nobody writes that record, so the client
 * asks the server instead: give me the admin user and a store that is
 * allowed to bill patients.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  const store =
    (await prisma.store.findFirst({
      where: {
        hospitalId: auth.user.hospitalId,
        deletedAt: null,
        isActive: true,
        canBillPatient: true,
      },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    })) ??
    // Fall back to any store — better a read-only dashboard than a
    // blank screen with no explanation.
    (await prisma.store.findFirst({
      where: { hospitalId: auth.user.hospitalId, deletedAt: null },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }));

  if (!store) {
    return NextResponse.json(
      { error: "No stores exist for this hospital. Run: npm run db:seed" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    user: { id: auth.user.id, name: auth.user.name, role: auth.user.role },
    storeId: store.id,
    storeCode: store.code,
    storeName: store.name,
  });
}
