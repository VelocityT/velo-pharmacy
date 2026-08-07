# How to test online and offline

Two things to prove, in this order. Don't skip to the offline test — if online billing isn't working, an offline failure tells you nothing.

---

## 0. Get it running (10 minutes, once)

You need PostgreSQL. If you have Docker, this is the fastest route:

```bash
docker run -d --name vp-db -p 5432:5432 \
  -e POSTGRES_USER=velocare -e POSTGRES_PASSWORD=velocare \
  -e POSTGRES_DB=velocare_pharmacy postgres:15-alpine
```

Then:

```bash
cd D:\Velocare-pharmacy
copy .env.example .env
```

Open `.env` and set a real secret — the app **will not boot** without one, deliberately:

```
JWT_SECRET=paste-at-least-32-random-characters-here-abcdefgh
DATABASE_URL="postgresql://velocare:velocare@localhost:5432/velocare_pharmacy?schema=public"
NODE_MODE=EDGE_COUNTER
NODE_KEY=COUNTER-01
```

> `NODE_MODE=EDGE_COUNTER` is what switches bill numbering to reserved blocks. Leave it as `CLOUD` and offline billing will fail on purpose at the numbering step — which is itself a useful thing to see once.

```bash
npm install
npx prisma validate          # run this — it could not run in the build sandbox
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Go to **http://localhost:3000/login** → sign in with `pharmacist@velocare.in` / `Demo@12345`, counter ID `COUNTER-01`.

---

## 1. Online test

**A. Bill something.**
Press `F2`, type `croc`, press `↓`/`Enter`, then `F9`.
You should get a toast like `INV/2026-27/OPD-01/00001 · ₹100.00`.

**B. Verify the money is right — don't trust the toast.**

```sql
SELECT "billNo","taxableAmt","cgstAmt","sgstAmt","roundOff","netAmount" FROM sales;
```

For one Crocin at MRP ₹100, GST 12%: taxable `89.29`, CGST `5.36`, SGST `5.35`, net `100`.
Note CGST and SGST are **not** equal — that's correct. Splitting 10.71 evenly is impossible; the code rounds one half and derives the other by subtraction so the two always add back exactly. Equal halves would lose a paisa.

**C. Verify stock actually moved.**

```sql
SELECT "txnType","qtyIn","qtyOut","refNo" FROM stock_ledger ORDER BY "createdAt" DESC LIMIT 3;
SELECT "quantity" FROM stock_balances WHERE "storeId"=(SELECT id FROM stores WHERE code='OPD-01');
```

Opening was 200. After billing 1, the ledger has a `SALE` row with `qtyOut=1` and the balance reads 199. The ledger row is the truth; the balance is a cache.

**D. Prove the cache and ledger agree.**

```bash
npm run stock:rebuild -- --hospital=demo-hospital --check
```

Expect `✓ Balance cache agrees with the ledger.` This is the command to run any time you suspect drift.

**E. Prove the compliance register writes itself.**
Bill `Alprax` (Schedule H1). It should be **refused** with a message about needing a linked prescription. That refusal is the feature — an H1 register that depends on someone remembering to fill it is empty on the day the drug inspector visits.

---

## 2. Offline test

**Before you disconnect**, confirm the snapshot downloaded. DevTools → Application → IndexedDB → `velocare-pharmacy` → `stock`. You should see rows. If it's empty, offline mode will find nothing — the snapshot pull is what makes it work.

**A. Go offline.** DevTools → Network tab → throttling dropdown → **Offline**. (Better than pulling the cable: the browser fires the `offline` event immediately.)

The header should switch to `Offline — billing continues` plus `stock as of N min ago`.

**B. Bill again.** `F2` → `croc` → `Enter` → `F9`.

Expected: `Billed offline · ₹100.00 · will sync`. The queue badge shows `1 bill(s) waiting to sync`.

**C. Confirm it's really queued locally.**
DevTools → Application → IndexedDB → `outbox`. One row, `status: PENDING`, with a `clientUuid`.

That UUID is the whole trick — it's minted *before* the bill is sent, and the server upserts on it. So a flush that half-succeeds and retries cannot double-post the bill.

**D. Bill 2–3 more offline.** Watch the local stock snapshot decrement each time — the counter is tracking its own stock while disconnected.

**E. Go back online.** Set throttling to **No throttling**.

Within a second: `3 offline bill(s) synced.` The queue badge disappears.

**F. Verify on the server.**

```sql
SELECT "billNo","isOfflineOrigin","clientUuid","netAmount" FROM sales ORDER BY "createdAt";
```

Offline bills carry `isOfflineOrigin = true` and their `clientUuid`. **The bill numbers must be unique and sequential.**

---

## 3. The tests that actually matter

Anyone can demo a happy path. These are the ones that decide whether the software survives a real pharmacy.

**Double-post protection.** While offline, bill once. In DevTools, copy the `outbox` row's `clientUuid`. Go online, let it sync, then `curl` the same payload again with that same UUID:

```bash
curl -X POST http://localhost:3000/api/sales -H "Content-Type: application/json" \
  --cookie "vp_token=<from DevTools>" -d '{...same payload...}'
