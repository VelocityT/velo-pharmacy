# Setup — copy-paste commands

Windows. Run everything from `D:\Velocare-pharmacy`.

**Do them in this order.** Steps 1–4 run on your laptop and prove the thing works before anyone else sees it. Only then do you push and deploy. Pushing first just means debugging in Vercel's build log instead of your terminal, which is slower and less informative.

---

## Before you start

Three installs. Check what you already have:

```powershell
node -v      # need v20 or v22
git --version
```

- **Node.js 22 LTS** — https://nodejs.org (pick LTS)
- **Git** — https://git-scm.com/download/win
- A **GitHub account**

Close and reopen the terminal after installing either, or `node`/`git` won't be on PATH yet.

---

## Step 1 · Install dependencies

```powershell
cd D:\Velocare-pharmacy
npm install
```

Takes 3–6 minutes. It creates two things:

- `node_modules\` — never committed
- `package-lock.json` — **must** be committed; it's what makes Vercel's install reproducible

Warnings are normal. A red `ERR!` block is not — send it to me rather than continuing.

---

## Step 2 · Get a database

Either provider works — both are plain Postgres. Pick one and follow that block.

Whichever you choose, you need **two** connection strings, not one. Prisma Migrate cannot run through a transaction pooler (it needs prepared statements and `SET session_replication_role`, which PgBouncer in transaction mode does not support). Meanwhile a serverless app on a direct connection opens a fresh connection per cold start and exhausts Postgres' connection limit. Hence one URL for each job. **Mixing these up is the most common failure on this stack.**

---

### Option A · Supabase

[supabase.com](https://supabase.com) → **New project** → name `velocare-pharmacy`, region **South Asia (Mumbai)**, set a database password (save it).

Click **Connect** at the top of the dashboard. You'll see three strings. You want the first and third:

| Supabase calls it | Port | Goes into |
|---|---|---|
| **Transaction pooler** | `6543` | `DATABASE_URL` |
| ~~Direct connection~~ | 5432 | **don't use — see below** |
| **Session pooler** | `5432` | `DIRECT_URL` |

Then append the flags Prisma needs:

```
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.<ref>:<pw>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

`?pgbouncer=true` is not optional. Without it you get `prepared statement "s0" already exists` on the second request — the app works once, then breaks, which is a miserable thing to debug.

> **Why not the "Direct connection" string?** Since January 2024 Supabase stopped assigning IPv4 addresses to new projects — `db.<ref>.supabase.co` resolves to IPv6 only. Most Indian ISPs and office networks are IPv4-only, so migrations from your laptop fail with `Connection refused` or `No route to host`. The **session pooler** returns IPv4 and does the same job. Use it.

> **Free tier pauses after 7 days of no database activity** and needs a manual restore from the dashboard (~30 seconds). Fine while you're building. **Not fine for a demo link you send a client** — they open it next week and it's dead. Before any client demo, either open the app yourself that morning, or put the project on Pro ($25/mo), which removes pausing.

---

### Option B · Neon

