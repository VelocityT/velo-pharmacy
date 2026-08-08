"use client";

import { useEffect, useState } from "react";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "../components/ui";

/**
 * Printable GST invoice — A4 and 80mm thermal from the same markup,
 * switched by a print media query.
 *
 * Legally required and easy to omit:
 *   · the pharmacy's drug licence number
 *   · batch and expiry against every line (Drugs & Cosmetics Rules)
 *   · HSN-wise tax summary (GST)
 *   · the dispensing pharmacist's council registration number
 *
 * A bill missing any of these is non-compliant, and the pharmacy —
 * not the software vendor — is the one an inspector talks to.
 */

interface Data {
  hospital: Record<string, string | null>;
  sale: Record<string, string | number | boolean>;
  store: { code: string; name: string; location: string | null };
  patient: { name: string; uhid: string | null; phone: string | null; age: number | null; gender: string | null } | null;
  prescription: { rxNo: string; doctor: { name: string; registrationNo: string | null; department: string | null } } | null;
  pharmacist: { name: string; pharmacistRegNo: string | null } | null;
  lines: Array<Record<string, string | number | null>>;
  hsnSummary: Array<{ hsnCode: string; gstRate: number; qty: number; taxableAmt: number; cgst: number; sgst: number }>;
}

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in words — Indian numbering. Printed on every GST invoice. */
function words(n: number): string {
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number): string =>
    x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x);

  let x = Math.floor(Math.abs(n));
  if (x === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  const crore = Math.floor(x / 10000000); x %= 10000000;
  const lakh = Math.floor(x / 100000);    x %= 100000;
  const thousand = Math.floor(x / 1000);  x %= 1000;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(three(lakh) + " Lakh");
  if (thousand) parts.push(three(thousand) + " Thousand");
  if (x) parts.push(three(x));
  return parts.join(" ") + " Rupees Only";
}