```

Expect: the **original** bill returned, no second row in `sales`. This is what saves you when a counter's network flaps mid-flush.

**Bill number collision.** The real killer bug. Open the app in two browser profiles as `COUNTER-01` and `COUNTER-02`, take both offline, bill 5 each, then bring both online.

```sql
SELECT "billNo", COUNT(*) FROM sales GROUP BY 1 HAVING COUNT(*) > 1;
```

Must return **zero rows**. Each counter bills from its own reserved number block, so they cannot collide. You will see gaps in the series — that's expected and legal under GST (uniqueness and sequence *within a series*; each counter is its own series). A gap is defensible to an officer. A duplicate is not.

**Oversell race.** Set one batch to `quantity = 1`, then fire two bills at once:

```bash
curl -X POST .../api/sales -d '{...1 unit...}' & \
curl -X POST .../api/sales -d '{...1 unit...}' & wait
```

Exactly one succeeds; the other returns **409 `INSUFFICIENT_STOCK`**. The `SELECT … FOR UPDATE` in the FEFO query serialises them. Without that lock both would read "1 available" and both would succeed.

**Store ownership.** Try to bill from `ICU-2` (owned by the cloud node) while logged in as `COUNTER-01`. Expect **409 `STORE_OWNERSHIP`**. This is the rule that makes offline merges safe — no node can decrement stock it doesn't own.

**Stale snapshot.** Go offline and bill past the snapshot quantity — say 250 when only 199 exist. The counter stops you locally. But if it had *let* you through, the server would reject it at sync with a 409, and the offline queue parks it as `FAILED` for a human rather than retrying forever. Check that path too: 4xx must park, 5xx must retry.

**Auth is enforced server-side.** Log in as the pharmacist, then `curl` a GRN or an admin endpoint directly with their cookie. Must return **403**. Hiding a menu item is not access control — anyone with a valid token can curl the endpoint.

---

## 4. Testing on-premise mode (the fully offline product)

Different from counter-offline. This is the whole system running with no internet at all.

```bash
set JWT_SECRET=<32+ chars>
set DB_PASSWORD=<something>
docker compose up -d
```

Then **disconnect the machine from the internet entirely** and browse to `http://<server-ip>:3000` from a second PC on the same LAN. Everything must work — billing, GRN, indents, reports. Nothing in the app may call out.

The honest check: run it disconnected for a full day of test transactions, then confirm `docker compose logs app` shows no outbound request failures. Any external call — a font CDN, an analytics beacon, a font from Google — is a bug for this deployment mode, because a hospital IT head *will* test exactly this before signing.

---

## What is not built yet

Be clear on this before demoing to a client:

- **Sync worker** — the counter's offline queue works end to end. Node-to-node sync (on-prem ↔ cloud) is designed (`src/server/sync/`, schema, Lamport ordering) but the worker process isn't written. On-prem is fully functional standalone; it just can't yet mirror to a cloud dashboard.
- **GRN entry screen** — the service is built and tested; there's no UI yet, so goods have to go in via seed or API.
- **Indent UI** — same: service done, screens pending.
- **GST reports** — `summariseHsn()` exists; GSTR-1/3B export doesn't.
- **Bill printing** — `F9` posts the bill; there's no print template yet.
