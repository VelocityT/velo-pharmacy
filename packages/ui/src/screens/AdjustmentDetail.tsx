"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SlidersHorizontal, ShieldCheck, Loader2, TriangleAlert, Info, UserX,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Badge, toneFor, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * One adjustment, with the approve action if it's legal.
 *
 * The control this screen enforces: an adjustment must be approved by
 * someone OTHER than the person who raised it. That is checked on the
 * server too — this screen just explains why the button is missing,
 * because a disabled button with no reason is how people conclude the
 * software is broken and go round it.
 */

interface Line {
  id: string;
  itemName: string;
  itemCode: string;
  batchNo: string;
  expiryDate: string | null;
  systemQty: string;
  actualQty: string;
  diffQty: string;
  rate: string;
}

interface Adjustment {
  id: string;
  adjNo: string;
  adjDate: string;
  reason: string;
  remarks: string | null;
  isPosted: boolean;
  createdByName: string;
  approvedAt: string | null;
  lines: Line[];
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdjustmentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [adj, setAdj] = useState<Adjustment | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/adjustment?id=${id}`);
    const raw = await res.text();
    if (!raw) return setError(`Server returned ${res.status} with no body.`);
    const body = JSON.parse(raw);
    if (!res.ok) return setError(body.error ?? "Could not load the adjustment.");
    setAdj(body.adjustment);
    setCanApprove(Boolean(body.canApprove));
  }, [id]);

  useEffect(() => void load(), [load]);

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/adjustment?id=${id}&action=approve`, { method: "PATCH" });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? "Could not approve.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!adj) {
    return (
      <AppShell>
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40" />
        </div>
      </AppShell>
    );
  }

  const netUnits = adj.lines.reduce((a, l) => a + Number(l.diffQty), 0);
  const netValue = adj.lines.reduce((a, l) => a + Number(l.diffQty) * Number(l.rate), 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
              <SlidersHorizontal className="size-6 text-brand-500" />
              <span className="font-mono">{adj.adjNo}</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {adj.reason.replace(/_/g, " ").toLowerCase()} ·{" "}
              {new Date(adj.adjDate).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })}{" "}
              · raised by {adj.createdByName}
            </p>
          </div>
          <Badge tone={adj.isPosted ? "good" : "warn"}>{adj.isPosted ? "POSTED" : "DRAFT"}</Badge>
        </div>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        {!adj.isPosted && !canApprove && (
          <Card className="flex gap-2.5 border-l-4 border-l-amber-500 bg-amber-50/50 p-4 ring-amber-200">
            <UserX className="size-5 shrink-0 text-amber-500" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">You cannot approve this adjustment.</p>
              <p className="mt-0.5">
                It must be approved by a pharmacy manager other than {adj.createdByName}, who
                raised it. Anyone able to write stock off unilaterally is anyone able to steal —
                that separation is the control, not a formality.
              </p>
            </div>
          </Card>
        )}

        {adj.remarks && (
          <Card className="p-4">
            <p className="text-sm text-slate-600">{adj.remarks}</p>
          </Card>
        )}

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {["Item", "Batch", "Expiry", "System", "Counted", "Difference", "Value"].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                      i >= 3 ? "text-right" : "text-left",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adj.lines.map((l) => {
                const diff = Number(l.diffQty);
                return (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-800">{l.itemName}</span>
                      <span className="ml-2 font-mono text-[10px] text-slate-400">{l.itemCode}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{l.batchNo}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {l.expiryDate
                        ? new Date(l.expiryDate).toLocaleDateString("en-IN", {
                            month: "short", year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-slate-600">
                      {Number(l.systemQty)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-slate-600">
                      {Number(l.actualQty)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Badge tone={diff > 0 ? "good" : "bad"}>
                        {diff > 0 ? "+" : ""}
                        {diff}
                      </Badge>
                    </td>
                    <td
                      className={cn(
                        "tabular px-4 py-2.5 text-right font-semibold",
                        diff < 0 ? "text-red-600" : "text-slate-800",
                      )}
                    >
                      {inr(diff * Number(l.rate))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={5} className="border-t-2 border-slate-200 px-4 py-3 text-slate-700">
                  Net impact
                </td>
                <td className="tabular border-t-2 border-slate-200 px-4 py-3 text-right text-slate-700">
                  {netUnits > 0 ? "+" : ""}
                  {netUnits} units
                </td>
                <td
                  className={cn(
                    "tabular border-t-2 border-slate-200 px-4 py-3 text-right",
                    netValue < 0 ? "text-red-600" : "text-slate-800",
                  )}
                >
                  {inr(netValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
            {adj.isPosted
              ? "Posted. The ledger carries a permanent row for every line, with a name against it."
              : "Stock has not moved. Approving posts every line to the ledger, and cannot be undone — reverse it with a second adjustment if needed."}
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/adjustments")}>
              Back
            </Button>
            {!adj.isPosted && canApprove && (
              <Button variant="success" disabled={busy} onClick={() => void approve()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Approve & Post
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
