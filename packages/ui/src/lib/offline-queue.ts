"use client";

import { openDB, type IDBPDatabase } from "idb";

/**
 * ────────────────────────────────────────────────────────────────
 *  COUNTER OFFLINE QUEUE
 * ────────────────────────────────────────────────────────────────
 *
 *  A pharmacy that cannot hand a patient a bill is a pharmacy that
 *  is closed. When the connection drops mid-shift, billing continues
 *  against a local snapshot and the bills flush when it returns.
 *
 *  Deliberately bounded. Only SALE, SALE_RETURN and INDENT_REQUEST
 *  go offline. GRN, master edits, approvals and reports require a
 *  connection — receiving goods against stock you cannot see live
 *  is how an inventory gets corrupted, and no amount of sync design
 *  fixes that.
 *
 *  Every queued bill carries a clientUuid minted BEFORE it is sent.
 *  The server upserts on that key, so a flush that half-succeeds
 *  and retries cannot double-post a bill.
 */

const DB_NAME = "velocare-pharmacy";
const DB_VERSION = 1;

export interface QueuedSale {
  clientUuid: string;
  payload: unknown;
  billNo: string;
  netAmount: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: "PENDING" | "SYNCING" | "FAILED";
}

export interface StockSnapshotRow {
  key: string; // `${itemId}:${batchId}`
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  mrp: string;
  saleRate: string;
  gstRate: string;
  barcode?: string;
  schedule: string;
  snapshotAt: number;
}

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("outbox")) {
          const s = d.createObjectStore("outbox", { keyPath: "clientUuid" });
          s.createIndex("status", "status");
          s.createIndex("createdAt", "createdAt");
        }
        if (!d.objectStoreNames.contains("stock")) {
          const s = d.createObjectStore("stock", { keyPath: "key" });
          s.createIndex("itemId", "itemId");
          s.createIndex("barcode", "barcode");
        }
        if (!d.objectStoreNames.contains("meta")) {
          d.createObjectStore("meta");
        }
      },
    });
  }
  return dbp;
}

export const newClientUuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// ── Outbox ────────────────────────────────────────────────────

export async function queueSale(entry: Omit<QueuedSale, "attempts" | "status" | "createdAt">) {
  const d = await db();
  await d.put("outbox", { ...entry, attempts: 0, status: "PENDING", createdAt: Date.now() });
}

export async function pendingSales(): Promise<QueuedSale[]> {
  const d = await db();
  const all = (await d.getAll("outbox")) as QueuedSale[];
  return all.filter((s) => s.status !== "SYNCING").sort((a, b) => a.createdAt - b.createdAt);
}

export async function pendingCount(): Promise<number> {
  return (await pendingSales()).length;
}

/**
 * Flush the queue. Sequential on purpose — bills must reach the
 * server in the order they were raised so the day book reads
 * correctly, and a parallel flush gains nothing at pharmacy volumes.
 */
export async function flushQueue(
  post: (payload: unknown) => Promise<Response>,
): Promise<{ sent: number; failed: number }> {
  const d = await db();
  const queue = await pendingSales();
  let sent = 0;
  let failed = 0;

  for (const item of queue) {
    await d.put("outbox", { ...item, status: "SYNCING" });
    try {
      const res = await post(item.payload);
      if (res.ok) {
        await d.delete("outbox", item.clientUuid);
        sent++;
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // A 4xx will never succeed on retry — a validation error, or
        // stock that no longer exists. Park it for a human instead of
        // retrying forever.
        await d.put("outbox", {
          ...item,
          status: "FAILED",
          attempts: item.attempts + 1,
          lastError: `${res.status} ${await res.text().catch(() => "")}`.slice(0, 300),
        });
        failed++;
      } else {
        await d.put("outbox", { ...item, status: "PENDING", attempts: item.attempts + 1 });
        failed++;
      }
    } catch (e) {
      await d.put("outbox", {
        ...item,
        status: "PENDING",
        attempts: item.attempts + 1,
        lastError: e instanceof Error ? e.message : String(e),
      });
      failed++;
      break; // still offline — stop hammering
    }
  }

  return { sent, failed };
}

// ── Stock snapshot ────────────────────────────────────────────

/** Refreshed on login and every few minutes while online. */
export async function saveSnapshot(rows: StockSnapshotRow[]) {
  const d = await db();
  const tx = d.transaction("stock", "readwrite");
  await Promise.all(rows.map((r) => tx.store.put(r)));
  await tx.done;
  await d.put("meta", Date.now(), "snapshotAt");
}

export async function snapshotAge(): Promise<number | null> {
  const d = await db();
  const at = (await d.get("meta", "snapshotAt")) as number | undefined;
  return at ? Date.now() - at : null;
}

/** Offline item search: name prefix, barcode exact, or salt. */
export async function searchOffline(term: string, limit = 20): Promise<StockSnapshotRow[]> {
  const d = await db();
  const all = (await d.getAll("stock")) as StockSnapshotRow[];
  const q = term.trim().toLowerCase();
  if (!q) return [];

  const exact = all.filter((r) => r.barcode === term.trim());
  if (exact.length) return exact.slice(0, limit);

  return all
    .filter((r) => r.itemName.toLowerCase().includes(q) && r.quantity > 0)
    .sort(
      (a, b) =>
        Number(a.itemName.toLowerCase().indexOf(q)) - Number(b.itemName.toLowerCase().indexOf(q)) ||
        a.expiryDate.localeCompare(b.expiryDate),
    )
    .slice(0, limit);
}

/** Client-side FEFO so an offline bill picks the same batch the server would. */
export async function fefoOffline(itemId: string, want: number): Promise<StockSnapshotRow[]> {
  const d = await db();
  const rows = ((await d.getAllFromIndex("stock", "itemId", itemId)) as StockSnapshotRow[])
    .filter((r) => r.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.quantity - b.quantity);

  const out: StockSnapshotRow[] = [];
  let remaining = want;
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(r.quantity, remaining);
    out.push({ ...r, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) throw new Error(`Only ${want - remaining} available offline for this item.`);
  return out;
}

/** Decrement the local snapshot so the next offline bill sees the truth. */
export async function consumeSnapshot(picks: Array<{ itemId: string; batchId: string; qty: number }>) {
  const d = await db();
  const tx = d.transaction("stock", "readwrite");
  for (const p of picks) {
    const key = `${p.itemId}:${p.batchId}`;
    const row = (await tx.store.get(key)) as StockSnapshotRow | undefined;
    if (row) await tx.store.put({ ...row, quantity: Math.max(0, row.quantity - p.qty) });
  }
  await tx.done;
}
