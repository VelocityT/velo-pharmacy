import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";
import { nextDocNumber } from "@velocare/core/server/services/sequence.service";

/**
 * Prescriptions.
 *
 * This is not an optional convenience module. The sale service refuses
 * to dispense Schedule H1 or narcotic drugs without a linked
 * prescription carrying the prescriber's registration number — which
 * is correct under the Drugs and Cosmetics Rules and the NDPS Act, and
 * which means that WITHOUT this endpoint those drugs can never be sold
 * at all.
 *
 *   GET  /api/prescription            → reference data
 *   GET  /api/prescription?id=…       → one Rx with lines
 *   GET  /api/prescription?patientId= → open prescriptions for a patient
 *   POST /api/prescription            → create
 */

const ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER", "PHARMACIST"];

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, ROLES);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const patientId = url.searchParams.get("patientId");
  const h = auth.user.hospitalId;

  if (id) {
    const rx = await prisma.prescription.findFirst({
      where: { id, hospitalId: h },
      include: {
        doctor: { select: { name: true, registrationNo: true, department: true } },
        patient: { select: { name: true, uhid: true, phone: true, age: true, gender: true } },
        lines: true,
      },
    });
    if (!rx) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const items = await prisma.item.findMany({
      where: { id: { in: rx.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, schedule: true, unitOfSale: true },
    });

    return NextResponse.json({
      prescription: {
        ...rx,
        lines: rx.lines.map((l) => ({
          ...l,
          itemName: items.find((i) => i.id === l.itemId)?.name ?? "—",
          schedule: items.find((i) => i.id === l.itemId)?.schedule ?? "NONE",
        })),
      },
    });
  }

  if (patientId) {
    // Only undispensed prescriptions — the counter wants what is still
    // pending, not the patient's whole history.
    const list = await prisma.prescription.findMany({
      where: { hospitalId: h, patientId, isDispensed: false },
      include: { doctor: { select: { name: true, registrationNo: true } }, lines: true },
      orderBy: { rxDate: "desc" },
      take: 20,
    });
    return NextResponse.json({ prescriptions: list });
  }

  const [doctors, patients, items] = await Promise.all([
    prisma.doctor.findMany({
      where: { hospitalId: h, deletedAt: null, isActive: true },
      select: { id: true, name: true, registrationNo: true, department: true },
      orderBy: { name: "asc" },
    }),
    prisma.patient.findMany({
      where: { hospitalId: h, deletedAt: null },
      select: { id: true, name: true, uhid: true, phone: true },
      orderBy: { name: "asc" },
      take: 2000,
    }),
    prisma.item.findMany({
      where: { hospitalId: h, deletedAt: null, isActive: true },
      select: { id: true, code: true, name: true, schedule: true, unitOfSale: true },
      orderBy: { name: "asc" },
      take: 5000,
    }),
  ]);

  return NextResponse.json({ doctors, patients, items });
}

const schema = z.object({
  patientId: z.string().min(1, "Select a patient."),
  doctorId: z.string().min(1, "Select the prescriber."),
  visitId: z.string().optional().nullable(),
  rxDate: z.string().optional(),
  notes: z.string().max(600).optional().nullable(),
  scanUrl: z.string().optional().nullable(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.coerce.number().positive(),
        dosage: z.string().max(80).optional().nullable(),
        days: z.coerce.number().int().min(0).optional().nullable(),
      }),
    )
    .min(1, "Add at least one drug."),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, ROLES);
  if ("error" in auth) return auth.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return NextResponse.json({ error: "Please fix the highlighted fields.", errors }, { status: 422 });
  }

  const d = parsed.data;
  const h = auth.user.hospitalId;

  try {
    // The check that makes the whole chain work. A prescriber with no
    // registration number cannot legally appear on an H1 register, so
    // catch it here rather than at the counter with a patient waiting.
    const doctor = await prisma.doctor.findFirst({
      where: { id: d.doctorId, hospitalId: h },
      select: { name: true, registrationNo: true },
    });
    if (!doctor) return NextResponse.json({ error: "Prescriber not found." }, { status: 404 });

    const scheduled = await prisma.item.findMany({
      where: {
        id: { in: d.lines.map((l) => l.itemId) },
        OR: [{ schedule: { in: ["H1", "NARCOTIC", "X"] } }, { isNarcotic: true }],
      },
      select: { name: true, schedule: true },
    });

    if (scheduled.length > 0 && !doctor.registrationNo) {
      return NextResponse.json(
        {
          error:
            `${doctor.name} has no registration number on record. ` +
            `Scheduled drugs (${scheduled.map((s) => s.name).join(", ")}) cannot be prescribed ` +
            `without it — add it in Masters → Doctors first.`,
          errors: { doctorId: "Registration number missing" },
        },
        { status: 422 },
      );
    }

    const rx = await prisma.$transaction(async (tx) => {
      const hospital = await tx.hospital.findUniqueOrThrow({
        where: { id: h },
        select: { fyStartMonth: true },
      });

      const rxNo = await nextDocNumber(tx, {
        hospitalId: h,
        docType: "SALE", // Rx shares the sale series prefix per FY
        date: new Date(),
        fyStartMonth: hospital.fyStartMonth,
        nodeId: auth.nodeId,
      }).then((n) => n.replace("INV", "RX"));

      return tx.prescription.create({
        data: {
          hospitalId: h,
          rxNo,
          rxDate: d.rxDate ? new Date(d.rxDate) : new Date(),
          patientId: d.patientId,
          visitId: d.visitId ?? undefined,
          doctorId: d.doctorId,
          notes: d.notes ?? undefined,
          scanUrl: d.scanUrl ?? undefined,
          lines: {
            createMany: {
              data: d.lines.map((l) => ({
                itemId: l.itemId,
                qty: new Prisma.Decimal(l.qty),
                dosage: l.dosage ?? undefined,
                days: l.days ?? undefined,
              })),
            },
          },
        },
        include: { lines: true },
      });
    });

    return NextResponse.json({ prescription: rx }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/prescription]", e);
    return NextResponse.json(
      { error: "Could not save the prescription.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