export default function BillPrint({ billNo }: { billNo: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/bill?billNo=${encodeURIComponent(billNo)}`);
      const raw = await res.text();
      if (!raw) return setErr(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) return setErr(body.error ?? "Could not load the bill.");
      setD(body);
    })();
  }, [billNo]);

  if (err) return <div className="p-10 text-center text-sm text-red-600">{err}</div>;
  if (!d)
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-slate-400" />
      </div>
    );

  const h = d.hospital;
  const s = d.sale;
  const totalGst = Number(s.cgstAmt) + Number(s.sgstAmt) + Number(s.igstAmt);

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      {/* Toolbar — screen only */}
      <div className="mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4 print:hidden">
        <Link href="/sales">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="size-3.5" /> Back to bills
          </Button>
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="size-3.5" /> Print
        </Button>
      </div>

      <div className="invoice mx-auto max-w-[210mm] bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{h.name}</h1>
            {h.legalName && h.legalName !== h.name && (
              <p className="text-[11px] text-slate-600">{h.legalName}</p>
            )}
            <p className="mt-1 text-[11px] leading-snug text-slate-600">
              {h.address}
              {h.city && `, ${h.city}`}
              {h.state && `, ${h.state}`} {h.pincode}
              <br />
              Phone: {h.phone} {h.email && `· ${h.email}`}
            </p>
            <p className="mt-1 text-[11px] font-semibold">
              GSTIN: {h.gstin ?? "—"} &nbsp;·&nbsp; D.L. No: {h.drugLicenseNo ?? "—"}
            </p>
          </div>
          <div className="text-right">
            <p className="inline-block border border-slate-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
              Tax Invoice
            </p>
            <p className="mt-2 font-mono text-sm font-bold">{String(s.billNo)}</p>
            <p className="text-[11px] text-slate-600">
              {new Date(String(s.billDate)).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })}
            </p>
            <p className="text-[11px] text-slate-600">Counter: {d.store.code}</p>
            {Boolean(s.isCancelled) && (
              <p className="mt-1 text-xs font-bold text-red-600">CANCELLED</p>
            )}
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-6 border-b border-slate-300 py-3 text-[11px]">
          <div>
            <p className="mb-1 font-bold uppercase tracking-wide text-slate-500">Patient</p>
            <p className="font-semibold">{d.patient?.name ?? String(s.customerName ?? "Walk-in")}</p>
            {d.patient?.uhid && <p>UHID: {d.patient.uhid}</p>}
            {(d.patient?.age || d.patient?.gender) && (
              <p>
                {d.patient.age ? `${d.patient.age} yrs` : ""} {d.patient.gender ?? ""}
              </p>
            )}
            <p>{d.patient?.phone ?? String(s.customerPhone ?? "")}</p>
          </div>
          <div>
            <p className="mb-1 font-bold uppercase tracking-wide text-slate-500">Prescriber</p>
            {d.prescription ? (
              <>
                <p className="font-semibold">{d.prescription.doctor.name}</p>
                <p>Reg. No: {d.prescription.doctor.registrationNo ?? "—"}</p>
                <p>{d.prescription.doctor.department ?? ""}</p>
                <p>Rx No: {d.prescription.rxNo}</p>
              </>
            ) : (
              <p className="text-slate-400">Over the counter</p>
            )}
          </div>
        </div>

        {/* Lines */}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-slate-800">
              {["#", "Particulars", "HSN", "Batch", "Exp", "Qty", "MRP", "Rate", "GST%", "Amount"].map(
                (x, i) => (
                  <th
                    key={x}
                    className={`py-1.5 font-bold uppercase tracking-wide ${i >= 5 ? "text-right" : "text-left"}`}
                  >
                    {x}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-200">
                <td className="py-1.5">{i + 1}</td>
                <td className="py-1.5">
                  {String(l.itemName)}
                  {l.schedule !== "NONE" && (
                    <span className="ml-1 font-bold text-red-600">[{String(l.schedule)}]</span>
                  )}
                  {l.packing && <span className="text-slate-400"> · {String(l.packing)}</span>}
                </td>
                <td className="py-1.5">{String(l.hsnCode)}</td>
                <td className="py-1.5 font-mono">{String(l.batchNo)}</td>
                <td className="py-1.5">
                  {l.expiryDate
                    ? new Date(String(l.expiryDate)).toLocaleDateString("en-IN", {
                        month: "2-digit", year: "2-digit",
                      })
                    : "—"}
                </td>
                <td className="py-1.5 text-right tabular">{Number(l.qty)}</td>
                <td className="py-1.5 text-right tabular">{inr(Number(l.mrp))}</td>
                <td className="py-1.5 text-right tabular">{inr(Number(l.rate))}</td>
                <td className="py-1.5 text-right tabular">{Number(l.gstRate)}</td>
                <td className="py-1.5 text-right tabular font-semibold">{inr(Number(l.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div className="mt-3 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              HSN Summary
            </p>
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="border-b border-slate-400">
                  <th className="py-1 text-left">HSN</th>
                  <th className="py-1 text-right">Taxable</th>
                  <th className="py-1 text-right">CGST</th>
                  <th className="py-1 text-right">SGST</th>
                </tr>
              </thead>
              <tbody>
                {d.hsnSummary.map((r) => (
                  <tr key={`${r.hsnCode}-${r.gstRate}`} className="border-b border-slate-200">
                    <td className="py-1">
                      {r.hsnCode} <span className="text-slate-400">@{r.gstRate}%</span>
                    </td>
                    <td className="py-1 text-right tabular">{inr(r.taxableAmt)}</td>
                    <td className="py-1 text-right tabular">{inr(r.cgst)}</td>
                    <td className="py-1 text-right tabular">{inr(r.sgst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px]">
            {[
              ["Gross", Number(s.grossAmount)],
              ["Discount", -Number(s.discountAmt)],
              ["Taxable Value", Number(s.taxableAmt)],
              ["CGST", Number(s.cgstAmt)],
              ["SGST", Number(s.sgstAmt)],
              ...(Number(s.igstAmt) > 0 ? ([["IGST", Number(s.igstAmt)]] as Array<[string, number]>) : []),
              ["Round Off", Number(s.roundOff)],
            ].map(([label, v]) => (
              <div key={label as string} className="flex justify-between py-0.5">
                <span className="text-slate-600">{label as string}</span>
                <span className="tabular">{inr(v as number)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t-2 border-slate-800 pt-1.5 text-sm font-bold">
              <span>Net Payable</span>
              <span className="tabular">₹{inr(Number(s.netAmount))}</span>
            </div>
            <p className="mt-1 text-[10px] text-slate-600">
              Paid by {String(s.paymentMode)} · Total GST ₹{inr(totalGst)}
            </p>
          </div>
        </div>

        <p className="mt-3 border-t border-slate-300 pt-2 text-[10px]">
          <span className="font-bold">Amount in words:</span> {words(Number(s.netAmount))}
        </p>

        {/* Footer */}
        <div className="mt-4 flex items-end justify-between border-t border-slate-300 pt-3 text-[10px] text-slate-600">
          <div className="max-w-[60%]">
            <p className="font-bold">Terms</p>
            <p>Goods once sold will not be taken back except as permitted by law.</p>
            <p>Drugs dispensed against a valid prescription where required.</p>
            <p className="mt-1.5">
              Dispensed by: <span className="font-semibold">{d.pharmacist?.name ?? "—"}</span>
              {d.pharmacist?.pharmacistRegNo && ` · Reg. No: ${d.pharmacist.pharmacistRegNo}`}
            </p>
          </div>
          <div className="text-center">
            <div className="mb-1 h-10" />
            <p className="border-t border-slate-400 px-6 pt-1 font-semibold">For {h.name}</p>
            <p>Authorised Signatory</p>
          </div>
        </div>

        <p className="mt-3 text-center text-[9px] text-slate-400">
          Computer-generated invoice · Velocare Pharmacy
        </p>
      </div>

      {/* Print rules live in packages/ui/src/styles/globals.css.
          They were inline styled-jsx, which is the one thing left over
          from before the Tailwind migration — and `<style jsx>` has no
          types once styled-jsx is no longer in use. */}
    </div>
  );
}
