# What I need from you to finish this

Split by whether it blocks work or not. **Section A blocks me today.** Sections B–D can arrive later without stalling the build. Section E is what the client fills in, and there's a workbook ready to send them.

---

## A · Blocking — I can't finish these without you

### A1. The drug master. This is the whole risk.

Everything else on this page is admin. This one decides whether the product survives contact with a real pharmacy.

You need ~50,000 SKUs with **name, composition, HSN code and GST slab** loaded before staff touch the software. Without it a pharmacist types a new item for every strip they sell, and by day three they're back on the old system. This is the actual reason pharmacy go-lives fail — not bugs.

Pick one:

| Option | Cost | Time | My recommendation |
|---|---|---|---|
| **Import the client's existing Marg/Busy/Tally export** | ₹0 | 2–3 days per client | **Do this for every deal.** It also turns migration from an objection into your pitch: "we'll bring your data across." |
| Licence a commercial drug dataset | ₹50k–₹2L/yr | instant | Keep in reserve for a greenfield client with no incumbent system |
| Scrape a public formulary | dev time | 3–4 weeks | Composition and GST mapping come out incomplete. Last resort. |

**What I need:** one real item-master export (`.xls`/`.xlsx`/`.csv`) from any pharmacy you have access to. Even 500 rows is enough — I need the actual column layout to write the import mapper. Marg's export columns are not what you'd guess, and I'd rather build against a real file than a assumed one.

### A2. Six product decisions

These change what gets built, so I need answers before I build the affected module:

1. **Pricing model per edition.** Cloud — per counter/month, or per hospital/month with a counter cap? On-prem — one-time licence plus AMC %, or annual? This drives whether I build metering and licence-key enforcement at all.
2. **On-prem licence enforcement.** Hard-locked to a machine fingerprint, an expiring key file, or trust-based? Trust-based is common for hospital deals in India and costs nothing to build. Hard-locking costs about a week and irritates honest customers when hardware is replaced.
3. **e-Invoice / IRN.** Mandatory above ₹5 crore turnover. Needed for v1, or phase 2? If v1, I need your GSP choice (ClearTax, Masters India, IRIS) — the integration differs by vendor.
4. **IPD billing boundary.** Does pharmacy post charges *into* an existing HIS bill, or does this product own the patient bill? If it posts into a HIS, I need that HIS's API docs. This is the single biggest scope fork remaining.
5. **Multi-hospital groups on cloud.** Does one login switch between branches, or is each branch a separate account? Affects the auth model.
6. **Languages.** English only, or Hindi/Telugu/Tamil on the counter screen and printed bill? Retrofitting i18n after the screens are built is roughly 3× the cost of doing it upfront.

### A3. One test machine that mirrors a real counter

I've written the offline path but it has only been reasoned about, not run against real conditions. Before you demo it to anyone I need results from:

- A Windows PC (what hospitals actually use — not a Mac)
- A **thermal receipt printer**, 80mm, with its model number. Bill printing is unwritten and the ESC/POS command set differs by manufacturer.
- A **barcode scanner** — model number. Most work as keyboard emulators, but scan-suffix behaviour varies and it changes the billing screen's key handling.
- Ideally a genuinely flaky connection to test reconnect-flush, not just DevTools throttling.

---

## B · Needed before the first paying client, not before I code

### B1. Accounts and credentials

| What | For | Rough cost |
|---|---|---|
| Managed Postgres (Neon / Supabase / RDS) | Cloud edition | ₹0–2k/mo to start |
| Hosting (Vercel or a VPS) | Cloud edition | ₹0–1.5k/mo |
| Domain + SSL | e.g. `pharmacy.velocare.in` | ₹1k/yr |
| Transactional email (Resend / AWS SES) | Password reset, alerts | ₹0–500/mo |
| SMS gateway + **DLT registration** | OTP, expiry alerts | ₹0.15–0.25/SMS |
| Error monitoring (Sentry) | You will need this on day one | free tier is fine |
| Code signing certificate | So Windows doesn't flag your on-prem installer | ₹15–25k/yr |
| GSP account | Only if e-invoice is in v1 | varies |

> **DLT registration takes 2–3 weeks** with TRAI. If SMS is in v1, start it now — it's the longest lead time on this list and it blocks nothing else until it suddenly blocks launch.

