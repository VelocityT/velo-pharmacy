import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@velocare/core/lib/db";
import { requireAuth } from "@velocare/core/server/auth";

/**
 * GET /api/bill?id=…  or  ?billNo=…
 *
 * Everything a printed GST invoice legally needs, in one payload.
 *
 * A pharmacy invoice is not a generic retail receipt. Under the Drugs
 * and Cosmetics Rules it must carry the drug licence number and the
 * batch and expiry of every item dispensed, and under GST it needs the
 * HSN-wise tax breakdown. Leaving any of those off makes the bill
 * non-compliant, which is the pharmacy's problem, not ours — so the
 * print template gets all of it whether it chooses to show it or not.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if ("error" in auth) return auth.error;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const billNo = url.searchParams.get("billNo");
  if (!id && !billNo) return NextResponse.json({ error: "Missing id or billNo." }, { status: 422 });

  const sale = await prisma.sale.findFirst({
    where: {
      hospitalId: auth.user.hospitalId,
      ...(id ? { id } : { billNo: billNo! }),
    },
    include: {
      store: { select: { code: true, name: true, location: true } },
      patient: { select: { name: true, uhid: true, phone: true, address: true, age: true, gender: true } },
      visit: { select: { visitNo: true, type: true, bedNo: true } },
      rx: {
        select: {
          rxNo: true,
          doctor: { select: { name: true, registrationNo: true, department: true } },
        },
      },
      lines: true,
    },
  });

  if (!sale) return NextResponse.json({ error: "Bill not found." }, { status: 404 });

  const [hospital, items, batches, pharmacist] = await Promise.all([
    prisma.hospital.findUnique({
      where: { id: auth.user.hospitalId },
      select: {
        name: true, legalName: true, gstin: true, drugLicenseNo: true,
        address: true, city: true, state: true, stateCode: true,
        pincode: true, phone: true, email: true,
      },
    }),
    prisma.item.findMany({
      where: { id: { in: sale.lines.map((l) => l.itemId) } },
      select: { id: true, name: true, hsnCode: true, packing: true, schedule: true, unitOfSale: true },
    }),
    prisma.batch.findMany({
      where: { id: { in: sale.lines.map((l) => l.batchId) } },
      select: { id: true, batchNo: true, expiryDate: true },
    }),
    prisma.user.findUnique({
      where: { id: sale.createdBy },
      select: { name: true, pharmacistRegNo: true },
    }),
  ]);

  const lines = sale.lines.map((l) => {
    const it = items.find((i) => i.id === l.itemId);
    const b = batches.find((x) => x.id === l.batchId);
    return {
      itemName: it?.name ?? "—",
      hsnCode: it?.hsnCode ?? "",
      packing: it?.packing ?? "",
      schedule: it?.schedule ?? "NONE",
      unitOfSale: it?.unitOfSale ?? "",
      batchNo: b?.batchNo ?? "",
      expiryDate: b?.expiryDate ?? null,
      qty: Number(l.qty),
      mrp: Number(l.mrp),
      rate: Number(l.rate),
      discountPct: Number(l.discountPct),
      taxableAmt: Number(l.taxableAmt),
      gstRate: Number(l.gstRate),
      gstAmt: Number(l.gstAmt),
      lineTotal: Number(l.lineTotal),
    };
  });

  // HSN-wise summary — the annexure GST asks for on the invoice itself.
  const hsnMap = new Map<string, {
    hsnCode: string; gstRate: number; qty: number;
    taxableAmt: number; cgst: number; sgst: number;
  }>();
  for (const l of lines) {
    const key = `${l.hsnCode || "UNMAPPED"}|${l.gstRate}`;
    const cur = hsnMap.get(key) ?? {
      hsnCode: l.hsnCode || "UNMAPPED", gstRate: l.gstRate,
      qty: 0, taxableAmt: 0, cgst: 0, sgst: 0,
    };
    cur.qty += l.qty;
    cur.taxableAmt += l.taxableAmt;
    // Patient sales are always intra-state, so GST always halves here.
    const half = Math.round((l.gstAmt / 2) * 100) / 100;
    cur.cgst += half;
    cur.sgst += l.gstAmt - half;
    hsnMap.set(key, cur);
  }

  return NextResponse.json({
    hospital,
    sale: {
      id: sale.id,
      billNo: sale.billNo,
      billDate: sale.billDate,
      saleType: sale.saleType,
      paymentMode: sale.paymentMode,
      isCancelled: sale.isCancelled,
      isOfflineOrigin: sale.isOfflineOrigin,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      grossAmount: Number(sale.grossAmount),
      discountAmt: Number(sale.discountAmt),
      taxableAmt: Number(sale.taxableAmt),
      cgstAmt: Number(sale.cgstAmt),
      sgstAmt: Number(sale.sgstAmt),
      igstAmt: Number(sale.igstAmt),
      roundOff: Number(sale.roundOff),
      netAmount: Number(sale.netAmount),
      paidAmount: Number(sale.paidAmount),
    },
    store: sale.store,
    patient: sale.patient,
    visit: sale.visit,
    prescription: sale.rx,
    pharmacist,
    lines,
    hsnSummary: [...hsnMap.values()].sort((a, b) => a.hsnCode.localeCompare(b.hsnCode)),
  });
}
