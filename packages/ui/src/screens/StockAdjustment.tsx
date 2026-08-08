"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, Loader2, CheckCircle2, TriangleAlert, Info, ShieldCheck } from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Label, Badge, Skeleton, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Stock adjustment — make the system agree with the shelf.
 *
 * Raised as a DRAFT and posted only on approval, by someone other than
 * the person who raised it. That separation is the internal control:
 * anyone able to silently write stock off is anyone able to steal.
 *
 * The count sheet is pre-filled with system quantity so the counter
 * only types what differs. Asking someone to key 2,000 identical
 * numbers is how stocktakes get faked.
 */

interface Row {
  itemId: string;
  itemName: string;
  itemCode: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  systemQty: number;
  rate: number;
  value: number;
  isExpired: boolean;
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const REASONS = [
  { value: "PHYSICAL_COUNT", label: "Physical count — reconcile to a stocktake" },
  { value: "EXPIRY", label: "Expiry — write off past-date stock" },
  { value: "BREAKAGE", label: "Breakage — dropped or crushed" },
  { value: "THEFT", label: "Theft / shrinkage" },
  { value: "RECALL", label: "Recall — quarantine a batch" },
  { value: "OTHER", label: "Other" },
] as const;

export default function StockAdjustment() {
  const [stores, setStores] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [storeId, setStoreId] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("PHYSICAL_COUNT");
  const [expiredOnly, setExpiredOnly] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ adjNo: string; lines: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (storeId) p.set("storeId", storeId);
      if (expiredOnly) p.set("expiredOnly", "true");
      const res = await fetch(`/api/adjustment?${p}`);
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not load.");
      setStores(body.stores);
      setRows(body.rows);
      if (!storeId && body.stores.length) setStoreId(body.stores[0].id);
      setCounts({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [storeId, expiredOnly]);

  useEffect(() => void load(), [load]);

  /** Expiry write-off means counting everything expired down to zero. */
  function zeroAllExpired() {
    setCounts((c) => {
      const next = { ...c };
      for (const r of rows) if (r.isExpired) next[r.batchId] = "0";
      return next;
    });
    setReason("EXPIRY");
  }

  const diffs = rows
    .map((r) => ({ r, actual: counts[r.batchId] === "" || counts[r.batchId] == null ? null : Number(counts[r.batchId]) }))
    .filter((x) => x.actual !== null && x.actual !== x.r.systemQty);

  const netValue = diffs.reduce((a, x) => a + ((x.actual as number) - x.r.systemQty) * x.r.rate, 0);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          reason,
          remarks: remarks || undefined,
          lines: diffs.map((x) => ({
            itemId: x.r.itemId,
            batchId: x.r.batchId,
            actualQty: x.actual,
          })),
        }),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not create the adjustment.");
      setDone({ adjNo: body.adjustment.adjNo, lines: body.adjustment.lines.length });
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
          <CheckCircle2 className="mb-4 size-14 text-amber-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Adjustment raised as draft</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done.adjNo}</p>
          <p className="mt-2 text-sm text-slate-600">{done.lines} line(s) with a difference</p>
          <div className="mt-5 max-w-md rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
            <ShieldCheck className="mb-1.5 inline size-4" />{" "}
            <strong>Stock has not moved yet.</strong> A manager other than you must approve this
            before it posts to the ledger — that separation is the control against silent write-offs.
          </div>
          <Button
            className="mt-6"
            variant="secondary"
            onClick={() => { setDone(null); void load(); }}
          >
            New adjustment
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
            <SlidersHorizontal className="size-6 text-brand-500" />
            Stock Adjustment
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Count sheet pre-filled with system stock. Enter only what differs.
          </p>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        <Card className="flex flex-wrap items-end gap-4 p-5">
          <div className="min-w-56">
            <Label>Store <span className="text-red-500">*</span></Label>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-72 flex-1">
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
          <label className="flex h-10 cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={expiredOnly}
              onChange={(e) => setExpiredOnly(e.target.checked)}
              className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-slate-700">Expired only</span>
          </label>
          {rows.some((r) => r.isExpired) && (
            <Button variant="secondary" size="sm" onClick={zeroAllExpired}>
              Write off all expired
            </Button>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="scrollbar-thin max-h-[52vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
                  {["Item", "Batch", "Expiry", "System Qty", "Actual Count", "Difference", "Value Impact"].map(
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
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-2.5"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState icon={SlidersHorizontal} title="No stock at this store" />
                    </td>
                  </tr>
                )}

                {!loading &&
                  rows.map((r) => {
                    const raw = counts[r.batchId];
                    const actual = raw === "" || raw == null ? null : Number(raw);
                    const diff = actual === null ? null : actual - r.systemQty;
                    return (
                      <tr
                        key={r.batchId}
                        className={cn(
                          "border-b border-slate-100 last:border-0",
                          r.isExpired && "bg-red-50/40",
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-slate-800">{r.itemName}</span>
                          <span className="ml-2 font-mono text-[10px] text-slate-400">{r.itemCode}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.batchNo}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-slate-500">
                            {new Date(r.expiryDate).toLocaleDateString("en-IN", {
                              month: "short", year: "numeric",
                            })}
                          </span>
                          {r.isExpired && <Badge tone="bad" className="ml-2">expired</Badge>}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-slate-600">{r.systemQty}</td>
                        <td className="px-4 py-2.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.001"
                            value={raw ?? ""}
                            placeholder={String(r.systemQty)}
                            onChange={(e) => setCounts((c) => ({ ...c, [r.batchId]: e.target.value }))}
                            className="tabular h-9 w-24 rounded-md bg-white px-2 text-right text-sm ring-1 ring-slate-200 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">
                          {diff === null || diff === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <Badge tone={diff > 0 ? "good" : "bad"}>
                              {diff > 0 ? "+" : ""}{diff}
                            </Badge>
                          )}
                        </td>
                        <td
                          className={cn(
                            "tabular px-4 py-2.5 text-right font-semibold",
                            diff && diff < 0 ? "text-red-600" : "text-slate-800",
                          )}
                        >
                          {diff === null || diff === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            inr(diff * r.rate)
                          )}
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
              placeholder="Who counted, when, and anything unusual"
              className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-400">
              <Info className="mt-px size-3 shrink-0" />
              Saved as a draft. Stock moves only when a different manager approves it.
            </p>
          </div>

          <Card className="p-5">
            <div className="flex items-end justify-between gap-10">
              <div>
                <p className="text-xs text-slate-400">
                  {diffs.length} line{diffs.length === 1 ? "" : "s"} differ
                </p>
                <p className="text-sm text-slate-500">Net value impact</p>
              </div>
              <span
                className={cn(
                  "tabular text-2xl font-bold tracking-tight",
                  netValue < 0 ? "text-red-600" : "text-slate-900",
                )}
              >
                {inr(netValue)}
              </span>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={diffs.length === 0 || busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <SlidersHorizontal className="size-4" />}
              {busy ? "Saving…" : "Raise Adjustment"}
            </Button>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
