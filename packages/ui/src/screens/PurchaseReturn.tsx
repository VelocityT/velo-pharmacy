"use client";

import { useCallback, useEffect, useState } from "react";
import { PackageX, Loader2, CheckCircle2, TriangleAlert, Info, Filter } from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Label, Badge, Skeleton, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Purchase return — expired or damaged stock goes back to the distributor.
 *
 * Priced at the batch's purchase rate, because that is what the
 * supplier credits. Valuing at MRP would overstate the receivable and
 * make the supplier ledger fiction.
 *
 * The batch list is sorted by expiry, soonest first — the whole point
 * is catching stock while it still has credit value. A distributor
 * will not take back something that expired last month.
 */

interface Batch {
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  daysLeft: number;
  quantity: number;
  purchaseRate: number;
  value: number;
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REASONS = [
  { value: "EXPIRY", label: "Expired" },
  { value: "NEAR_EXPIRY", label: "Near expiry — return for credit" },
  { value: "DAMAGE", label: "Damaged in transit or storage" },
  { value: "WRONG_SUPPLY", label: "Wrong item supplied" },
  { value: "RECALL", label: "Manufacturer recall" },
] as const;

export default function PurchaseReturn() {
  const [ref, setRef] = useState<{
    stores: Array<{ id: string; code: string; name: string }>;
    suppliers: Array<{ id: string; name: string }>;
    batches: Batch[];
  } | null>(null);

  const [storeId, setStoreId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("EXPIRY");
  const [days, setDays] = useState(90);
  const [remarks, setRemarks] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ returnNo: string; amount: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ type: "purchase", days: String(days) });
      if (storeId) p.set("storeId", storeId);
      const res = await fetch(`/api/returns?${p}`);
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not load.");
      setRef(body);
      if (!storeId && body.stores.length) setStoreId(body.stores[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [storeId, days]);

  useEffect(() => void load(), [load]);

  const total = ref
    ? ref.batches.reduce((a, b) => a + (Number(picks[b.batchId]) || 0) * b.purchaseRate, 0)
    : 0;
  const selected = Object.values(picks).filter((v) => Number(v) > 0).length;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const lines = (ref?.batches ?? [])
        .filter((b) => Number(picks[b.batchId]) > 0)
        .map((b) => ({
          itemId: b.itemId,
          batchId: b.batchId,
          quantity: picks[b.batchId],
          rate: b.purchaseRate,
        }));

      const res = await fetch("/api/returns?type=purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, storeId, reason, remarks: remarks || undefined, lines }),
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
          <h1 className="text-2xl font-semibold tracking-tight">Debit note raised</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done.returnNo}</p>
          <p className="mt-2 text-lg font-semibold">{inr(done.amount)} claimable</p>
          <p className="mt-3 text-sm text-slate-400">Stock removed. Send the goods with the debit note.</p>
          <Button
            className="mt-6"
            variant="secondary"
            onClick={() => {
              setDone(null);
              setPicks({});
              void load();
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
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <PackageX className="size-6 text-brand-500" />
            Purchase Return
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Send expired or damaged stock back for credit — while it still has credit value.
          </p>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label>Store <span className="text-red-500">*</span></Label>
            <select
              value={storeId}
              onChange={(e) => { setStoreId(e.target.value); setPicks({}); }}
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {ref?.stores.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Return to Supplier <span className="text-red-500">*</span></Label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select supplier…</option>
              {ref?.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Reason <span className="text-red-500">*</span></Label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>
              <Filter className="mr-1 inline size-3" />
              Expiring within
            </Label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {[30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="scrollbar-thin max-h-[52vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
                  {["Item", "Batch", "Expiry", "Days Left", "In Stock", "Rate", "Return Qty", "Credit"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={cn(
                          "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                          i >= 3 ? "text-right" : "text-left",
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))}

                {!loading && ref?.batches.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        icon={PackageX}
                        title="Nothing expiring in this window"
                        hint="Widen the filter, or this store genuinely has no near-expiry stock."
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  ref?.batches.map((b) => {
                    const expired = b.daysLeft < 0;
                    const want = Number(picks[b.batchId]) || 0;
                    return (
                      <tr key={b.batchId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{b.itemName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{b.batchNo}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {new Date(b.expiryDate).toLocaleDateString("en-IN", {
                            month: "short", year: "numeric",
                          })}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Badge tone={expired ? "bad" : b.daysLeft < 30 ? "warn" : "neutral"}>
                            {expired ? `expired ${-b.daysLeft}d ago` : `${b.daysLeft}d`}
                          </Badge>
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-600">{b.quantity}</td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-500">{inr(b.purchaseRate)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            max={b.quantity}
                            step="0.001"
                            value={picks[b.batchId] ?? ""}
                            onChange={(e) => setPicks((p) => ({ ...p, [b.batchId]: e.target.value }))}
                            className={cn(
                              "tabular h-9 w-24 rounded-md bg-white px-2 text-right text-sm ring-1 focus:outline-none focus:ring-2",
                              want > b.quantity
                                ? "ring-red-400 focus:ring-red-500"
                                : "ring-slate-200 focus:ring-brand-500",
                            )}
                          />
                        </td>
                        <td className="tabular px-4 py-2.5 text-right font-semibold text-slate-800">
                          {want > 0 ? inr(want * b.purchaseRate) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-lg flex-1">
            <Label>Remarks</Label>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Reference to the supplier's return authorisation, if any"
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-400">
              <Info className="mt-px size-3 shrink-0" />
              Valued at purchase rate — what the distributor credits, not MRP.
            </p>
          </div>

          <Card className="p-5">
            <div className="flex items-end justify-between gap-10">
              <div>
                <p className="text-xs text-slate-400">{selected} batch{selected === 1 ? "" : "es"} selected</p>
                <p className="text-sm text-slate-500">Claimable</p>
              </div>
              <span className="tabular text-2xl font-bold tracking-tight">{inr(total)}</span>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={!supplierId || total <= 0 || busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageX className="size-4" />}
              {busy ? "Posting…" : "Post Return"}
            </Button>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
