"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight, Check, PackageCheck, Truck, Loader2, TriangleAlert, Siren, Info,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { Card, Button, Badge, toneFor, Skeleton } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * One indent, and whichever action is legal at its current status.
 *
 *   SUBMITTED → approve (a manager, possibly for less than requested)
 *   APPROVED  → issue   (FEFO picks batches, main store decrements)
 *   ISSUED    → receive (ward increments; goods leave transit)
 *
 * Only the next legal action is offered. A status machine you can
 * skip steps in is a status machine that will be skipped.
 */

interface Line {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  unitOfSale: string;
  qtyRequested: string;
  qtyApproved: string;
  qtyIssued: string;
  available: number;
  issues: Array<{ id: string; batchId: string; qty: string; rate: string }>;
}

interface Indent {
  id: string;
  indentNo: string;
  indentDate: string;
  status: string;
  isEmergency: boolean;
  remarks: string | null;
  fromStore: { code: string; name: string };
  toStore: { code: string; name: string };
  lines: Line[];
}

const STEPS = ["SUBMITTED", "APPROVED", "ISSUED", "RECEIVED"] as const;

export default function IndentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [indent, setIndent] = useState<Indent | null>(null);
  const [approvals, setApprovals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/indent?id=${id}`);
    const raw = await res.text();
    if (!raw) return setError(`Server returned ${res.status} with no body.`);
    const body = JSON.parse(raw);
    if (!res.ok) return setError(body.error ?? "Could not load the indent.");
    setIndent(body.indent);
    // Pre-fill approvals with the requested quantity — approving in
    // full is the common case, cutting is the exception.
    setApprovals(
      Object.fromEntries(
        (body.indent.lines as Line[]).map((l) => [
          l.id,
          String(Number(l.qtyApproved) || Number(l.qtyRequested)),
        ]),
      ),
    );
  }, [id]);

  useEffect(() => void load(), [load]);

  async function act(action: "approve" | "issue" | "receive") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/indent?id=${id}&action=${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? { approvals: Object.entries(approvals).map(([lineId, q]) => ({ lineId, qtyApproved: q })) }
            : {},
        ),
      });
      const raw = await res.text();
      if (!raw) throw new Error(`Server returned ${res.status} with no body.`);
      const body = JSON.parse(raw);
      if (!res.ok) throw new Error(body.error ?? `Could not ${action}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!indent) {
    return (
      <AppShell>
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40" />
        </div>
      </AppShell>
    );
  }

  const stepIndex = STEPS.indexOf(indent.status as (typeof STEPS)[number]);
  const canApprove = indent.status === "SUBMITTED";
  const canIssue = indent.status === "APPROVED" || indent.status === "PARTIALLY_ISSUED";
  const canReceive = indent.status === "ISSUED";

  // Warn before issuing rather than letting the server 409 —
  // the storekeeper can then cut the approved quantity instead.
  const short = indent.lines.filter(
    (l) => Number(l.qtyApproved || l.qtyRequested) > l.available,
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
              <ArrowLeftRight className="size-6 text-brand-500" />
              <span className="font-mono">{indent.indentNo}</span>
              {indent.isEmergency && (
                <Badge tone="bad">
                  <Siren className="mr-1 inline size-3" />
                  Emergency
                </Badge>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {indent.fromStore.code} → {indent.toStore.code} ·{" "}
              {new Date(indent.indentDate).toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })}
            </p>
          </div>
          <Badge tone={toneFor(indent.status)}>{indent.status.replace(/_/g, " ")}</Badge>
        </div>

        {/* Progress */}
        <Card className="p-5">
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "grid size-8 place-items-center rounded-full text-xs font-bold",
                      i <= stepIndex
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
                    )}
                  >
                    {i < stepIndex ? <Check className="size-4" /> : i + 1}
                  </div>
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      i <= stepIndex ? "text-slate-700" : "text-slate-400",
                    )}
                  >
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "mx-2 mb-5 h-0.5 flex-1 rounded",
                      i < stepIndex ? "bg-brand-500" : "bg-slate-200",
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          {indent.remarks && (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{indent.remarks}</p>
          )}
        </Card>

        {error && (
          <Card className="flex gap-2.5 border-l-4 border-l-red-500 bg-red-50/50 p-4 ring-red-200">
            <TriangleAlert className="size-5 shrink-0 text-red-500" />
            <p className="text-sm text-red-800">{error}</p>
          </Card>
        )}

        {canIssue && short.length > 0 && (
          <Card className="flex gap-2.5 border-l-4 border-l-amber-500 bg-amber-50/50 p-4 ring-amber-200">
            <TriangleAlert className="size-5 shrink-0 text-amber-500" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">
                {short.length} line{short.length === 1 ? "" : "s"} exceed available stock at{" "}
                {indent.fromStore.code}.
              </p>
              <p className="mt-0.5">
                Issuing will fail. Reduce the approved quantity, or receive more stock first.
              </p>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Item</th>
                <th className="w-28 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Requested</th>
                <th className="w-28 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available</th>
                <th className="w-32 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Approved</th>
                <th className="w-28 px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Issued</th>
              </tr>
            </thead>
            <tbody>
              {indent.lines.map((l) => {
                const wanted = Number(approvals[l.id] ?? l.qtyRequested);
                const isShort = wanted > l.available;
                return (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-800">{l.itemName}</span>
                      <span className="ml-2 font-mono text-[10px] text-slate-400">{l.itemCode}</span>
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-slate-600">{Number(l.qtyRequested)}</td>
                    <td className={cn("tabular px-4 py-2.5 text-right", isShort ? "font-semibold text-red-600" : "text-slate-500")}>
                      {l.available}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canApprove ? (
                        <input
                          type="number"
                          step="0.001"
                          max={Number(l.qtyRequested)}
                          value={approvals[l.id] ?? ""}
                          onChange={(e) => setApprovals((a) => ({ ...a, [l.id]: e.target.value }))}
                          className={cn(
                            "tabular h-9 w-24 rounded-md bg-white px-2 text-right text-sm ring-1 focus:outline-none focus:ring-2",
                            isShort ? "ring-amber-400 focus:ring-amber-500" : "ring-slate-200 focus:ring-brand-500",
                          )}
                        />
                      ) : (
                        <span className="tabular text-slate-700">{Number(l.qtyApproved) || "—"}</span>
                      )}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold text-slate-800">
                      {Number(l.qtyIssued) || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
            {canApprove && "Approving less than requested is normal — wards habitually over-request."}
            {canIssue && "Issue picks batches by FEFO and demands 90 days of shelf life for ward stock."}
            {canReceive && "Until the ward confirms, the goods are in transit and belong to neither store."}
            {indent.status === "RECEIVED" && "Complete. Both ledger movements are recorded."}
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => router.push("/indents")}>Back</Button>
            {canApprove && (
              <Button disabled={busy} onClick={() => void act("approve")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Approve
              </Button>
            )}
            {canIssue && (
              <Button disabled={busy} onClick={() => void act("issue")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                Issue (FEFO)
              </Button>
            )}
            {canReceive && (
              <Button variant="success" disabled={busy} onClick={() => void act("receive")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
                Confirm Receipt
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
