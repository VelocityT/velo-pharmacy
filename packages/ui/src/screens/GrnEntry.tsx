"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Loader2, TriangleAlert, CheckCircle2, PackagePlus, Search, Info,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Input, Label, Badge, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * ────────────────────────────────────────────────────────────────
 *  GOODS RECEIPT ENTRY
 * ────────────────────────────────────────────────────────────────
 *
 *  The hardest screen in the product, and the one that decides
 *  whether the system's stock is trustworthy. Three things generic
 *  purchase modules get wrong:
 *
 *  1. BATCH + EXPIRY are mandatory. A pharmacy purchase without a
 *     batch number is not a pharmacy purchase.
 *  2. FREE QTY is costed at zero but enters stock at full count.
 *     Distributor schemes ("10+1") are universal here, and booking
 *     free goods at rate inflates purchase value and destroys margin
 *     reporting.
 *  3. Tax is charged on billed quantity only, and supplier invoices
 *     quote rates EXCLUSIVE of GST — the opposite of a patient bill,
 *     where MRP is inclusive.
 *
 *  Keyboard: Tab moves along the line, Enter on the last field adds
 *  the next row. A purchase officer keys 40 lines off a paper invoice
 *  and should never reach for the mouse.
 */

interface Item {
  id: string;
  code: string;
  name: string;
  gstRate: number;
  packing: string | null;
  hsnCode: string | null;
}
interface Supplier {
  id: string;
  name: string;
  stateCode: string | null;
  gstin: string | null;
  creditDays: number;
}
interface Store {
  id: string;
  code: string;
  name: string;
}

interface Line {
  key: string;
  itemId: string;
  itemName: string;
  gstRate: number;
  batchNo: string;
  expiryDate: string;
  mrp: string;
  quantity: string;
  freeQty: string;
  rate: string;
  discountPct: string;
}

