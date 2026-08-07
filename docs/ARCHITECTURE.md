# Velocare Pharmacy — Architecture

**Product:** Hospital in-house pharmacy ERP
**Positioning:** What Marg is for retail chemists, this is for hospital pharmacies — plus it runs online, which Marg effectively does not.
**Stack:** Next.js 15 (App Router) · TypeScript · PostgreSQL 15 · Prisma · Decimal.js

---

## 1. The offline + online decision

This is the single most important architectural choice in the product, so it gets stated plainly.

Indian hospital pharmacies split into two buying groups:

| Group | What they want | Why |
|---|---|---|
| **Traditional / tier-2-3 hospitals** | Software that runs on *their* server, in *their* building, with no internet dependency | Power cuts, flaky broadband, a genuine belief that patient data must not leave the premises, and a purchase officer who has used Marg on a LAN for 15 years |
| **Modern / chain / corporate hospitals** | Cloud SaaS, multi-branch consolidated reporting, owner dashboard on a phone | Multiple locations, no IT staff, want zero server maintenance |

Building two products to serve both is how agencies die. So: **one codebase, three deployment modes, one schema.**

### Mode A — Cloud SaaS (online)

```
Browser (any counter, any branch)  →  Next.js on Vercel/VPS  →  Managed Postgres (Neon / RDS)
```

Multi-tenant by `hospitalId`. This is the subscription product. Highest margin, zero install.

### Mode B — On-premise LAN (offline)

```
Counter PCs (browser)  →  LAN  →  Hospital server PC
                                   ├── Next.js (standalone build)
                                   └── PostgreSQL 15
                                   [ Docker Compose — one command install ]
```

Zero internet required. Ever. This is the perpetual-licence / AMC product that wins against Marg on the traditional side.

**Why we do not bundle SQLite for this mode.** Tempting, but wrong. The moment the schema diverges (SQLite has no real `DECIMAL`, no `SELECT … FOR UPDATE`, no window functions worth the name, no `SERIALIZABLE`), you are maintaining two data layers and the offline build silently rounds money differently from the online build. Postgres runs perfectly well on a ₹35,000 desktop. Ship the same database everywhere.

Optional: the on-prem node can push an encrypted delta to the cloud overnight, giving the hospital owner a read-only web dashboard and an off-site backup. **This is the upsell that pulls Mode B customers toward Mode A over time**, and it is the thing Marg cannot offer.

### Mode C — Edge counter resilience (offline *inside* online)

Independent of A and B. A cloud-mode counter that loses internet mid-shift must keep billing — a pharmacy that cannot hand a patient a bill is a pharmacy that is closed.

```
Billing counter PWA
├── Service worker: app shell cached
├── IndexedDB: item master + batch stock snapshot for THIS store
├── Bill numbers: pre-reserved block (see §4)
└── Outbox: bills queue locally, flush on reconnect
```

Bounded and deliberate: **only sale, sale-return and indent-request go offline.** GRN, master edits, approvals and reports require connectivity. This is not a limitation to apologise for — receiving goods when you cannot see live stock is how you corrupt an inventory.

---

## 2. Why the ledger design makes offline safe

The schema's core rule — *stock is never a column, every movement appends an immutable `StockLedger` row* — was chosen for drug-recall traceability. It pays a second dividend: **an append-only ledger is a grow-only set, which converges without conflict resolution.** Two nodes appending different rows can merge by union. No last-write-wins, no lost updates, no merge logic.

`StockBalance` is a derived cache, so after any merge it is recomputed:

```sql
SELECT "storeId", "itemId", "batchId", SUM("qtyIn" - "qtyOut")
FROM stock_ledger GROUP BY 1,2,3;
```

That leaves exactly one real hazard: **two nodes both selling the last strip of the same batch while partitioned.** No CRDT solves that — it is a physical resource, not data.

### The store-ownership rule (this is the load-bearing constraint)

> **Every `Store` has exactly one owning node. Only the owning node may write ledger rows that decrement that store's stock.**

Because the schema already models each counter, ward and sub-store as a separate `Store`, and because stock only moves between stores through the `Indent` flow, this maps cleanly onto how a hospital physically works:

- `OPD-01` counter owns its own stock. It can go offline and bill freely — no other node can touch that stock.
- Main store owns central stock. Ward issues go through `Indent`, which is an explicit, approved, two-phase transfer.
- Result: **stock can never go negative from a sync merge.** The worst case is a stale *view* of another store's stock, which is a reporting inconvenience, not a data-integrity failure.

Everything else — masters, patients, suppliers — is last-writer-wins on `updatedAt`, which is correct for reference data.

---