### B2. Branding assets

Because the two editions are sold as separate products, each needs its own identity:

- Logo — SVG or high-res PNG, light and dark variants
- Product names. My placeholders are **Velocare Pharmacy Cloud** and **Velocare Pharmacy Server** — replace them if you want something different, and tell me now, before it's in an installer and a licence agreement
- Brand colours (hex), and a font if you have a licensed one
- Favicon
- Invoice header layout — do you want the hospital's logo on the bill, or yours, or both?

### B3. Legal

- **EULA** for the on-prem edition — perpetual licence terms, what AMC covers
- **Terms of Service + Privacy Policy** for cloud
- **Data Processing Agreement.** Hospital IT will ask. Patient data under the DPDP Act 2023 is not something to improvise at signing time
- **SLA** for cloud — uptime commitment, support response times
- Support hours. A pharmacy runs 24×7; decide what you're actually promising before a client decides for you

---

## C · Content I need from you (I can draft, you approve)

- **Sample invoice format** the client is happy with. Get one printed bill from a real pharmacy — the layout matters more than you'd think, and pharmacists are particular about it
- **Schedule H1 register format** their drug inspector accepts. Formats vary by state
- Any hospital-specific reports the client already relies on. Ask for printouts
- Your standard proposal and AMC contract templates, if the deliverables should reference them

---

## D · Decisions I've made for you (reverse them now, or live with them)

Flagging these so nothing surprises you later:

1. **Postgres in both editions, not SQLite offline.** SQLite has no true `DECIMAL`, no `SELECT … FOR UPDATE`, no `SERIALIZABLE`. Using it would make your offline build round money differently from your online build. Postgres runs fine on a ₹35k desktop.
2. **Docker for on-prem.** One-command install, clean upgrades. Cost: Docker Desktop must be installed on the hospital's server PC. The alternative — a native Windows installer with a bundled Postgres service — is roughly 2 weeks of work. Say the word if hospital IT resistance makes it necessary.
3. **Counter-offline is bounded to sales, returns and indent requests.** GRN, master edits and approvals need a connection. Receiving goods against stock you can't see live corrupts inventory, and no sync design fixes that.
4. **Gaps in bill numbers when offline.** Each counter bills from a reserved block, so numbers never collide but the series has gaps. This is legal under GST — uniqueness and sequence *within a series*, each counter being its own series. If your CA disagrees, tell me now; it's a schema-level change.
5. **No loyalty, schemes, salesman commission or e-commerce sync.** Deliberately dropped — retail features that are dead weight in a hospital. Say so if a client asks for them.

---

## E · What the client fills in

Send them **`templates/Velocare-Pharmacy-Client-Data-Collection.xlsx`** — it's ready. Eight sheets, mandatory columns highlighted, dropdowns for anything that must match a fixed list, a green example row on each sheet, and a reference sheet explaining store types, roles, drug schedules and GST state codes.

| Sheet | Rows | Notes |
|---|---|---|
| 1 Hospital | 1 | GSTIN and state code — drives CGST/SGST vs IGST |
| 2 Stores | 5–30 | The layout that decides who bills and who indents |
| 3 Users | 5–50 | Role plus which counters each person may use |
| 4 Item Master | **50,000** | **Export, don't type.** Marg: Masters → Item → Display → Export to Excel |
| 5 Opening Stock | 2,000–20,000 | Batch-wise physical count on go-live day |
| 6 Suppliers | 10–100 | |
| 7 Doctors | 10–200 | Registration no. is legally required for H1 dispensing |
| 8 Reference | — | Read-only lookup |

**Two things to warn them about when you send it:**

- Sheet 4 must be exported from their existing software, not typed. If you let a client attempt 50,000 rows by hand, the project dies there.
- Sheet 5 needs a **physical stock count on the day of go-live**, batch-wise. That's a real operational effort — usually a Sunday with the shutters down. Schedule it in the implementation plan, don't spring it on them the week before.

---

## Fastest path to a sellable demo

If you want something to show a client soon, the shortest route is:

1. You send me **one real item-master export** (A1) — unblocks the importer
2. You answer the **IPD billing question** (A2 #4) — biggest remaining scope fork
3. I build: item import → GRN screen → bill print → GST reports
4. You test on a real counter with a real printer and scanner (A3)

Everything else on this page can follow.
