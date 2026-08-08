"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Loader2, TriangleAlert, CheckCircle2, ArrowLeftRight, Search, Siren, Info,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Input, Label, Badge, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Raise a ward indent.
 *
 * The ward asks for "20 Paracetamol", not for a batch number — batches
 * are chosen at ISSUE time by FEFO, in the supplying store. Asking a
 * nurse to pick a batch is how you get expired stock on a ward.
 */

interface Store { id: string; code: string; name: string; type: string; parentStoreId: string | null }
interface Item { id: string; code: string; name: string; unitOfSale: string }
interface Line { key: string; itemId: string; itemName: string; unit: string; qty: string }

const blank = (): Line => ({ key: crypto.randomUUID(), itemId: "", itemName: "", unit: "", qty: "" });

export default function IndentNew() {
  const router = useRouter();
  const [ref, setRef] = useState<{ stores: Store[]; items: Item[] } | null>(null);
  const [toStoreId, setToStoreId] = useState("");
  const [fromStoreId, setFromStoreId] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ key: string; q: string } | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/indent");
      const raw = await res.text();
      if (!raw) return setError(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) return setError(body.error ?? "Could not load stores.");
      setRef(body);
    })();
  }, []);

  useEffect(() => { if (picker) pickerRef.current?.focus(); }, [picker]);

  // Default the supplying store to the requesting store's parent —
  // that's the hierarchy the store master already describes.
  useEffect(() => {
    if (!ref || !toStoreId) return;
    const to = ref.stores.find((s) => s.id === toStoreId);
    if (to?.parentStoreId) setFromStoreId(to.parentStoreId);
    else {
      const main = ref.stores.find((s) => s.type === "MAIN");
      if (main) setFromStoreId(main.id);
    }
  }, [ref, toStoreId]);

  const matches = useMemo(() => {
    if (!picker || !ref) return [];
    const q = picker.q.trim().toLowerCase();
    if (q.length < 2) return [];
    return ref.items
      .filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
      .slice(0, 12);
  }, [picker, ref]);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/indent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStoreId,
          toStoreId,
          isEmergency: emergency,
          remarks: remarks || undefined,
          lines: lines.filter((l) => l.itemId && l.qty).map((l) => ({ itemId: l.itemId, qtyRequested: l.qty })),
        }),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not raise the indent.");
      setDone(body.indent.indentNo);
      setTimeout(() => router.push("/indents"), 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = toStoreId && fromStoreId && toStoreId !== fromStoreId && lines.some((l) => l.itemId && l.qty);

  if (done) {
    return (
      <AppShell>
        <div className="grid place-items-center py-32 text-center">
          <CheckCircle2 className="mb-4 size-14 text-emerald-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Indent raised</h1>
          <p className="mt-1 font-mono text-sm text-slate-500">{done}</p>
          <p className="mt-3 text-sm text-slate-400">Waiting for approval. Redirecting…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <ArrowLeftRight className="size-6 text-brand-500" />
            Raise Ward Indent
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Request stock from the supplying store. Batches are picked at issue time by FEFO.
          </p>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        <Card className="p-5">
          {!ref ? (
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Requesting Store (ward) <span className="text-red-500">*</span></Label>
                <select
                  value={toStoreId}
                  onChange={(e) => setToStoreId(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select…</option>
                  {ref.stores.filter((s) => s.type !== "MAIN").map((s) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label>Supplying Store <span className="text-red-500">*</span></Label>
                <select
                  value={fromStoreId}
                  onChange={(e) => setFromStoreId(e.target.value)}
                  className="h-10 w-full rounded-lg bg-white px-3 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select…</option>
                  {ref.stores.filter((s) => s.id !== toStoreId).map((s) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Defaults to the parent store</p>
              </div>

              <div className="sm:col-span-2">
                <Label>Remarks</Label>
                <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note for the approver" />
              </div>

              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={emergency}
                  onChange={(e) => setEmergency(e.target.checked)}
                  className="size-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <Siren className="size-4 text-red-500" />
                  Emergency indent
                </span>
              </label>
            </div>
          )}
        </Card>

        <Card className="overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="w-32 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qty Requested</th>
                <th className="w-20 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-slate-100 last:border-0">
                  <td className="relative px-4 py-2">
                    <button
                      onClick={() => setPicker({ key: l.key, q: "" })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50",
                        l.itemId ? "font-medium text-slate-800" : "text-slate-400",
                      )}
                    >
                      {!l.itemId && <Search className="size-3.5" />}
                      {l.itemName || "Select item…"}
                    </button>

                    {picker?.key === l.key && (
                      <div className="absolute left-4 top-full z-30 w-96 rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
                        <input
                          ref={pickerRef}
                          value={picker.q}
                          onChange={(e) => setPicker({ ...picker, q: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setPicker(null);
                            if (e.key === "Enter" && matches[0]) {
                              setLine(l.key, { itemId: matches[0].id, itemName: matches[0].name, unit: matches[0].unitOfSale });
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
                                  setLine(l.key, { itemId: m.id, itemName: m.name, unit: m.unitOfSale });
                                  setPicker(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-brand-50"
                              >
                                <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                                <span className="font-mono text-[10px] text-slate-400">{m.code}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.001"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      className="tabular h-9 w-full rounded-md bg-white px-2 text-right text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{l.unit || "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((x) => x.key !== l.key)))}
                      className="grid size-7 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-3">
            <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>
              <Plus className="size-3.5" /> Add item
            </Button>
          </div>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
            A manager approves — possibly for less than you asked — then the store issues by FEFO
            and the ward confirms receipt.
          </p>
          <Button disabled={!ready || busy} onClick={() => void submit()} size="lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeftRight className="size-4" />}
            {busy ? "Raising…" : "Raise Indent"}
          </Button>
        </div>
      </div>

      {picker && <div className="fixed inset-0 z-20" onClick={() => setPicker(null)} />}
    </AppShell>
  );
}
