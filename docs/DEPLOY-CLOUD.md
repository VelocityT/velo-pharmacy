# Deploy the Cloud edition

Target: a live URL you can open and walk a client through. **Free tier the whole way**, roughly 25 minutes.

Vercel (app) + Neon (Postgres). Both have real free tiers that are fine for a demo. Alternatives at the bottom if you'd rather have a normal always-on server.

> **Read first:** I could not run a real `npm install` or `next build` in my sandbox — the install tree is too large for the environment's time limit. Everything below is correct as far as I can verify statically (all 41 files parse, schema validates structurally, GST tests pass), but **the first build is the first real test.** §6 lists the failures I'd expect and the exact fix for each, so you're not debugging blind.

---

## 1 · Database (Neon, ~5 min)

1. [neon.tech](https://neon.tech) → sign up → **Create project**
2. Name `velocare-pharmacy`, region **Singapore** or **Mumbai** (closest to India — this is real latency at a billing counter)
3. On the dashboard, copy **two** connection strings from the *Connection Details* panel:
   - **Pooled** — the one containing `-pooler` → this becomes `DATABASE_URL`
   - **Direct** — toggle *"Connection pooling"* off → this becomes `DIRECT_URL`

Both are needed, and mixing them up is the single most common deploy failure. Serverless opens a fresh connection per cold start and will exhaust a direct connection limit under trivial load; Prisma Migrate, meanwhile, *cannot* run through a pooler at all. Hence two URLs.

---

## 2 · Push the code

```bash
cd D:\Velocare-pharmacy
git init
git add .
git commit -m "Velocare Pharmacy — cloud + on-prem editions"
```

Create an empty **private** repo on GitHub, then:

```bash
git remote add origin https://github.com/<you>/velocare-pharmacy.git
git branch -M main
git push -u origin main
```

> `.gitignore` already excludes `.env`. Check `git status` shows no `.env` before pushing — a leaked `JWT_SECRET` means anyone can mint admin tokens.

---

## 3 · Set up the database schema (from your machine)

Run migrations locally against Neon *before* deploying. Migrating from a serverless build step is fragile and hides its errors.

Create `apps/cloud/.env`:

```bash
NODE_MODE=CLOUD
NODE_KEY=CLOUD
DATABASE_URL="<pooled URL from step 1>"
DIRECT_URL="<direct URL from step 1>"
JWT_SECRET="<paste the output of the command below>"
JWT_EXPIRES_IN=12h
SYNC_ENABLED=false
SEQUENCE_BLOCK_SIZE=1000
```

Generate a real secret — do not invent one by hand:

```bash
# Git Bash / WSL / Mac
openssl rand -base64 48

# Windows PowerShell
[Convert]::ToBase64String((1..48|%{Get-Random -Max 256}))
```

Then:

```bash
npm install
npm run db:migrate       # creates all 43 tables
npm run db:seed          # demo hospital, 3 stores, 5 items, 200 units of stock
```

Expected output ends with `Seeded.` and a login line. **If migrate fails, stop here** — a broken schema will not get better on Vercel.

Sanity check it locally before you deploy:

```bash
npm run dev:cloud        # → http://localhost:3000
```

Log in as `pharmacist@velocare.in` / `Demo@12345`, counter `COUNTER-01`, and bill one Crocin. If that works locally, the deploy is mostly a formality.

---

## 4 · Deploy (Vercel, ~5 min)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import your repo
2. **Root Directory: leave it at the repository root** (`./`), *not* `apps/cloud`. `vercel.json` already routes the build correctly, and npm workspaces only resolve from the root.
3. Framework preset: **Next.js** (auto-detected)
4. **Environment Variables** — add all six:

| Name | Value |
|---|---|
| `NODE_MODE` | `CLOUD` |
| `NODE_KEY` | `CLOUD` |
| `DATABASE_URL` | pooled Neon URL |
| `DIRECT_URL` | direct Neon URL |
| `JWT_SECRET` | the same secret from step 3 |
| `JWT_EXPIRES_IN` | `12h` |

5. **Deploy**

---

## 5 · Verify, in this order

**a. Health first.** Open `https://<your-app>.vercel.app/api/health`

```json
{ "status": "ok", "database": "connected", "seeded": true,
  "counts": { "hospitals": 1, "stores": 3, "items": 5 } }
```

This one endpoint separates *"the app didn't build"* from *"the app is up but can't reach the database"* — two failures that look identical from the login screen. Check it after every deploy.

**b. Log in.** `https://<your-app>.vercel.app` redirects to `/login`.
`pharmacist@velocare.in` / `Demo@12345` / counter `COUNTER-01`

**c. Bill something.** `F2` → type `croc` → `Enter` → `F9`
Expect a toast: `INV/2026-27/OPD-01/00001 · ₹100.00`

**d. Confirm the money is right.** In Neon's SQL editor:

```sql
SELECT "billNo","taxableAmt","cgstAmt","sgstAmt","netAmount" FROM sales;
```

For one Crocin at MRP ₹100, GST 12%: taxable `89.29`, CGST `5.36`, SGST `5.35`, net `100.00`.

CGST and SGST are deliberately unequal. ₹10.71 cannot be halved evenly, so the code rounds one half and derives the other by subtraction — equal halves would silently lose a paisa on every bill in the country.

**e. Confirm stock moved.**

```sql
SELECT "txnType","qtyOut","refNo" FROM stock_ledger ORDER BY "createdAt" DESC LIMIT 3;
```

---

## 6 · If the first build fails

Ranked by how likely I think each is. Vercel's build log names the failing step.

**`@velocare/core` or `@velocare/ui` cannot be resolved**
The workspace didn't link. Confirm Root Directory is the repo root, not `apps/cloud`. If it persists, add to `apps/cloud/next.config.ts`:
```ts
outputFileTracingRoot: require("path").join(__dirname, "../../"),
```

**`@prisma/client did not initialize yet`**
`postinstall` didn't run. Root `package.json` already has `"postinstall": "prisma generate --schema packages/core/prisma/schema.prisma"`. If Vercel skipped it, set Install Command explicitly to:
```
npm install && npx prisma generate --schema packages/core/prisma/schema.prisma
```

**`Query engine library not found` at runtime (build is green, requests 500)**
Missing Linux binary target. Already set in the schema (`rhel-openssl-3.0.x`) — if it still happens, redeploy with the build cache cleared.

**`Invalid environment configuration: JWT_SECRET must be at least 32 characters`**
Working as designed. There is no fallback secret, deliberately — a hardcoded default is how someone who has read your repo mints admin tokens. Set a real one.

**`Can't reach database server` / connection-limit errors**
You used the direct URL for `DATABASE_URL`. Swap in the `-pooler` one.

**`prepared statement "s0" already exists`**
Supabase transaction pooler without the flag. Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`. Distinctive symptom: the first request succeeds and every one after fails.

**`Connection refused` / `No route to host` during `db:migrate`**
You used Supabase's *Direct connection* string. It's IPv6-only for projects created after January 2024, and Indian ISPs are generally IPv4-only. Use the **Session pooler** string (port 5432 on the `pooler.supabase.com` host) for `DIRECT_URL` instead.

**Supabase project shows as paused**
Free tier pauses after 7 days without database activity. Restore it from the dashboard — takes about 30 seconds. Check this before any client demo; a dead link is worse than no link.

**Type errors in the build**
`npm run typecheck` locally to see them all at once. Note this is the first full TypeScript pass anyone has run on this code — I could only verify that every file *parses*, not that every type checks. Expect a handful, mostly Prisma `Decimal` vs `number` at boundaries. Send me the output and I'll fix them properly rather than papering over with `any`.

---

## 7 · What a client will and won't see

Set expectations before you demo. Working today:

- Login, counter selection
- Keyboard billing — barcode/name search, FEFO batch auto-pick, live GST, `F9` to save
- Correct Indian tax on every bill, ledger-backed stock movement, audit trail
- Schedule H1 blocking — try billing `Alprax` and it refuses without a linked prescription. **Demo this deliberately.** It's the clearest proof the software understands pharmacy rather than just retail
- Offline billing (throttle to Offline in DevTools) — though on a demo URL it's less convincing than on a real counter

Not built yet — say so up front rather than being asked:

- GRN entry screen (service works; goods go in via seed or API)
- Indent screens
- Bill printing — needs your thermal printer model
- GSTR-1 / 3B export
- Item master import — needs a real Marg export from you

---

## Alternatives to Vercel

**Railway** — if you'd rather avoid serverless entirely. Postgres and app in one project, always-on container, no pooling gotchas, no cold starts. ~$5/mo after the trial credit. Point it at `apps/onprem/Dockerfile` and set `NODE_MODE=CLOUD`. **This is what I'd pick if the demo needs to feel fast**; a cold serverless start is 2–3 seconds and a pharmacist notices.

**Render** — same shape as Railway, free tier sleeps after 15 min of inactivity. Fine for a link you send ahead; bad for a live demo where the first click takes 30 seconds.

**Any VPS (Hetzner/DigitalOcean, ~₹400/mo)** — `docker compose up` with the on-prem compose file and `NODE_MODE=CLOUD`. Most control, most maintenance. This is where you'd end up for real paying cloud customers anyway.
