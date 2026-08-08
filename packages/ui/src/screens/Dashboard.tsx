"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  IndianRupee, Boxes, Hourglass, ArrowLeftRight, ArrowRight, TrendingUp,
  TriangleAlert, ScanBarcode, PackageX, Trophy, ReceiptText, ShieldCheck,
} from "lucide-react";
import AppShell from "../components/AppShell";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Badge, Skeleton, EmptyState, Button,
} from "../components/ui";
import { cn } from "../lib/cn";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const inr2 = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Data {
  today: { bills: number; net: number; gst: number };
  week: Array<{ date: string; net: number }>;
  stock: { skus: number; units: number; value: number };
  expiry: Record<"expired" | "d30" | "d90" | "d180", { batches: number; value: number }>;
  lowStock: Array<{ name: string; onHand: number; minStock: number }>;
  indents: Record<string, number>;
  compliance: { h1Entries: number; narcoticEntries: number; doctorsMissingRegNo: number };
  topItems: Array<{ name: string; qty: number; value: number }>;
  recentBills: Array<{ billNo: string; billDate: string; netAmount: number; customer: string; store: string }>;
}

export default function Dashboard() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        const raw = await res.text();
        if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
        const body = JSON.parse(raw);
        if (!res.ok) throw new Error(body.detail ?? body.error ?? "Failed to load.");
        setD(body);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const atRisk = d ? d.expiry.expired.value + d.expiry.d30.value + d.expiry.d90.value : 0;
  const pending = d ? Object.values(d.indents).reduce((a, b) => a + b, 0) : 0;
  const peak = d ? Math.max(...d.week.map((w) => w.net), 1) : 1;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Live figures — every number is a query, nothing cached
            </p>
          </div>
          <Link href="/billing">
            <Button size="lg">
              <ScanBarcode className="size-4" />
              Open Billing Counter
            </Button>
          </Link>
        </div>

        {err && (
          <Card className="border-l-4 border-l-red-500 bg-red-50/50 ring-red-200">
            <CardContent className="pt-4 text-sm text-red-800">
              <p className="font-semibold">Could not load the dashboard.</p>
              <p className="mt-0.5 font-mono text-xs">{err}</p>
            </CardContent>
          </Card>
        )}

        {/* ── KPIs ──────────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!d && !err
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[108px]" />)
            : d && (
                <>
                  <Kpi
                    icon={IndianRupee}
                    tone="brand"
                    label="Sales today"
                    value={inr2(d.today.net)}
                    sub={`${d.today.bills} bill${d.today.bills === 1 ? "" : "s"} · GST ${inr2(d.today.gst)}`}
                  />
                  <Kpi
                    icon={Boxes}
                    tone="neutral"
                    label="Stock value"
                    value={inr(d.stock.value)}
                    sub={`${d.stock.skus} batches · ${Math.round(d.stock.units).toLocaleString("en-IN")} units`}
                  />
                  <Kpi
                    icon={Hourglass}
                    tone={atRisk > 0 ? "bad" : "good"}
                    label="Expiry at risk"
                    value={inr(atRisk)}
                    sub={`${d.expiry.expired.batches} expired · ${d.expiry.d30.batches} within 30 days`}
                    href="/expiry"
                  />
                  <Kpi
                    icon={ArrowLeftRight}
                    tone={pending > 0 ? "warn" : "good"}
                    label="Indents pending"
                    value={String(pending)}
                    sub={
                      Object.entries(d.indents)
                        .map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, " ")}`)
                        .join(" · ") || "nothing waiting on you"
                    }
                    href="/indents"
                  />
                </>
              )}
        </div>

        {/* ── Charts + panels ───────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-brand-500" />
                  Sales · last 7 days
                </CardTitle>
                <CardDescription>Net of GST, cancelled bills excluded</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {!d ? (
                <Skeleton className="h-48" />
              ) : d.week.length === 0 ? (
                <EmptyState icon={TrendingUp} title="No sales yet this week" />
              ) : (
                <div className="flex h-48 items-end gap-2.5">
                  {d.week.map((w) => (
                    <div key={String(w.date)} className="group flex h-full flex-1 flex-col justify-end">
                      <span className="mb-1.5 text-center text-[10px] font-medium text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                        {inr(w.net)}
                      </span>
                      <div
                        className="rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400 transition-all group-hover:from-brand-700 group-hover:to-brand-500"
                        style={{ height: `${Math.max((w.net / peak) * 100, 3)}%` }}
                      />
                      <span className="mt-2 text-center text-[11px] text-slate-400">
                        {new Date(w.date).toLocaleDateString("en-IN", { weekday: "short" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Hourglass className="size-4 text-amber-500" />
                  Expiry buckets
                </CardTitle>
                <CardDescription>Return while credit value remains</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {!d ? (
                <Skeleton className="h-32" />
              ) : (
                <>
                  {(
                    [
                      ["Already expired", d.expiry.expired, "bad"],
                      ["Within 30 days", d.expiry.d30, "bad"],
                      ["31–90 days", d.expiry.d90, "warn"],
                      ["91–180 days", d.expiry.d180, "neutral"],
                    ] as const
                  ).map(([label, v, tone]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0"
                    >
                      <span className="text-[13px] text-slate-600">{label}</span>
                      <div className="flex items-center gap-2.5">
                        <Badge tone={v.batches > 0 ? tone : "neutral"}>{v.batches}</Badge>
                        <span className="tabular w-20 text-right text-[13px] font-semibold text-slate-700">
                          {inr(v.value)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <Link
                    href="/expiry"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    View all <ArrowRight className="size-3" />
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Low stock"
            desc="At or below reorder level"
            icon={PackageX}
            iconClass="text-red-500"
            loading={!d}
          >
            {d && d.lowStock.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Nothing below reorder level" />
            ) : (
              d?.lowStock.map((l) => (
                <Row key={l.name} label={l.name}>
                  <Badge tone={l.onHand === 0 ? "bad" : "warn"}>
                    {l.onHand === 0 ? "out of stock" : `${l.onHand} left`}
                  </Badge>
                  <span className="tabular text-xs text-slate-400">min {l.minStock}</span>
                </Row>
              ))
            )}
          </Panel>

          <Panel
            title="Top sellers"
            desc="Last 30 days by value"
            icon={Trophy}
            iconClass="text-amber-500"
            loading={!d}
          >
            {d && d.topItems.length === 0 ? (
              <EmptyState icon={Trophy} title="Not enough sales data yet" />
            ) : (
              d?.topItems.map((t, i) => (
                <Row key={t.name} label={t.name} rank={i + 1}>
                  <span className="text-xs text-slate-400">{Math.round(t.qty)} units</span>
                  <span className="tabular text-[13px] font-semibold text-slate-700">
                    {inr(t.value)}
                  </span>
                </Row>
              ))
            )}
          </Panel>

          <Panel
            title="Compliance"
            desc="Registers write themselves"
            icon={ShieldCheck}
            iconClass="text-emerald-500"
            loading={!d}
          >
            {d && (
              <>
                <Row label="Schedule H1 entries">
                  <span className="tabular font-semibold text-slate-700">
                    {d.compliance.h1Entries}
                  </span>
                </Row>
                <Row label="Narcotic register entries">
                  <span className="tabular font-semibold text-slate-700">
                    {d.compliance.narcoticEntries}
                  </span>
                </Row>
                <Row label="Doctors missing reg. no.">
                  <Badge tone={d.compliance.doctorsMissingRegNo > 0 ? "bad" : "good"}>
                    {d.compliance.doctorsMissingRegNo}
                  </Badge>
                </Row>
                {d.compliance.doctorsMissingRegNo > 0 && (
                  <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                    <TriangleAlert className="size-4 shrink-0" />
                    <span>
                      H1 drugs cannot be dispensed against a prescriber with no registration
                      number — the software will refuse the sale.
                    </span>
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>

        {/* ── Recent bills ──────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ReceiptText className="size-4 text-brand-500" />
                Recent bills
              </CardTitle>
            </div>
            <Link
              href="/sales"
              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              All bills <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!d ? (
              <Skeleton className="mx-5 mb-5 h-32" />
            ) : d.recentBills.length === 0 ? (
              <EmptyState icon={ReceiptText} title="No bills yet" hint="Press F2 at the counter." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-slate-100 bg-slate-50/60">
                      {["Bill No", "Date", "Counter", "Patient"].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {h}
                        </th>
                      ))}
                      <th className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Net
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recentBills.map((b) => (
                      <tr key={b.billNo} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-600">{b.billNo}</td>
                        <td className="px-5 py-2.5 text-slate-500">
                          {new Date(b.billDate).toLocaleDateString("en-IN", {
                            day: "2-digit", month: "short",
                          })}
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge>{b.store}</Badge>
                        </td>
                        <td className="px-5 py-2.5 text-slate-700">{b.customer}</td>
                        <td className="tabular px-5 py-2.5 text-right font-semibold text-slate-800">
                          {inr2(b.netAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

/* ── bits ─────────────────────────────────────────────────── */

const KPI_TONE = {
  brand: "from-brand-500 to-brand-600 shadow-brand-600/25",
  good: "from-emerald-500 to-emerald-600 shadow-emerald-600/25",
  warn: "from-amber-500 to-amber-600 shadow-amber-600/25",
  bad: "from-red-500 to-red-600 shadow-red-600/25",
  neutral: "from-slate-500 to-slate-600 shadow-slate-600/25",
} as const;

function Kpi({
  icon: Icon, tone, label, value, sub, href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof KPI_TONE;
  label: string;
  value: string;
  sub: string;
  href?: string;
}) {
  const inner = (
    <Card className={cn("p-5 transition-shadow", href && "cursor-pointer hover:shadow-md")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
            {value}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-400">{sub}</p>
        </div>
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg",
            KPI_TONE[tone],
          )}
        >
          <Icon className="size-[18px]" />
        </div>
      </div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Panel({
  title, desc, icon: Icon, iconClass, loading, children,
}: {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Icon className={cn("size-4", iconClass)} />
            {title}
          </CardTitle>
          <CardDescription>{desc}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{loading ? <Skeleton className="h-32" /> : children}</CardContent>
    </Card>
  );
}

function Row({
  label, rank, children,
}: {
  label: string;
  rank?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <div className="flex min-w-0 items-center gap-2">
        {rank && (
          <span className="grid size-5 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">
            {rank}
          </span>
        )}
        <span className="truncate text-[13px] text-slate-600">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">{children}</div>
    </div>
  );
}
