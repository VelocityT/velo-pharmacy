"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Inbox, TriangleAlert, Plus, Pencil } from "lucide-react";
import Link from "next/link";
import AppShell from "../components/AppShell";
import FormDrawer from "../components/FormDrawer";
import { Card, Badge, toneFor, Skeleton, EmptyState, Button, Th, Td } from "../components/ui";
import { cn } from "../lib/cn";

interface Column {
  key: string;
  label: string;
  type?: "text" | "money" | "qty" | "date" | "badge" | "bool";
  align?: "left" | "right";
}

interface Payload {
  title: string;
  subtitle: string | null;
  columns: Column[];
  searchable: boolean;
  total: number;
  rows: Record<string, unknown>[];
}

const PAGE = 100;

/** Resources with a form behind them. Must match FORMS in the core registry. */
const EDITABLE = new Set(["items", "suppliers", "doctors", "patients", "stores"]);

const inr = (v: unknown) =>
  "₹" + Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toFixed(2);
};

const fmtDate = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * Every list in the app renders through this one component. The
 * server sends its own column definitions, so a new module needs a
 * config entry and no UI code at all.
 *
 * Search and sorting are server-side on purpose: a 50,000-row item
 * master cannot be filtered in the browser, and building it as if it
 * could is how these screens die at go-live.
 */
