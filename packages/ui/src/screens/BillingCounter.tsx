"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search, Trash2, Wifi, WifiOff, CloudUpload, CheckCircle2, TriangleAlert,
  Loader2, LayoutDashboard, Banknote, ShieldAlert,
} from "lucide-react";
import {
  newClientUuid, queueSale, flushQueue, pendingCount, searchOffline,
  fefoOffline, consumeSnapshot, saveSnapshot, snapshotAge, type StockSnapshotRow,
} from "../lib/offline-queue";
import { Badge, Button } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * ────────────────────────────────────────────────────────────────
 *  BILLING COUNTER
 * ────────────────────────────────────────────────────────────────
 *
 *  The constraint that drives every decision here: a pharmacist bills
 *  with one hand on the keyboard and one on the strip. If a bill needs
 *  the mouse, the queue backs up and the software gets blamed. So every
 *  action has a function key, focus returns to search after each add,
 *  and Enter always does the obvious next thing.
 *
 *  Full-bleed by design — no sidebar. A counter screen competing with
 *  navigation is a counter screen that loses.
 */

interface CartLine {
  key: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  mrp: number;
  rate: number;
  gstRate: number;
  schedule: string;
}

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MODES = ["CASH", "UPI", "CARD", "CREDIT"] as const;

export default function BillingCounter() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [snapAge, setSnapAge] = useState<number | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<StockSnapshotRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeLine, setActiveLine] = useState(0);
  const [mode, setMode] = useState<(typeof MODES)[number]>("CASH");
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [session, setSession] = useState<{ storeId: string; storeName: string } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const storeId = session?.storeId ?? "";

  useEffect(() => {
    const raw = localStorage.getItem("vp_session");
    if (!raw) return void (window.location.href = "/login");
    setSession(JSON.parse(raw));
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    addEventListener("online", sync);
    addEventListener("offline", sync);
    return () => {
      removeEventListener("online", sync);
      removeEventListener("offline", sync);
    };
  }, []);

  const refreshQueue = useCallback(() => pendingCount().then(setQueued), []);
  useEffect(() => void refreshQueue(), [refreshQueue]);

  // Flush the backlog the moment the connection returns.
  useEffect(() => {
    if (!online) return;
    (async () => {
      const { sent } = await flushQueue((payload) =>
        fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      if (sent > 0) setToast({ ok: true, text: `${sent} offline bill(s) synced` });
      void refreshQueue();
    })();
  }, [online, refreshQueue]);

  // Without this snapshot the offline mode is decorative — IndexedDB
  // would be empty and an offline search would find nothing.
  useEffect(() => {
    if (!online || !storeId) return;
    const pull = async () => {
      try {
        const res = await fetch(`/api/stock/snapshot?storeId=${storeId}`);
        if (!res.ok) return;
        await saveSnapshot((await res.json()).rows);
        setSnapAge(0);
      } catch {
        /* keep the old snapshot — stale beats none */
      }
    };
    void pull();
    const t = setInterval(pull, 180_000);
    return () => clearInterval(t);
  }, [online, storeId]);

  useEffect(() => {
    if (online) return;
    const t = setInterval(() => void snapshotAge().then(setSnapAge), 30_000);
    void snapshotAge().then(setSnapAge);
    return () => clearInterval(t);
  }, [online]);

  // ── Search ──────────────────────────────────────────────────
  useEffect(() => {
    if (term.trim().length < 2) return setResults([]);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        if (online) {
          const res = await fetch(
            `/api/items/search?q=${encodeURIComponent(term)}&storeId=${storeId}`,
          );
          if (res.ok && !cancelled) {
            setResults((await res.json()).items ?? []);
            setCursor(0);
            return;
          }
        }
        const rows = await searchOffline(term);
        if (!cancelled) {
          setResults(rows);
          setCursor(0);
        }
      } catch {
        if (!cancelled) setResults(await searchOffline(term));
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, online, storeId]);

  // ── Cart ────────────────────────────────────────────────────
  const addItem = useCallback(
    async (row: StockSnapshotRow, want = 1) => {
      try {
        const picks = online
          ? [{ ...row, quantity: Math.min(want, row.quantity) }]
          : await fefoOffline(row.itemId, want);

        setCart((c) => {
          const next = [...c];
          for (const p of picks) {
            const key = `${p.itemId}:${p.batchId}`;
            const at = next.findIndex((l) => l.key === key);
            if (at >= 0) next[at] = { ...next[at], quantity: next[at].quantity + p.quantity };
            else
              next.push({
                key,
                itemId: p.itemId,
                itemName: p.itemName,
                batchId: p.batchId,
                batchNo: p.batchNo,
                expiryDate: p.expiryDate,
                quantity: p.quantity,
                mrp: Number(p.mrp),
                rate: Number(p.saleRate || p.mrp),
                gstRate: Number(p.gstRate),
                schedule: p.schedule,
              });
          }
          setActiveLine(next.length - 1);
          return next;
        });
        setTerm("");
        setResults([]);
        searchRef.current?.focus();
      } catch (e) {
        setToast({ ok: false, text: e instanceof Error ? e.message : "Could not add item." });
      }
    },
    [online],
  );

  const setQty = (i: number, q: number) =>
    setCart((c) => c.map((l, x) => (x === i ? { ...l, quantity: Math.max(0.001, q) } : l)));
  const removeLine = (i: number) => setCart((c) => c.filter((_, x) => x !== i));

  // Display only. The server recomputes everything and its numbers win —
  // never trust a total that came from a browser.
  const totals = useMemo(() => {
    let taxable = 0,
      gst = 0;
    for (const l of cart) {
      const gross = l.quantity * l.rate;
      const t = (gross * 100) / (100 + l.gstRate);
      taxable += t;
      gst += gross - t;
    }
    const net = taxable + gst;
    const rounded = Math.round(net);
    return { taxable, gst, net, rounded, roundOff: rounded - net };
  }, [cart]);

  const needsRx = cart.some((l) => l.schedule === "H1" || l.schedule === "NARCOTIC");

  const reset = useCallback(() => {
    setCart([]);
    setCustomer("");
    setActiveLine(0);
    searchRef.current?.focus();
  }, []);

  const saveBill = useCallback(async () => {
    if (!cart.length || busy) return;
    if (needsRx) {
      setToast({
        ok: false,
        text: "Schedule H1 / narcotic item in cart — link a prescription first.",
      });
      return;
    }
    setBusy(true);
    const clientUuid = newClientUuid();
    const payload = {
      storeId,
      paymentMode: mode,
      customerName: customer || undefined,
      clientUuid,
      isOfflineOrigin: !online,
      lines: cart.map((l) => ({ itemId: l.itemId, batchId: l.batchId, quantity: l.quantity })),
    };

    try {
      if (!online) throw new Error("offline");
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not post the bill.");
      const { sale } = await res.json();
      setToast({ ok: true, text: `${sale.billNo} · ${inr(Number(sale.netAmount))}` });
      reset();
    } catch (e) {
      const offlineNow = !navigator.onLine || (e instanceof Error && e.message === "offline");
      if (offlineNow) {
        await queueSale({ clientUuid, payload, billNo: "OFFLINE", netAmount: totals.rounded.toFixed(2) });
        await consumeSnapshot(cart.map((l) => ({ itemId: l.itemId, batchId: l.batchId, qty: l.quantity })));
        await refreshQueue();
        setToast({ ok: true, text: `Billed offline · ${inr(totals.rounded)} · will sync` });
        reset();
      } else {
        setToast({ ok: false, text: e instanceof Error ? e.message : "Failed." });
      }
    } finally {
      setBusy(false);
    }
  }, [cart, busy, needsRx, storeId, mode, customer, online, totals, refreshQueue, reset]);

  // ── Keyboard ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
      } else if (e.key === "F6") {
        e.preventDefault();
        if (cart.length) removeLine(activeLine);
      } else if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        void saveBill();
      } else if (e.key === "Escape") {
        if (results.length) {
          setResults([]);
          setTerm("");
        } else reset();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [cart, activeLine, results.length, saveBill, reset]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5">
        <Link
          href="/dashboard"
          className="grid size-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          title="Dashboard"
        >
          <LayoutDashboard className="size-4" />
        </Link>
        <div className="h-5 w-px bg-slate-200" />
        <span className="font-semibold text-slate-800">{session?.storeName ?? "Billing Counter"}</span>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
            online
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-amber-50 text-amber-700 ring-amber-200",
          )}
        >
          {online ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {online ? "Online" : "Offline — billing continues"}
        </span>

        {!online && snapAge !== null && (
          <Badge tone="warn">stock as of {Math.round(snapAge / 60000)} min ago</Badge>
        )}
        {queued > 0 && (
          <Badge tone="brand">
            <CloudUpload className="mr-1 inline size-3" />
            {queued} waiting to sync
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
          {[
            ["F2", "search"],
            ["F4", "payment"],
            ["F6", "delete line"],
            ["F9", "save"],
            ["Esc", "clear"],
          ].map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
                {k}
              </kbd>
              {v}
            </span>
          ))}
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 gap-4 p-4">
        {/* Cart side */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-brand-500" />
            <input
              ref={searchRef}
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (!results.length) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  void addItem(results[cursor]);
                }
              }}
              placeholder="Scan barcode or type medicine / salt name…"
              className="h-14 w-full rounded-xl bg-white pl-12 pr-4 text-base shadow-sm ring-2 ring-brand-500 placeholder:text-slate-400 focus:outline-none focus:ring-brand-600"
            />

            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-16 z-20 max-h-72 overflow-auto rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
                {results.map((r, i) => (
                  <li
                    key={`${r.itemId}:${r.batchId}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => void addItem(r)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-4 py-2.5",
                      i === cursor && "bg-brand-50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {r.itemName}
                    </span>
                    {r.schedule !== "NONE" && (
                      <Badge tone={r.schedule === "NARCOTIC" ? "bad" : "warn"}>{r.schedule}</Badge>
                    )}
                    <span className="font-mono text-xs text-slate-400">{r.batchNo}</span>
                    <span className="text-xs text-slate-400">exp {r.expiryDate.slice(0, 7)}</span>
                    <span className="tabular text-xs text-slate-500">{r.quantity} in stock</span>
                    <span className="tabular w-20 text-right text-sm font-semibold text-slate-800">
                      {inr(Number(r.mrp))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
                <tr>
                  {["Item", "Batch", "Expiry"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                  {["Qty", "MRP", "Amount", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-24 text-center">
                      <Search className="mx-auto mb-3 size-8 text-slate-300" />
                      <p className="text-sm text-slate-400">
                        Cart is empty — press{" "}
                        <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                          F2
                        </kbd>{" "}
                        and scan
                      </p>
                    </td>
                  </tr>
                )}
                {cart.map((l, i) => (
                  <tr
                    key={l.key}
                    onClick={() => setActiveLine(i)}
                    className={cn(
                      "cursor-pointer border-b border-slate-50 transition-colors",
                      i === activeLine ? "bg-brand-50/60" : "hover:bg-slate-50",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-slate-800">{l.itemName}</span>
                      {l.schedule !== "NONE" && (
                        <Badge tone={l.schedule === "NARCOTIC" ? "bad" : "warn"} className="ml-2">
                          {l.schedule}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{l.batchNo}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{l.expiryDate.slice(0, 7)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min={0.001}
                        value={l.quantity}
                        onChange={(e) => setQty(i, Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                        className="tabular w-20 rounded-lg border-0 bg-slate-50 px-2 py-1 text-right text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-slate-500">{inr(l.mrp)}</td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold text-slate-800">
                      {inr(l.quantity * l.rate)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLine(i);
                        }}
                        className="grid size-7 place-items-center rounded-md text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Totals side */}
        <aside className="flex w-[340px] shrink-0 flex-col gap-3">
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Patient name (optional)"
            className="h-11 rounded-xl bg-white px-4 text-sm shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {[
              ["Taxable", totals.taxable],
              ["GST", totals.gst],
              ["Round off", totals.roundOff],
            ].map(([label, v]) => (
              <div key={label as string} className="flex justify-between py-1.5 text-sm">
                <span className="text-slate-500">{label as string}</span>
                <span className="tabular text-slate-700">{inr(v as number)}</span>
              </div>
            ))}
            <div className="mt-3 flex items-end justify-between border-t-2 border-slate-100 pt-4">
              <span className="text-sm font-medium text-slate-600">Net payable</span>
              <span className="tabular text-3xl font-bold tracking-tight text-slate-900">
                {inr(totals.rounded)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 rounded-xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg py-2.5 text-xs font-semibold transition-colors",
                  mode === m ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50",
                )}
              >
                {m}
              </button>
            ))}
          </div>

          {needsRx && (
            <div className="flex gap-2.5 rounded-xl bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                Schedule H1 / narcotic item in cart. A linked prescription with the prescriber&apos;s
                registration number is required before this can be dispensed.
              </span>
            </div>
          )}

          <Button
            variant="success"
            className="h-14 text-base"
            disabled={!cart.length || busy}
            onClick={() => void saveBill()}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Banknote className="size-5" />}
            {busy ? "Saving…" : "Save & Print"}
            <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 font-mono text-[10px]">F9</kbd>
          </Button>
        </aside>
      </div>

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-xl px-5 py-3.5 text-sm font-semibold text-white shadow-2xl",
            toast.ok ? "bg-emerald-600" : "bg-red-600",
          )}
        >
          {toast.ok ? <CheckCircle2 className="size-5" /> : <TriangleAlert className="size-5" />}
          {toast.text}
        </div>
      )}
    </div>
  );
}
