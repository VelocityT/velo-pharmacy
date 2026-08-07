# Velocare Pharmacy

Hospital pharmacy ERP, sold as **two separate products** from one shared core.

| Edition | Product | Sold as | Runs |
|---|---|---|---|
| `apps/cloud` | **Velocare Pharmacy Cloud** | subscription, per counter or per hospital | Vercel / VPS + managed Postgres |
| `apps/onprem` | **Velocare Pharmacy Server** | perpetual licence + AMC | the hospital's own server PC, no internet ever |

---

## Why one core and not two codebases

You asked for the two products to be separate entities. They are — separate folders, separate `package.json`, separate branding, separate installers, separate price points. A client buying one never sees the other.

What they **share** is `packages/core`: the schema, the stock ledger, FEFO allocation, GST maths, billing, indents, compliance registers. That code is identical in both products and is where every hard-won bug fix lives.

Forking it into two full copies is the version of this that fails. Every bug gets fixed twice, the fixes drift, and within six months one edition is quietly the broken one — usually the on-prem build, because it's the one you can't hotfix. Keeping the domain logic in one place costs nothing commercially: the buyer sees two products either way.

**The rule:** the two editions may differ only in `layout.tsx` (branding), `.env` defaults, and deployment artefacts. Anything else that needs to differ belongs behind a flag in core, not a copy-paste.

```
packages/core     schema · services · API handlers   ← shared, the valuable part
packages/ui       screens                            ← shared
apps/cloud        branding + routes                  ← Product 1
apps/onprem       branding + routes + Docker + installer ← Product 2
```

Each edition's own source is ~9 small files. That's the point.

---

## Layout

```
packages/core/
  prisma/schema.prisma          43 models
  prisma/seed.ts                demo hospital, 3 stores, 5 items, opening stock
  src/lib/money.ts              Decimal helpers — the only way money is handled
  src/lib/db.ts                 Prisma client + hospitalId isolation
  src/lib/env.ts                env validation; JWT_SECRET has no fallback, by design
  src/server/services/
    stock.service.ts            ★ FEFO, ledger writes, store-ownership guard
    sequence.service.ts         row-locked (online) + block-reserved (offline) numbering
    gst.service.ts              MRP-inclusive & exclusive tax, CGST/SGST/IGST, HSN summary
    sale.service.ts             billing txn + H1 and narcotic registers
    grn.service.ts              supplier invoice entry, batch creation, free-qty costing
    indent.service.ts           ward request → approve → issue → receive
  src/server/sync/outbox.ts     transactional outbox, Lamport ordering
  src/api/                      route handlers, re-exported by both editions
  tests/gst.spec.mjs            tax assertions

packages/ui/
  src/screens/                  BillingCounter, Login
  src/lib/offline-queue.ts      IndexedDB outbox + stock snapshot + client-side FEFO

apps/cloud/                     Product 1
apps/onprem/                    Product 2 — includes Dockerfile, compose, install.bat

templates/                      client data-collection workbook
docs/ARCHITECTURE.md            offline+online strategy, sync design
docs/TESTING-OFFLINE-ONLINE.md  how to verify both modes
docs/REQUIREMENTS.md            what's still needed to finish — read this next
```

---

## Run it

```bash
npm install
cp apps/cloud/.env.example apps/cloud/.env      # set JWT_SECRET, 32+ chars
npm run db:generate
npm run db:migrate
npm run db:seed

npm run dev:cloud      # → localhost:3000
npm run dev:onprem     # → localhost:3100
```

On-premise install, on the hospital's machine:

```
apps\onprem\install.bat
```

Generates unique secrets for that hospital, starts Postgres and the app in Docker, applies migrations, and prints the LAN address for the counters. Nightly backups write to `.\backups`.

Demo login: `pharmacist@velocare.in` / `Demo@12345`

---

## Four decisions that must not be reversed

Load-bearing. Reversing any one is a rewrite, not a refactor.

**1. Stock is never a column.** Every movement appends an immutable `StockLedger` row; `StockBalance` is a rebuildable cache. Buys drug-recall traceability and an audit trail that survives a drug inspector — and because an append-only log merges by union, it's also what makes offline sync converge without conflict resolution.

**2. All money is `Decimal`.** Float on GST at 5/12/18% produces ₹0.01 drift that surfaces as a GSTR-1 mismatch months later. Verified in `packages/core/tests/gst.spec.mjs`.

**3. Document numbering is row-locked online, block-reserved offline.** Two counters generating the same bill number is the most common bug in Indian billing software. Never take a number outside the transaction that writes the document.

**4. Every store has one owning node.** Only that node may decrement its stock. Worst case after an offline merge is a stale view of another store's stock — never negative stock. Goods move between stores only through `Indent`.

**And one rule for contributors:** nothing outside `stock.service.ts` writes `stock_ledger` or `stock_balances`. Not a controller, not a migration, not a quick fix script. If you need a movement, call `applyMovements()`.

---

## Status

| Built | Not built yet |
|---|---|
| Schema — 43 models, structurally validated | GRN entry screen (service done, no UI) |
| Stock service — FEFO, ledger, ownership guard | Indent screens (service done) |
| Sequence, GST, sale, GRN, indent services | Bill printing (needs the printer model) |
| Billing counter + offline queue + snapshot | GSTR-1 / 3B export (`summariseHsn()` exists) |
| Auth with role **and** store checks | Item master importer (needs a real export file) |
| Two packaged editions + on-prem installer | Node-to-node sync worker (designed, unwritten) |

Counter-offline works end to end. On-prem runs fully standalone; it just can't mirror to a cloud dashboard yet.

---

## Verification

```bash
npm test                                                   # GST assertions
npm run db:validate                                        # run locally
npm run typecheck
npm run stock:rebuild -- --hospital=demo-hospital --check   # ledger vs cache drift
```

`prisma validate` has not been run against this schema — the build sandbox can't reach Prisma's engine CDN. A structural check (relations, back-relations, index field references) passed with zero errors, but **run it locally before the first migration.**

---

**Next: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)** — what I need from you to finish, and the client workbook to send out.