export default function ListPage({ resource }: { resource: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<string | null>(null);
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [drawer, setDrawer] = useState<{ open: boolean; id: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), dir });
      if (q.trim()) p.set("q", q.trim());
      if (sort) p.set("sort", sort);

      const res = await fetch(`/api/list/${resource}?${p}`);
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
  }, [resource, q, offset, sort, dir]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => setOffset(0), [q, resource]);

  const cell = (c: Column, v: unknown) => {
    if (v === null || v === undefined || v === "" || v === "—")
      return <span className="text-slate-300">—</span>;
    switch (c.type) {
      case "money":
        return <span className="font-medium">{inr(v)}</span>;
      case "qty":
        return num(v);
      case "date":
        return <span className="text-slate-500">{fmtDate(v)}</span>;
      case "bool":
        return v ? <Badge tone="good">Yes</Badge> : <Badge>No</Badge>;
      case "badge": {
        const s = String(v);
        return <Badge tone={toneFor(s)}>{s.replace(/_/g, " ")}</Badge>;
      }
      default: {
        const s = String(v);
        if (s.startsWith("⚠"))
          return (
            <span className="inline-flex items-center gap-1 text-red-600">
              <TriangleAlert className="size-3.5" />
              {s.replace("⚠", "").trim()}
            </span>
          );
        return s;
      }
    }
  };

  const pages = data ? Math.ceil(data.total / PAGE) : 0;
  const page = Math.floor(offset / PAGE) + 1;

  const totals = useMemo(() => {
    if (!data) return null;
    const cols = data.columns.filter((c) => c.type === "money");
    if (!cols.length || !data.rows.length) return null;
    return Object.fromEntries(
      cols.map((c) => [c.key, data.rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0)]),
    );
  }, [data]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {data?.title ?? <Skeleton className="h-7 w-48" />}
            </h1>
            {data?.subtitle && <p className="mt-0.5 text-sm text-slate-500">{data.subtitle}</p>}
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <span className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                {data.total.toLocaleString("en-IN")} record{data.total === 1 ? "" : "s"}
              </span>
            )}
            {resource === "adjustments" && (
              <Link href="/adjustments/new">
                <Button>
                  <Plus className="size-4" />
                  New Adjustment
                </Button>
              </Link>
            )}
            {resource === "prescriptions" && (
              <Link href="/prescriptions/new">
                <Button>
                  <Plus className="size-4" />
                  New Prescription
                </Button>
              </Link>
            )}
            {resource === "salereturns" && (
              <Link href="/returns/sale">
                <Button>
                  <Plus className="size-4" />
                  New Credit Note
                </Button>
              </Link>
            )}
            {resource === "purchasereturns" && (
              <Link href="/returns/purchase">
                <Button>
                  <Plus className="size-4" />
                  New Debit Note
                </Button>
              </Link>
            )}
            {resource === "indents" && (
              <Link href="/indents/new">
                <Button>
                  <Plus className="size-4" />
                  Raise Indent
                </Button>
              </Link>
            )}
            {resource === "grns" && (
              <Link href="/grns/new">
                <Button>
                  <Plus className="size-4" />
                  New Goods Receipt
                </Button>
              </Link>
            )}
            {EDITABLE.has(resource) && (
              <Button onClick={() => setDrawer({ open: true, id: null })}>
                <Plus className="size-4" />
                New {data?.title?.replace(/s$/, "") ?? "record"}
              </Button>
            )}
          </div>
        </div>

        {data?.searchable && (
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              autoFocus
              className="h-10 w-full rounded-lg bg-white pl-9.5 pr-3 text-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        )}

        {err && (
          <Card className="border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <p className="text-sm font-semibold text-red-800">Could not load this list.</p>
            <p className="mt-0.5 font-mono text-xs text-red-700">{err}</p>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="scrollbar-thin max-h-[calc(100vh-19rem)] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {data?.columns.filter((c) => c.key !== "id").map((c) => {
                    const active = sort === c.key;
                    return (
                      <Th
                        key={c.key}
                        align={c.align}
                        className="cursor-pointer select-none transition-colors hover:bg-slate-100"
                        onClick={() => {
                          if (active) setDir((x) => (x === "asc" ? "desc" : "asc"));
                          else {
                            setSort(c.key);
                            setDir("asc");
                          }
                        }}
                      >
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            c.align === "right" && "flex-row-reverse",
                            active && "text-brand-600",
                          )}
                        >
                          {c.label}
                          {active &&
                            (dir === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            ))}
                        </span>
                      </Th>
                    );
                  })}
                  {EDITABLE.has(resource) && <Th className="w-12" />}
                </tr>
              </thead>
              <tbody>
                {loading &&
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {(data?.columns ?? [{ key: "x", label: "" }]).map((c) => (
                        <Td key={c.key}>
                          <Skeleton className="h-4 w-full" />
                        </Td>
                      ))}
                    </tr>
                  ))}

                {!loading && data?.rows.length === 0 && (
                  <tr>
                    <td colSpan={data.columns.length}>
                      <EmptyState
                        icon={Inbox}
                        title={q ? `Nothing matches “${q}”` : "No records yet"}
                        hint={q ? "Try a shorter search term." : undefined}
                      />
                    </td>
                  </tr>
                )}

                {!loading &&
                  data?.rows.map((r, i) => (
                    <tr
                      key={i}
                      onClick={() => {
                        if (resource === "indents" && r.id)
                          router.push(`/indents/${String(r.id)}`);
                        if (resource === "adjustments" && r.id)
                          router.push(`/adjustments/${String(r.id)}`);
                        if (resource === "sales" && r.billNo)
                          router.push(`/sales/${encodeURIComponent(String(r.billNo))}`);
                      }}
                      className={cn(
                        "transition-colors hover:bg-brand-50/40",
                        ["indents", "sales", "adjustments"].includes(resource) && "cursor-pointer",
                      )}
                    >
                      {data.columns.filter((c) => c.key !== "id").map((c) => (
                        <Td
                          key={c.key}
                          align={c.align}
                          className={cn(
                            c.key === "name" || c.key === "billNo" ? "font-medium text-slate-800" : "text-slate-600",
                            (c.key === "billNo" || c.key === "grnNo" || c.key === "indentNo" || c.key === "code") &&
                              "font-mono text-xs",
                          )}
                        >
                          {cell(c, r[c.key])}
                        </Td>
                      ))}
                      {EDITABLE.has(resource) && (
                        <Td className="w-12 text-right">
                          <button
                            onClick={() => setDrawer({ open: true, id: String(r.id) })}
                            title="Edit"
                            className="grid size-7 place-items-center rounded-md text-slate-300 transition-colors hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </Td>
                      )}
                    </tr>
                  ))}
              </tbody>

              {totals && !loading && data && data.rows.length > 0 && (
                <tfoot className="sticky bottom-0">
                  <tr className="bg-slate-50 font-semibold">
                    {data.columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          "border-t-2 border-slate-200 px-4 py-2.5 text-[13px] text-slate-700",
                          c.align === "right" && "tabular text-right",
                        )}
                      >
                        {i === 0 ? "Page total" : c.key in totals ? inr(totals[c.key]) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-4 text-sm text-slate-500">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
            >
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <span className="tabular text-xs">
              Page {page} of {pages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pages}
              onClick={() => setOffset((o) => o + PAGE)}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {drawer?.open && (
        <FormDrawer
          form={resource}
          id={drawer.id}
          onClose={() => setDrawer(null)}
          onSaved={load}
        />
      )}
    </AppShell>
  );
}
