"use client";

import { useState } from "react";
import { Search, Undo2, Loader2, CheckCircle2, TriangleAlert, Info } from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Input, Label, Badge, toneFor, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Sale return — patient brings medicine back.
 *
 * Pull the bill, pick lines, return. Two guards that matter:
 * quantity is capped at what remains returnable on that line (so the
 * same strip cannot be refunded twice), and the refund is priced at
 * the ORIGINAL bill rate rather than today's — refunding more than was
 * paid is how a pharmacy gets quietly drained.
 */

interface Line {
  id: string;
  itemName: string;
  schedule: string;
  batchNo: string;
  expiryDate: string | null;
  qty: number;
  qtyReturned: number;
  returnable: number;
  rate: number;
  mrp: number;
  lineTotal: number;
}

interface Sale {
  id: string;
  billNo: string;
  billDate: string;
  netAmount: number;
  store: { code: string; name: string };
  customer: string;
  lines: Line[];
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REASONS = ["Patient returned", "Wrong item dispensed", "Adverse reaction", "Damaged pack", "Other"];

export default function SaleReturn() {
  const [billNo, setBillNo] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ returnNo: string; amount: number } | null>(null);

  async function find() {
    setSearching(true);
    setError("");
    setSale(null);
    setPicks({});
    try {
      const res = await fetch(`/api/returns?type=sale&billNo=${encodeURIComponent(billNo.trim())}`);
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Bill not found.");
      setSale(body.sale);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const refund = sale
    ? sale.lines.reduce((a, l) => a + (Number(picks[l.id]) || 0) * l.rate, 0)
    : 0;

  async function submit() {
    if (!sale) return;
    setBusy(true);
    setError("");
    try {
      const lines = Object.entries(picks)
        .filter(([, q]) => Number(q) > 0)
        .map(([saleLineId, quantity]) => ({ saleLineId, quantity }));

      const res = await fetch("/api/returns?type=sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleId: sale.id, reason, lines }),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not post the return.");
      setDone({ returnNo: body.return.returnNo, amount: Number(body.return.netAmount) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32 text-center">
          <CheckCircle2 className="mb-4 size-14 text-emerald-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Credit note raised</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done.returnNo}</p>
          <p className="mt-2 text-lg font-semibold">{inr(done.amount)} refundable</p>
          <p className="mt-3 text-sm text-slate-400">Stock is back on the shelf.</p>
          <Button
            className="mt-6"
            variant="secondary"
            onClick={() => {
              setDone(null);
              setSale(null);
              setBillNo("");
              setPicks({});
            }}
          >
            Another return
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <Undo2 className="size-6 text-brand-500" />
            Sale Return
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Pull the original bill and return what came back. Refunded at the bill rate, not today&apos;s.
          </p>
        </div>

        <Card className="p-5">
          <Label>Bill Number</Label>
          <div className="flex gap-2">
            <Input
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && billNo.trim() && void find()}
              placeholder="INV/2026-27/OPD-01/00001"
              className="font-mono"
              autoFocus
            />
            <Button onClick={() => void find()} disabled={!billNo.trim() || searching}>
              {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Find
            </Button>
          </div>
        </Card>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        {sale && (
          <>
            <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div className="text-sm">
                <p className="font-semibold text-slate-800">{sale.customer}</p>
                <p className="text-slate-500">
                  {sale.billNo} ·{" "}
                  {new Date(sale.billDate).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}{" "}
                  · {sale.store.code}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-400">Bill value</p>
                <p className="tabular text-lg font-semibold">{inr(sale.netAmount)}</p>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    {["Item", "Batch", "Sold", "Already Returned", "Returnable", "Return Qty", "Refund"].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                            i >= 2 ? "text-right" : "text-left",
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sale.lines.map((l) => {
                    const want = Number(picks[l.id]) || 0;
                    const over = want > l.returnable;
                    return (
                      <tr key={l.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-slate-800">{l.itemName}</span>
                          {l.schedule !== "NONE" && (
                            <Badge tone={toneFor(l.schedule)} className="ml-2">{l.schedule}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{l.batchNo}</td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-600">{l.qty}</td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-400">
                          {l.qtyReturned || "—"}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right font-medium text-slate-700">
                          {l.returnable}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            max={l.returnable}
                            step="0.001"
                            value={picks[l.id] ?? ""}
                            disabled={l.returnable <= 0}
                            onChange={(e) => setPicks((p) => ({ ...p, [l.id]: e.target.value }))}
                            className={cn(
                              "tabular h-9 w-24 rounded-md bg-white px-2 text-right text-sm ring-1 focus:outline-none focus:ring-2",
                              over ? "ring-red-400 focus:ring-red-500" : "ring-slate-200 focus:ring-brand-500",
                              l.returnable <= 0 && "bg-slate-50 text-slate-300",
                            )}
                          />
                        </td>
                        <td className="tabular px-4 py-2.5 text-right font-semibold text-slate-800">
                          {want > 0 ? inr(want * l.rate) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-64">
                <Label>Reason</Label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>

              <Card className="p-5">
                <div className="flex items-end justify-between gap-10">
                  <span className="text-sm text-slate-500">Refund amount</span>
                  <span className="tabular text-2xl font-bold tracking-tight">{inr(refund)}</span>
                </div>
                <Button
                  className="mt-4 w-full"
                  variant="success"
                  disabled={refund <= 0 || busy}
                  onClick={() => void submit()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                  {busy ? "Posting…" : "Post Return"}
                </Button>
              </Card>
            </div>

            <p className="flex items-start gap-2 text-xs text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
              Returned stock goes back to {sale.store.code} at its original batch. The ledger keeps
              both movements — goods left, goods came back — which is what an auditor expects to see.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
