"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, CalendarRange, FileSpreadsheet, Inbox } from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Input, Label, Badge, Skeleton, EmptyState, Th, Td } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * All financial reports render through this one component.
 *
 * The date range defaults to month-to-date because that's what an
 * owner checks daily, and the CSV export exists because an accountant
 * will open the numbers in Excel regardless of how nice the screen is.
 */

interface Column {
  key: string;
  label: string;
  type?: "money" | "qty" | "date" | "badge";
  align?: "right";
}

interface Payload {
  title: string;
  subtitle: string;
  columns: Column[];
  from: string;
  to: string;
  rows: Record<string, unknown>[];
  totals: Record<string, number> | null;
}

const inr = (n: unknown) =>
  "₹" + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PRESETS: Array<[string, () => [string, string]]> = [
  ["Today", () => { const d = new Date().toISOString().slice(0, 10); return [d, d]; }],
  ["This month", () => {
    const t = new Date().toISOString().slice(0, 10);
    return [t.slice(0, 8) + "01", t];
  }],
  ["Last month", () => {
    const n = new Date();
    const s = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const e = new Date(n.getFullYear(), n.getMonth(), 0);
    return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
  }],
  ["This FY", () => {
    const n = new Date();
    const y = n.getMonth() + 1 >= 4 ? n.getFullYear() : n.getFullYear() - 1;
    return [`${y}-04-01`, n.toISOString().slice(0, 10)];
  }],
];

export default function ReportPage({ report }: { report: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/reports/${report}?from=${from}&to=${to}`);
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.detail ?? body.error ?? "Failed to load.");
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [report, from, to]);

  useEffect(() => void load(), [load]);

  // Hoisted so the null check narrows for the whole render, including
  // inside callbacks. `data.totals` checked inline would not.
  const totals = data?.totals ?? null;

  const cell = (c: Column, v: unknown) => {
    if (v === null || v === undefined || v === "") return <span className="text-slate-300">—</span>;
    switch (c.type) {
      case "money":
        return inr(v);
      case "qty": {
        const n = Number(v);
        return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toFixed(3);
      }
      case "date":
        return new Date(String(v)).toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
        });
      case "badge":
        return <Badge>{String(v)}</Badge>;
      default:
        return String(v);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
              <FileSpreadsheet className="size-6 text-brand-500" />
              {data?.title ?? <Skeleton className="h-7 w-56" />}
            </h1>
            {data?.subtitle && <p className="mt-0.5 text-sm text-slate-500">{data.subtitle}</p>}
          </div>
          <a href={`/api/reports/${report}?from=${from}&to=${to}&format=csv`} download>
            <Button variant="secondary">
              <Download className="size-4" />
              Export CSV
            </Button>
          </a>
        </div>

        <Card className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex items-center gap-1.5 pb-0.5">
            <CalendarRange className="mr-1 size-4 text-slate-400" />
            {PRESETS.map(([label, fn]) => (
              <button
                key={label}
                onClick={() => {
                  const [f, t] = fn();
                  setFrom(f);
                  setTo(t);
                }}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        {err && (
          <Card className="border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <p className="text-sm font-semibold text-red-800">Could not run this report.</p>
            <p className="mt-0.5 font-mono text-xs text-red-700">{err}</p>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="scrollbar-thin max-h-[calc(100vh-22rem)] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {data?.columns.map((c) => (
                    <Th key={c.key} align={c.align}>{c.label}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {(data?.columns ?? [{ key: "x", label: "" }]).map((c) => (
                        <Td key={c.key}><Skeleton className="h-4 w-full" /></Td>
                      ))}
                    </tr>
                  ))}

                {!loading && data?.rows.length === 0 && (
                  <tr>
                    <td colSpan={data.columns.length}>
                      <EmptyState
                        icon={Inbox}
                        title="No data in this period"
                        hint="Try a wider date range."
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  data?.rows.map((r, i) => (
                    <tr key={i} className="transition-colors hover:bg-brand-50/40">
                      {data.columns.map((c) => (
                        <Td
                          key={c.key}
                          align={c.align}
                          className={cn(
                            c.align === "right" ? "text-slate-700" : "text-slate-600",
                            c.key === "hsnCode" && "font-mono text-xs",
                          )}
                        >
                          {cell(c, r[c.key])}
                        </Td>
                      ))}
                    </tr>
                  ))}
              </tbody>

              {/* `data` is a const binding, so narrowing it here survives
                  into the callback. `data.totals` is a PROPERTY, and
                  property narrowing does not survive — hence the hoisted
                  `totals` const above. Both guards are needed. */}
              {totals && data && !loading && data.rows.length > 0 && (
                <tfoot className="sticky bottom-0">
                  <tr className="bg-slate-50 font-semibold">
                    {data.columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          "border-t-2 border-slate-200 px-4 py-3 text-[13px] text-slate-800",
                          c.align === "right" && "tabular text-right",
                        )}
                      >
                        {i === 0 ? "Grand total" : c.key in totals ? inr(totals[c.key]) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <p className="text-center text-[11px] text-slate-400">
          Figures are for your accountant to file from. This is not a GST filing utility.
        </p>
      </div>
    </AppShell>
  );
}
