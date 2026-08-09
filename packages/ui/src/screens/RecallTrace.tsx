"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert, Users, Phone, Loader2, Printer, Boxes } from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, toneFor, Skeleton, EmptyState } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * Drug recall trace — "who received batch XYZ123?"
 *
 * This is the question a drug inspector actually asks, and the reason
 * stock is modelled as an append-only ledger rather than a quantity
 * column. Retail pharmacy software generally cannot answer it, which
 * makes this a real differentiator rather than a checkbox.
 */

interface BatchHit {
  batchId: string;
  batchNo: string;
  itemName: string;
  expiryDate: string;
  onHand: number;
  dispensed: number;
}

interface Trace {
  batch: {
    batchNo: string;
    expiryDate: string;
    mfgDate: string | null;
    mrp: number;
    purchaseRate: number;
    item: { name: string; code: string; schedule: string };
  };
  patients: Array<{
    billNo: string; billDate: string; qty: number;
    patientName: string | null; patientPhone: string | null;
    store: string; isCancelled: boolean;
  }>;
  movements: Array<{
    txnType: string; qtyIn: number; qtyOut: number;
    refNo: string; store: string; createdAt: string;
  }>;
  summary: { patientsAffected: number; unitsDispensed: number };
}

export default function RecallTrace() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<BatchHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/recall?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok || cancelled) return;
      setHits((await res.json()).batches ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!selected) return setTrace(null);
    setLoading(true);
    (async () => {
      const res = await fetch(`/api/recall?batchId=${selected}`);
      const body = await res.json();
      if (res.ok) setTrace(body);
      setLoading(false);
    })();
  }, [selected]);

  const contactable = useMemo(
    () => trace?.patients.filter((p) => !p.isCancelled && p.patientPhone) ?? [],
    [trace],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <ShieldAlert className="size-6 text-brand-500" />
            Batch Recall Trace
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Every patient who received a given batch — the question a drug inspector asks.
          </p>
        </div>

        <Card className="p-5">
          <div className="relative max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Batch number or medicine name…"
              autoFocus
              className="h-11 w-full rounded-lg bg-white pl-9.5 pr-3 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {hits.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
              {hits.map((b) => (
                <li key={b.batchId}>
                  <button
                    onClick={() => setSelected(b.batchId)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-brand-50",
                      selected === b.batchId && "bg-brand-50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {b.itemName}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{b.batchNo}</span>
                    <span className="text-xs text-slate-400">
                      exp {new Date(b.expiryDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                    </span>
                    <Badge>{b.onHand} on hand</Badge>
                    <Badge tone={b.dispensed > 0 ? "warn" : "neutral"}>{b.dispensed} dispensed</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {loading && <Skeleton className="h-64" />}

        {trace && !loading && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="p-5">
                <p className="text-xs text-slate-500">Batch</p>
                <p className="mt-1 font-mono text-lg font-semibold">{trace.batch.batchNo}</p>
                <p className="mt-0.5 text-sm text-slate-600">{trace.batch.item.name}</p>
                <div className="mt-2 flex gap-2">
                  {trace.batch.item.schedule !== "NONE" && (
                    <Badge tone={toneFor(trace.batch.item.schedule)}>{trace.batch.item.schedule}</Badge>
                  )}
                  <Badge>
                    exp{" "}
                    {new Date(trace.batch.expiryDate).toLocaleDateString("en-IN", {
                      month: "short", year: "numeric",
                    })}
                  </Badge>
                </div>
              </Card>

              <Card className={cn("p-5", trace.summary.patientsAffected > 0 && "ring-red-200 bg-red-50/40")}>
                <p className="text-xs text-slate-500">Patients affected</p>
                <p className="tabular mt-1 text-3xl font-bold tracking-tight text-slate-900">
                  {trace.summary.patientsAffected}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {contactable.length} with a phone number on record
                </p>
              </Card>

              <Card className="p-5">
                <p className="text-xs text-slate-500">Units dispensed</p>
                <p className="tabular mt-1 text-3xl font-bold tracking-tight text-slate-900">
                  {trace.summary.unitsDispensed}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{trace.movements.length} ledger movements</p>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="size-4 text-red-500" />
                    Patients who received this batch
                  </CardTitle>
                  <CardDescription>Contact list for a recall notice</CardDescription>
                </div>
                {contactable.length > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => window.print()}>
                    <Printer className="size-3.5" />
                    Print list
                  </Button>
                )}
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {trace.patients.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="Nothing from this batch has been dispensed"
                    hint="It is still in stock — quarantine it with a RECALL stock adjustment."
                  />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-y border-slate-100 bg-slate-50/60">
                        {["Patient", "Phone", "Bill No", "Date", "Counter", "Qty", ""].map((h, i) => (
                          <th
                            key={h || i}
                            className={cn(
                              "px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                              i === 5 ? "text-right" : "text-left",
                            )}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trace.patients.map((p, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-slate-50 last:border-0",
                            p.isCancelled && "opacity-45",
                          )}
                        >
                          <td className="px-5 py-2.5 font-medium text-slate-800">
                            {p.patientName ?? "Walk-in"}
                          </td>
                          <td className="px-5 py-2.5">
                            {p.patientPhone ? (
                              <span className="inline-flex items-center gap-1.5 text-slate-600">
                                <Phone className="size-3" />
                                {p.patientPhone}
                              </span>
                            ) : (
                              <span className="text-slate-300">no contact</span>
                            )}
                          </td>
                          <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{p.billNo}</td>
                          <td className="px-5 py-2.5 text-slate-500">
                            {new Date(p.billDate).toLocaleDateString("en-IN", {
                              day: "2-digit", month: "short", year: "numeric",
                            })}
                          </td>
                          <td className="px-5 py-2.5">
                            <Badge>{p.store}</Badge>
                          </td>
                          <td className="tabular px-5 py-2.5 text-right font-semibold">{p.qty}</td>
                          <td className="px-5 py-2.5">
                            {p.isCancelled && <Badge tone="bad">cancelled</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Boxes className="size-4 text-brand-500" />
                    Full movement history
                  </CardTitle>
                  <CardDescription>Every entry and exit for this batch, oldest last</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-slate-100 bg-slate-50/60">
                      {["When", "Type", "Store", "In", "Out", "Document"].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            "px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                            i === 3 || i === 4 ? "text-right" : "text-left",
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trace.movements.map((m, i) => (
                      <tr key={i} className="border-b border-slate-50 last:border-0">
                        <td className="px-5 py-2.5 text-slate-500">
                          {new Date(m.createdAt).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge tone={toneFor(m.txnType)}>{m.txnType.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge>{m.store}</Badge>
                        </td>
                        <td className="tabular px-5 py-2.5 text-right text-emerald-600">
                          {m.qtyIn > 0 ? m.qtyIn : ""}
                        </td>
                        <td className="tabular px-5 py-2.5 text-right text-red-600">
                          {m.qtyOut > 0 ? m.qtyOut : ""}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{m.refNo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        {!trace && !loading && q.length < 2 && (
          <EmptyState
            icon={ShieldAlert}
            title="Search for a batch"
            hint="Type a batch number or medicine name. This works because every stock movement is an immutable ledger row — nothing is ever overwritten."
          />
        )}
      </div>
    </AppShell>
  );
}