## 3. Sync engine

Outbox pattern with a per-node Lamport counter.

```
Node writes a document
  └─ same transaction: append SyncOutbox row (entity, entityId, op, payload, lamport)

Sync worker (every 30s when online)
  ├─ PUSH: send outbox rows > peer cursor  →  peer applies idempotently by (nodeId, lamport)
  └─ PULL: request rows > our cursor       →  apply, then rebuild affected StockBalance rows
```

Three properties that matter:

1. **Idempotent apply.** `cuid()` primary keys are generated client-side and are collision-free across nodes, so replaying a push is a no-op upsert. Transactional documents also carry `clientUuid` with a unique index — a retried bill cannot double-post.
2. **Ledger rows are never updated or deleted on apply.** Insert-if-absent only. This is enforced in the apply layer, not left to convention.
3. **Ordered by Lamport within a node, unordered across nodes.** Sufficient, because cross-node ordering only matters for stock, and store-ownership already guarantees a single writer per store.

---

## 4. Document numbering when offline

The known killer bug in Indian billing software: two counters generating the same bill number. Online, `DocumentSequence` is row-locked (`SELECT … FOR UPDATE` inside the bill transaction). Offline, there is no shared row to lock.

Solution — **block reservation.** While online, each node reserves a contiguous range:

```
COUNTER-01  →  INV/25-26/  range 1001–2000, nextNumber 1001
COUNTER-02  →  INV/25-26/  range 2001–3000, nextNumber 2001
```

The node bills from its own block offline. Blocks never overlap, so numbers never collide. When a block drops below 15% remaining and the node is online, the next block is reserved automatically.

Cost: gaps in the bill series if a block is abandoned. **This is legally fine under GST** — the requirement is that invoice numbers be unique and sequential *within a series*, and each counter is its own series. A gap is defensible; a duplicate is not.

---

## 5. Multi-tenancy

`hospitalId` on every table, enforced at two layers:

1. **Prisma client extension** — injects `hospitalId` into every `where` and every `create`. The app code never remembers it manually, because eventually it will forget. (This is the exact bug found in the Velocare hospital ERP audit: module gating enforced only in the frontend while the API routes were open. Not repeating it.)
2. **Postgres RLS** in cloud mode — a defence-in-depth backstop if layer 1 is ever bypassed.

Store-level access is a second, independent check via `UserStore`. A ward storekeeper with a valid token still cannot bill at the OPD counter.

---

## 6. Money and quantity

- All money: `Decimal(14,2)`. All quantity: `Decimal(14,3)` — loose tablets and ml fractions are real.
- **Never `Float`, never JS `number` for money.** GST at 5/12/18% on float produces ₹0.01 drift that shows up as a GSTR-1 mismatch three months later and costs a week to trace.
- Rounding is applied once, at bill level, into `roundOff` — never per line.
- GST direction: `supplier.stateCode === hospital.stateCode` → CGST + SGST, else IGST.

---

## 7. Build order

Each step is a hard dependency of the next.

| # | Module | Why here |
|---|---|---|
| 1 | **Stock service** (FEFO + ledger + balance) | Everything writes stock. Get it wrong and every module inherits the bug. |
| 2 | **Sequence service** | Needed by every document. Block reservation built in from day one, not retrofitted. |
| 3 | **GRN entry** | Hardest data entry screen in the app — batch, expiry, free qty, scheme, GST. Build it early while there's appetite for it. |
| 4 | **Billing counter** | Revenue demo. Keyboard-driven, sub-2-second bill, offline-capable. |
| 5 | **Indent workflow** | The module that makes this a hospital pharmacy and not a Marg clone. |
| 6 | **Compliance registers** | H1 + narcotic. Written automatically by the sale service, never hand-entered. |
| 7 | **GST + MIS reports** | GSTR-1/3B, HSN summary, expiry, consumption-by-ward. |
| 8 | **Sync engine** | Designed for from day one; activated last, once there is data worth syncing. |

---

## 8. The commercial risk to solve before writing the import script

**The drug master.** ~50,000 SKUs with composition, HSN and GST slab must be pre-loaded, or staff abandon the software in week one — this is the actual reason pharmacy software fails at go-live, not bugs.

Three options, in order of preference:

1. **Import the hospital's existing Marg / Excel export.** Cheapest, safest, and it makes migration the sales pitch rather than the objection. Ask for the item master during the *sales* conversation, before the contract.
2. Licence a commercial drug dataset — real money, but instant credibility on a greenfield client.
3. Build from a public formulary — slow, and composition/GST mapping will be incomplete.

Do #1 for every deal. Keep #2 in reserve for a client with no incumbent system.