[neon.tech](https://neon.tech) → **Create project** → name `velocare-pharmacy`, region **Singapore** or **Mumbai**.

From *Connection Details*:

| Which | How to find it | Goes into |
|---|---|---|
| **Pooled** | the default — contains `-pooler` | `DATABASE_URL` |
| **Direct** | toggle *Connection pooling* **off** | `DIRECT_URL` |

No extra flags needed. Neon scales to zero after ~5 minutes idle but wakes automatically in well under a second, with no manual restore — which is why I'd pick it for a link you're sending to a client.

---

**My recommendation:** Supabase if you want the built-in table editor and SQL console (genuinely useful while you're still shaping the data, and Mumbai is the closest region to your clients). Neon if the priority is a demo link that's always alive. The app doesn't care — swapping later is two environment variables.

---

## Step 3 · Create your .env

Generate a secret first:

```powershell
[Convert]::ToBase64String((1..48|%{Get-Random -Max 256}))
```

Copy the output. Then create the file:

```powershell
notepad apps\cloud\.env
```

Notepad asks to create it — say yes. Paste this, substituting your three values:

```
NODE_MODE=CLOUD
NODE_KEY=CLOUD
DATABASE_URL="<pooled URL from step 2>"
DIRECT_URL="<direct URL from step 2>"
JWT_SECRET="<the string you just generated>"
JWT_EXPIRES_IN=12h
SYNC_ENABLED=false
SEQUENCE_BLOCK_SIZE=1000
```

Save, close.

> Keep the double quotes around the URLs — they contain `?` and `&`, which the shell will otherwise mangle.
>
> This file is git-ignored and must stay that way. A leaked `JWT_SECRET` lets anyone mint an admin token for your system.

---

## Step 4 · Create the tables, load demo data, run it

```powershell
npm run db:migrate
```

Prompts for a migration name — type `init` and press Enter. Creates all 43 tables.

```powershell
npm run db:seed
```

Should end with `Seeded.` and a login line.

```powershell
npm run dev:cloud
```

Open **http://localhost:3000**

1. Log in: `pharmacist@velocare.in` / `Demo@12345` / counter `COUNTER-01`
2. Press `F2`, type `croc`, press `Enter`, then `F9`
3. You should get `INV/2026-27/OPD-01/00001 · ₹100.00`

**If this works, you're done with the hard part.** Stop the server with `Ctrl+C`.

If it doesn't, stop here and send me the error — deploying a broken build only moves the problem somewhere harder to read.

---

## Step 5 · Push to GitHub

**What gets pushed:** everything except `node_modules`, `.env`, `.next` and `backups`. `.gitignore` already handles that — you don't select files by hand.

```powershell
git init
git add .
git status
```

Read the `git status` output before committing. You should see roughly 60 files. **Confirm `.env` is NOT in the list.** If it appears, stop and tell me.

You should see these — if any are missing, something's wrong:

- `packages/core/prisma/schema.prisma` and `packages/core/prisma/migrations/`
- `package-lock.json`
- `apps/cloud/`, `apps/onprem/`, `packages/core/`, `packages/ui/`
- `templates/Velocare-Pharmacy-Client-Data-Collection.xlsx`
- `vercel.json`

Then:

```powershell
git commit -m "Velocare Pharmacy - cloud and on-prem editions"
```

First time on a machine, git asks who you are:

```powershell
git config --global user.email "info.velocitytech@gmail.com"
git config --global user.name "Velocity Tech"
```

Now create the repo on GitHub: **New repository** → name `velocare-pharmacy` → **Private** → do **not** tick "Add a README" (you have one) → **Create**.

```powershell
git remote add origin https://github.com/<your-username>/velocare-pharmacy.git
git branch -M main
git push -u origin main
```

A browser window opens to authorise. Approve it.

---

## Step 6 · Deploy on Vercel

[vercel.com](https://vercel.com) → sign in **with GitHub** → **Add New → Project** → import `velocare-pharmacy`.

Then, carefully:

| Setting | Value |
|---|---|
| **Root Directory** | leave as `./` — **do not** set it to `apps/cloud` |
| Framework | Next.js (auto-detected) |
| Build/Output/Install | leave blank — `vercel.json` handles them |

Root Directory catches people out. npm workspaces only resolve from the repository root; point Vercel at `apps/cloud` and `@velocare/core` won't be found.

**Environment Variables** — add all six, same values as your `.env`:

```
NODE_MODE          CLOUD
NODE_KEY           CLOUD
DATABASE_URL       <pooled URL>
DIRECT_URL         <direct URL>
JWT_SECRET         <your secret>
JWT_EXPIRES_IN     12h
```

Click **Deploy**. Takes 2–4 minutes.

---

## Step 7 · Check it

**Health first:**

```
https://<your-app>.vercel.app/api/health
```

Want to see:

```json
{ "status": "ok", "database": "connected", "seeded": true,
  "counts": { "hospitals": 1, "stores": 3, "items": 5 } }
```

`"database": "unreachable"` → wrong `DATABASE_URL`.
`"seeded": false` → migrations ran but seed didn't; re-run `npm run db:seed` locally against the same database.

**Then bill something:** open the root URL, log in, `F2` → `croc` → `Enter` → `F9`.

---

## Afterwards

Any change you make later:

```powershell
git add .
git commit -m "what changed"
git push
```

Vercel redeploys automatically on push. Roughly 2 minutes.

**Never commit `.env`.** If you ever do by accident, tell me immediately — rotating the secret isn't enough on its own once it's in git history.

---

## Quick reference

| Command | Does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev:cloud` | run cloud edition, port 3000 |
| `npm run dev:onprem` | run on-prem edition, port 3100 |
| `npm run db:migrate` | apply schema changes |
| `npm run db:seed` | load demo data |
| `npm run db:studio` | browse the database in a GUI |
| `npm test` | GST tax assertions |
| `npm run typecheck` | full TypeScript check |
| `npm run stock:rebuild -- --hospital=demo-hospital --check` | ledger vs cache drift |