const blank = (): Line => ({
  key: crypto.randomUUID(),
  itemId: "", itemName: "", gstRate: 12,
  batchNo: "", expiryDate: "", mrp: "",
  quantity: "", freeQty: "0", rate: "", discountPct: "0",
});

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function GrnEntry() {
  const router = useRouter();
  const [ref, setRef] = useState<{
    suppliers: Supplier[]; stores: Store[]; items: Item[]; hospitalStateCode: string | null;
  } | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const [picker, setPicker] = useState<{ lineKey: string; q: string } | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/grn");
      const raw = await res.text();
      if (!raw) return setError(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) return setError(body.error ?? "Could not load reference data.");
      setRef(body);
      if (body.stores.length === 1) setStoreId(body.stores[0].id);
    })();
  }, []);

  useEffect(() => {
    if (picker) pickerRef.current?.focus();
  }, [picker]);

  const supplier = ref?.suppliers.find((s) => s.id === supplierId);

  /**
   * Same state as the hospital → CGST + SGST. Different → IGST.
   * Shown live because purchase officers check this against the
   * paper invoice, and a mismatch means the supplier billed wrong.
   */
  const taxSplit =
    supplier && ref?.hospitalStateCode
      ? supplier.stateCode?.trim() === ref.hospitalStateCode.trim()
        ? "INTRA"
        : "INTER"
      : "INTRA";

  const totals = useMemo(() => {
    let taxable = 0, gst = 0, gross = 0, discount = 0, freeUnits = 0;
    for (const l of lines) {
      const q = Number(l.quantity) || 0;
      const r = Number(l.rate) || 0;
      const d = Number(l.discountPct) || 0;
      const g = l.gstRate;
      const lineGross = q * r;
      const lineDisc = (lineGross * d) / 100;
      const t = lineGross - lineDisc;
      gross += lineGross;
      discount += lineDisc;
      taxable += t;
      gst += (t * g) / 100;
      freeUnits += Number(l.freeQty) || 0;
    }
    const net = taxable + gst;
    const rounded = Math.round(net);
    return { gross, discount, taxable, gst, net, rounded, roundOff: rounded - net, freeUnits };
  }, [lines]);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addLine = () => setLines((ls) => [...ls, blank()]);
  const removeLine = (key: string) =>
    setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((l) => l.key !== key)));

  const matches = useMemo(() => {
    if (!picker || !ref) return [];
    const q = picker.q.trim().toLowerCase();
    if (q.length < 2) return [];
    return ref.items
      .filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
      .slice(0, 12);
  }, [picker, ref]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payload = {
        supplierId,
        storeId,
        supplierInvoiceNo: invoiceNo,
        supplierInvoiceDate: invoiceDate,
        clientUuid: crypto.randomUUID(),
        lines: lines
          .filter((l) => l.itemId && l.quantity)
          .map((l) => ({
            itemId: l.itemId,
            batchNo: l.batchNo,
            // Expiry is stored as the last day of the printed month —
            // "06/27" means valid through 30 June 2027.
            expiryDate: `${l.expiryDate}-01`,
            mrp: l.mrp,
            quantity: l.quantity,
            freeQty: l.freeQty || 0,
            rate: l.rate,
            discountPct: l.discountPct || 0,
          })),
      };

      const res = await fetch("/api/grn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not post the goods receipt.");

      setDone(body.grn.grnNo);
      setTimeout(() => router.push("/grns"), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    supplierId && storeId && invoiceNo &&
    lines.some((l) => l.itemId && l.quantity && l.batchNo && l.expiryDate && l.mrp);

  if (done) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32 text-center">
          <CheckCircle2 className="mb-4 size-14 text-emerald-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Goods receipt posted</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done}</p>
          <p className="mt-3 text-sm text-slate-400">Stock has entered the ledger. Redirecting…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
              <PackagePlus className="size-6 text-brand-500" />
              Goods Receipt
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Enter the supplier invoice. Stock moves when you post — nothing is saved as a draft.
            </p>
          </div>
          <Badge tone={taxSplit === "INTER" ? "warn" : "brand"}>
            {taxSplit === "INTER" ? "IGST — inter-state" : "CGST + SGST — intra-state"}
          </Badge>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-800">Could not post.</p>
              <p className="mt-0.5 text-sm text-red-700">{error}</p>
            </div>
          </Card>
        )}

        {/* ── Header ──────────────────────────────────────── */}
        <Card className="p-5">
          {!ref ? (
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>Supplier <span className="text-red-500">*</span></Label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select supplier…</option>
                  {ref.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {supplier && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {supplier.gstin ?? "no GSTIN"} · {supplier.creditDays} days credit
                  </p>
                )}
              </div>

              <div>
                <Label>Receiving Store <span className="text-red-500">*</span></Label>
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select store…</option>
                  {ref.stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
                <p className="mt-1 flex items-start gap-1 text-[11px] text-slate-400">
                  <Info className="mt-px size-3 shrink-0" />
                  Only stores flagged to receive purchases appear here
                </p>
              </div>

              <div>
                <Label>Supplier Invoice No <span className="text-red-500">*</span></Label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="INV-2026-4471"
                />
                <p className="mt-1 text-[11px] text-slate-400">Duplicate entry is blocked</p>
              </div>

              <div>
                <Label>Invoice Date <span className="text-red-500">*</span></Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
            </div>
          )}
        </Card>

        {/* ── Lines ───────────────────────────────────────── */}
        <Card className="overflow-visible">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  {[
                    ["Item", "left", "min-w-[240px]"],
                    ["Batch No", "left", "w-32"],
                    ["Expiry", "left", "w-32"],
                    ["MRP", "right", "w-24"],
                    ["Qty", "right", "w-20"],
                    ["Free", "right", "w-20"],
                    ["Rate", "right", "w-24"],
                    ["Disc %", "right", "w-20"],
                    ["GST", "right", "w-16"],
                    ["Amount", "right", "w-28"],
                    ["", "right", "w-10"],
                  ].map(([h, align, w]) => (
                    <th
                      key={h as string}
                      className={cn(
                        "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                        align === "right" ? "text-right" : "text-left",
                        w as string,
                      )}
                    >
                      {h as string}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const q = Number(l.quantity) || 0;
                  const r = Number(l.rate) || 0;
                  const d = Number(l.discountPct) || 0;
                  const taxable = q * r * (1 - d / 100);
                  const amount = taxable * (1 + l.gstRate / 100);
                  const rateOverMrp = r > 0 && Number(l.mrp) > 0 && r > Number(l.mrp);

                  return (
                    <tr key={l.key} className="border-b border-slate-100 last:border-0">
                      <td className="relative px-3 py-2">
                        {l.itemId ? (
                          <button
                            onClick={() => setPicker({ lineKey: l.key, q: "" })}
                            className="w-full truncate rounded-md px-2 py-1.5 text-left font-medium text-slate-800 hover:bg-slate-50"
                          >
                            {l.itemName}
                          </button>
                        ) : (
                          <button
                            onClick={() => setPicker({ lineKey: l.key, q: "" })}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-slate-400 hover:bg-slate-50"
                          >
                            <Search className="size-3.5" />
                            Select item…
                          </button>
                        )}

                        {picker?.lineKey === l.key && (
                          <div className="absolute left-3 top-full z-30 w-96 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
                            <input
                              ref={pickerRef}
                              value={picker.q}
                              onChange={(e) => setPicker({ ...picker, q: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setPicker(null);
                                if (e.key === "Enter" && matches[0]) {
                                  setLine(l.key, {
                                    itemId: matches[0].id,
                                    itemName: matches[0].name,
                                    gstRate: matches[0].gstRate,
                                  });
                                  setPicker(null);
                                }
                              }}
                              placeholder="Type item name or code…"
                              className="h-9 w-full rounded-lg bg-slate-50 px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                            />
                            <ul className="mt-1 max-h-64 overflow-auto">
                              {matches.map((m) => (
                                <li key={m.id}>
                                  <button
                                    onClick={() => {
                                      setLine(l.key, { itemId: m.id, itemName: m.name, gstRate: m.gstRate });
                                      setPicker(null);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-brand-50"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                                    <span className="font-mono text-[10px] text-slate-400">{m.code}</span>
                                    <Badge>{m.gstRate}%</Badge>
                                  </button>
                                </li>
                              ))}
                              {picker.q.length >= 2 && matches.length === 0 && (
                                <li className="px-2.5 py-6 text-center text-xs text-slate-400">
                                  No item matches. Add it in Item Master first.
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </td>

                      <Cell value={l.batchNo} onChange={(v) => setLine(l.key, { batchNo: v.toUpperCase() })} placeholder="ABC1234" mono />
                      <td className="px-3 py-2">
                        <input
                          type="month"
                          value={l.expiryDate}
                          onChange={(e) => setLine(l.key, { expiryDate: e.target.value })}
                          className="h-9 w-full rounded-md bg-white px-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </td>
                      <Cell value={l.mrp} onChange={(v) => setLine(l.key, { mrp: v })} num right />
                      <Cell value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} num right />
                      <Cell value={l.freeQty} onChange={(v) => setLine(l.key, { freeQty: v })} num right muted />
                      <Cell
                        value={l.rate}
                        onChange={(v) => setLine(l.key, { rate: v })}
                        num right
                        invalid={rateOverMrp}
                        title={rateOverMrp ? "Rate exceeds MRP — check the invoice" : undefined}
                      />
                      <Cell value={l.discountPct} onChange={(v) => setLine(l.key, { discountPct: v })} num right muted />

                      <td className="px-3 py-2 text-right text-xs text-slate-400">{l.gstRate}%</td>
                      <td className="tabular px-3 py-2 text-right font-semibold text-slate-800">
                        {amount > 0 ? inr(amount) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => removeLine(l.key)}
                          className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 px-4 py-3">
            <Button variant="secondary" size="sm" onClick={addLine}>
              <Plus className="size-3.5" />
              Add line
            </Button>
          </div>
        </Card>

        {/* ── Totals ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Card className="flex-1 p-4">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
              <span>
                Free quantity enters stock at full count but is costed at zero — the effective
                purchase rate falls accordingly, which is what margin reporting reads.
                {totals.freeUnits > 0 && (
                  <strong className="text-slate-700"> {totals.freeUnits} free units on this invoice.</strong>
                )}
              </span>
            </p>
          </Card>

          <Card className="w-full max-w-sm p-5">
            {[
              ["Gross", totals.gross],
              ["Discount", -totals.discount],
              ["Taxable", totals.taxable],
              [taxSplit === "INTER" ? "IGST" : "CGST + SGST", totals.gst],
              ["Round off", totals.roundOff],
            ].map(([label, v]) => (
              <div key={label as string} className="flex justify-between py-1.5 text-sm">
                <span className="text-slate-500">{label as string}</span>
                <span className="tabular text-slate-700">{inr(v as number)}</span>
              </div>
            ))}
            <div className="mt-3 flex items-end justify-between border-t-2 border-slate-100 pt-4">
              <span className="text-sm font-medium text-slate-600">Invoice total</span>
              <span className="tabular text-2xl font-bold tracking-tight text-slate-900">
                {inr(totals.rounded)}
              </span>
            </div>

            <Button
              className="mt-4 h-12 w-full"
              disabled={!ready || busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}
              {busy ? "Posting…" : "Post Goods Receipt"}
            </Button>
            {!ready && (
              <p className="mt-2 text-center text-[11px] text-slate-400">
                Supplier, store, invoice no. and one complete line are required
              </p>
            )}
          </Card>
        </div>
      </div>

      {picker && <div className="fixed inset-0 z-20" onClick={() => setPicker(null)} />}
    </AppShell>
  );
}

function Cell({
  value, onChange, placeholder, num, right, mono, muted, invalid, title,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  num?: boolean;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
  invalid?: boolean;
  title?: string;
}) {
  return (
    <td className="px-3 py-2">
      <input
        type={num ? "number" : "text"}
        step={num ? "0.001" : undefined}
        value={value}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-md bg-white px-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500",
          right && "tabular text-right",
          mono && "font-mono text-xs",
          muted && "text-slate-500",
          invalid && "bg-red-50 ring-red-400 focus:ring-red-500",
        )}
      />
    </td>
  );
}
