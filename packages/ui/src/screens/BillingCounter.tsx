"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  newClientUuid,
  queueSale,
  flushQueue,
  pendingCount,
  searchOffline,
  fefoOffline,
  consumeSnapshot,
  saveSnapshot,
  snapshotAge,
  type StockSnapshotRow,
} from "@velocare/ui/lib/offline-queue";

/**
 * ────────────────────────────────────────────────────────────────
 *  BILLING COUNTER
 * ────────────────────────────────────────────────────────────────
 *
 *  Design constraint that drives everything here: a pharmacist bills
 *  with one hand on the keyboard and one on the strip. If a bill
 *  needs the mouse, the queue backs up and the software gets blamed.
 *  So: every action has a function key, focus never leaves the search
 *  box unless the user sends it elsewhere, and Enter always does the
 *  obvious next thing.
 *
 *  Keys
 *    F2            search box
 *    ↑ ↓ Enter     pick an item
 *    F4            cycle payment mode
 *    F6            delete the highlighted line
 *    F9 / Ctrl+↵   save and print
 *    Esc           clear the cart
 *
 *  Offline: when the connection drops the bill is queued locally
 *  against a stock snapshot and flushed on reconnect. The cashier
 *  sees the state change; they never see an error.
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

const money = (n: number) =>
  "₹" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT"] as const;

export default function BillingCounterPage() {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<StockSnapshotRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeLine, setActiveLine] = useState(0);
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODES)[number]>("CASH");
  const [customerName, setCustomerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Which counter this machine is. Read from the session saved at
  // login — an offline browser cannot go and ask the server.
  const [session, setSession] = useState<{
    storeId: string;
    storeName: string;
    nodeKey: string;
  } | null>(null);
  const [snapAge, setSnapAge] = useState<number | null>(null);

  const storeId = session?.storeId ?? "";

  useEffect(() => {
    const raw = localStorage.getItem("vp_session");
    if (!raw) {
      window.location.href = "/login";
      return;
    }
    setSession(JSON.parse(raw));
  }, []);

  // ── Connectivity ────────────────────────────────────────────
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const refreshQueue = useCallback(() => pendingCount().then(setQueued), []);
  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

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
      if (sent > 0) setToast({ kind: "ok", text: `${sent} offline bill(s) synced.` });
      refreshQueue();
    })();
  }, [online, refreshQueue]);

  // ── Offline snapshot ────────────────────────────────────────
  // Without this the offline mode is decorative: IndexedDB would be
  // empty and an offline search would find nothing. Pulled on login
  // and refreshed every 3 minutes while connected, so the counter is
  // always at most 3 minutes stale when the line drops.
  useEffect(() => {
    if (!online || !storeId) return;

    const pull = async () => {
      try {
        const res = await fetch(`/api/stock/snapshot?storeId=${storeId}`);
        if (!res.ok) return;
        const body = await res.json();
        await saveSnapshot(body.rows);
        setSnapAge(0);
      } catch {
        /* stay on the old snapshot — a stale snapshot beats none */
      }
    };

    void pull();
    const t = setInterval(pull, 180_000);
    return () => clearInterval(t);
  }, [online, storeId]);

  // Surface snapshot staleness while offline — the cashier should know
  // how old the stock figures they are billing against actually are.
  useEffect(() => {
    if (online) return;
    const t = setInterval(() => void snapshotAge().then(setSnapAge), 30_000);
    void snapshotAge().then(setSnapAge);
    return () => clearInterval(t);
  }, [online]);

  // ── Search ──────────────────────────────────────────────────
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
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
  const addItem = useCallback(async (row: StockSnapshotRow, want = 1) => {
    try {
      // Pick batches the same way the server will, so what the
      // patient is quoted matches what the bill finally says.
      const picks = online
        ? [{ ...row, quantity: Math.min(want, row.quantity) }]
        : await fefoOffline(row.itemId, want);

      setCart((c) => {
        const next = [...c];
        for (const p of picks) {
          const key = `${p.itemId}:${p.batchId}`;
          const existing = next.findIndex((l) => l.key === key);
          if (existing >= 0) {
            next[existing] = { ...next[existing], quantity: next[existing].quantity + p.quantity };
          } else {
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
        }
        setActiveLine(next.length - 1);
        return next;
      });

      setTerm("");
      setResults([]);
      searchRef.current?.focus();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Could not add item." });
    }
  }, [online]);

  const setQty = (idx: number, q: number) =>
    setCart((c) => c.map((l, i) => (i === idx ? { ...l, quantity: Math.max(0.001, q) } : l)));

  const removeLine = (idx: number) => setCart((c) => c.filter((_, i) => i !== idx));

  // ── Totals ──────────────────────────────────────────────────
  // Display only. The server recomputes everything and its numbers win —
  // never trust a total that came from a browser.
  const totals = useMemo(() => {
    let taxable = 0;
    let gst = 0;
    for (const l of cart) {
      const gross = l.quantity * l.rate;
      const t = (gross * 100) / (100 + l.gstRate); // MRP is GST-inclusive
      taxable += t;
      gst += gross - t;
    }
    const net = taxable + gst;
    const rounded = Math.round(net);
    return { taxable, gst, net, rounded, roundOff: rounded - net };
  }, [cart]);

  const needsRx = cart.some((l) => l.schedule === "H1" || l.schedule === "NARCOTIC");

  // ── Save ────────────────────────────────────────────────────
  const saveBill = useCallback(async () => {
    if (!cart.length || busy) return;
    if (needsRx) {
      setToast({
        kind: "err",
        text: "Cart contains Schedule H1 / narcotic items — link a prescription before billing.",
      });
      return;
    }

    setBusy(true);
    const clientUuid = newClientUuid();
    const payload = {
      storeId,
      paymentMode,
      customerName: customerName || undefined,
      clientUuid,
      isOfflineOrigin: !online,
      lines: cart.map((l) => ({
        itemId: l.itemId,
        batchId: l.batchId,
        quantity: l.quantity,
      })),
    };

    try {
      if (!online) throw new Error("offline");

      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not post the bill.");
      }

      const { sale } = await res.json();
      setToast({ kind: "ok", text: `${sale.billNo} · ${money(Number(sale.netAmount))}` });
      resetCart();
    } catch (e) {
      const offlineNow = !navigator.onLine || (e instanceof Error && e.message === "offline");
      if (offlineNow) {
        await queueSale({
          clientUuid,
          payload,
          billNo: "OFFLINE",
          netAmount: totals.rounded.toFixed(2),
        });
        await consumeSnapshot(
          cart.map((l) => ({ itemId: l.itemId, batchId: l.batchId, qty: l.quantity })),
        );
        await refreshQueue();
        setToast({ kind: "ok", text: `Billed offline · ${money(totals.rounded)} · will sync` });
        resetCart();
      } else {
        setToast({ kind: "err", text: e instanceof Error ? e.message : "Failed." });
      }
    } finally {
      setBusy(false);
    }
  }, [cart, busy, needsRx, storeId, paymentMode, customerName, online, totals, refreshQueue]);

  function resetCart() {
    setCart([]);
    setCustomerName("");
    setActiveLine(0);
    searchRef.current?.focus();
  }

  // ── Keyboard ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        setPaymentMode((m) => PAYMENT_MODES[(PAYMENT_MODES.indexOf(m) + 1) % PAYMENT_MODES.length]);
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
        } else resetCart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart, activeLine, results.length, saveBill]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="pos">
      <header className="bar">
        <strong>{session?.storeName ?? "Billing Counter"}</strong>
        <span className={online ? "pill ok" : "pill warn"}>
          {online ? "Online" : "Offline — billing continues"}
        </span>
        {!online && snapAge !== null && (
          <span className="pill warn">
            stock as of {Math.round(snapAge / 60000)} min ago
          </span>
        )}
        {queued > 0 && <span className="pill info">{queued} bill(s) waiting to sync</span>}
        <span className="spacer" />
        <span className="keys">F2 search · F4 payment · F6 delete line · F9 save · Esc clear</span>
      </header>

      <div className="grid">
        <section className="left">
          <input
            ref={searchRef}
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Scan barcode or type medicine / salt name…"
            className="search"
          />

          {results.length > 0 && (
            <ul className="results">
              {results.map((r, i) => (
                <li
                  key={`${r.itemId}:${r.batchId}`}
                  className={i === cursor ? "row sel" : "row"}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => void addItem(r)}
                >
                  <span className="nm">{r.itemName}</span>
                  <span className="mut">
                    {r.batchNo} · exp {r.expiryDate.slice(0, 7)}
                  </span>
                  <span className="mut">Qty {r.quantity}</span>
                  <span className="amt">{money(Number(r.mrp))}</span>
                </li>
              ))}
            </ul>
          )}

          <table className="cart">
            <thead>
              <tr>
                <th>Item</th>
                <th>Batch</th>
                <th>Exp</th>
                <th className="r">Qty</th>
                <th className="r">MRP</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    Cart is empty — press F2 and scan
                  </td>
                </tr>
              )}
              {cart.map((l, i) => (
                <tr
                  key={l.key}
                  className={i === activeLine ? "sel" : ""}
                  onClick={() => setActiveLine(i)}
                >
                  <td>
                    {l.itemName}
                    {l.schedule !== "NONE" && <em className="sched"> {l.schedule}</em>}
                  </td>
                  <td className="mut">{l.batchNo}</td>
                  <td className="mut">{l.expiryDate.slice(0, 7)}</td>
                  <td className="r">
                    <input
                      type="number"
                      min={0.001}
                      step={1}
                      value={l.quantity}
                      onChange={(e) => setQty(i, Number(e.target.value))}
                      className="qty"
                    />
                  </td>
                  <td className="r">{money(l.mrp)}</td>
                  <td className="r">{money(l.quantity * l.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="right">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Patient name (optional)"
            className="cust"
          />

          <div className="tot">
            <div>
              <span>Taxable</span>
              <b>{money(totals.taxable)}</b>
            </div>
            <div>
              <span>GST</span>
              <b>{money(totals.gst)}</b>
            </div>
            <div>
              <span>Round off</span>
              <b>{money(totals.roundOff)}</b>
            </div>
            <div className="net">
              <span>Net payable</span>
              <b>{money(totals.rounded)}</b>
            </div>
          </div>

          <button className="mode" onClick={() => setPaymentMode((m) => PAYMENT_MODES[(PAYMENT_MODES.indexOf(m) + 1) % PAYMENT_MODES.length])}>
            {paymentMode} <small>F4</small>
          </button>

          {needsRx && (
            <p className="rxwarn">
              Schedule H1 / narcotic item in cart. A linked prescription with the
              prescriber&apos;s registration number is required before this can be dispensed.
            </p>
          )}

          <button className="save" disabled={!cart.length || busy} onClick={() => void saveBill()}>
            {busy ? "Saving…" : "Save & Print"} <small>F9</small>
          </button>
        </aside>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      <style jsx>{`
        .pos { font: 14px/1.45 system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; background: #f6f7f9; }
        .bar { display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e3e6ea; }
        .spacer { flex: 1; }
        .keys { color: #8a929c; font-size: 12px; }
        .pill { padding: 2px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .pill.ok { background: #e7f6ed; color: #1a7f43; }
        .pill.warn { background: #fdf0e3; color: #a35b00; }
        .pill.info { background: #e8effd; color: #1c50b5; }
        .grid { flex: 1; display: grid; grid-template-columns: 1fr 320px; gap: 12px; padding: 12px; overflow: hidden; }
        .left, .right { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 12px; overflow: auto; }
        .search { width: 100%; padding: 12px 14px; font-size: 16px; border: 2px solid #2563eb; border-radius: 8px; outline: none; }
        .results { list-style: none; margin: 6px 0 0; padding: 0; max-height: 240px; overflow: auto; border: 1px solid #e3e6ea; border-radius: 8px; }
        .row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f2f4; }
        .row.sel { background: #eef4ff; }
        .nm { font-weight: 600; }
        .mut { color: #8a929c; font-size: 12px; }
        .amt { font-variant-numeric: tabular-nums; font-weight: 600; }
        .cart { width: 100%; border-collapse: collapse; margin-top: 14px; }
        .cart th { text-align: left; font-size: 12px; color: #8a929c; border-bottom: 1px solid #e3e6ea; padding: 6px 8px; }
        .cart td { padding: 6px 8px; border-bottom: 1px solid #f4f5f7; }
        .cart tr.sel { background: #f5f8ff; }
        .r { text-align: right; font-variant-numeric: tabular-nums; }
        .empty { text-align: center; color: #a6adb6; padding: 40px 0; }
        .qty { width: 70px; text-align: right; padding: 4px 6px; border: 1px solid #d6dae0; border-radius: 6px; }
        .sched { color: #b4232a; font-style: normal; font-size: 11px; font-weight: 700; }
        .cust { width: 100%; padding: 9px 12px; border: 1px solid #d6dae0; border-radius: 8px; margin-bottom: 12px; }
        .tot div { display: flex; justify-content: space-between; padding: 6px 0; font-variant-numeric: tabular-nums; }
        .tot .net { border-top: 2px solid #e3e6ea; margin-top: 6px; padding-top: 10px; font-size: 20px; }
        .mode, .save { width: 100%; margin-top: 10px; padding: 12px; border-radius: 8px; border: 1px solid #d6dae0; background: #fff; font-weight: 700; cursor: pointer; }
        .save { background: #16a34a; border-color: #16a34a; color: #fff; font-size: 16px; }
        .save:disabled { background: #cfd4da; border-color: #cfd4da; cursor: not-allowed; }
        .mode small, .save small { opacity: 0.65; font-weight: 500; margin-left: 6px; }
        .rxwarn { margin-top: 12px; padding: 10px; background: #fdf0e3; color: #8a4b00; border-radius: 8px; font-size: 12px; }
        .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 22px; border-radius: 10px; color: #fff; font-weight: 600; }
        .toast.ok { background: #16a34a; }
        .toast.err { background: #dc2626; }
      `}</style>
    </div>
  );
}
