# Test runbook — inventory to medicine, end to end

Follow in order. Each step feeds the next, and the checks tell you whether the thing underneath actually worked rather than just looked like it did.

Roughly 25 minutes for the full cycle.

---

## Step 0 · Start it

```powershell
cd D:\Velocare-pharmacy
npm install
npm run build:cloud     # ← the one that has never been run
```

**Do the build before the dev server.** 160 files have only ever been checked for *parsing*, which catches syntax errors and nothing else — not a wrong import, not a type mismatch. If it's red, send me the output and stop; debugging manually will cost you more time than sending me six lines.

```powershell
npm run dev:cloud
```

**http://localhost:3000** → `pharmacist@velocare.in` / `Demo@12345` / counter `COUNTER-01`

You land on the Dashboard. Sidebar has 7 groups, 27 items.

---

## Step 1 · Look at what's already there

**Masters → Item Master.** Five demo medicines:

| Item | Schedule | GST | Stock |
|---|---|---|---|
| Crocin Advance 500mg Tab | NONE | 12% | 197 |
| Azithral 500mg Tab | H | 12% | 200 |
| Alprax 0.5mg Tab | **H1** | 12% | 200 |
| Morphine Sulphate 10mg Inj | **NARCOTIC** | 5% | 200 |
| Disposable Syringe 5ml | NONE | 12% | 200 |

**Inventory → Stock on Hand.** Same medicines, but now batch-wise with expiry and value. This is the difference between an item master and inventory: one is a catalogue, the other is what's physically on a shelf, in a specific batch, at a specific store.

**Inventory → Stock Ledger.** Six rows — five opening-stock entries and one sale. **This table is the truth.** Stock on Hand is a cache derived from it. If they ever disagree, the ledger is right.

Try the search box on any list. It runs server-side, so it will still work at 50,000 items.

---

## Step 2 · Add a new medicine

**Masters → Item Master → New Item.**

| Field | Value |
|---|---|
| Code | MED0010 |
| Name | Dolo 650mg Tab |
| Category | Tablet |
| HSN | 30049099 |
| GST | 12% |
| Schedule | NONE |
| Min Stock | 50 |

**Before saving, test the validation:** clear the HSN and save. It must refuse with *"HSN is required for GST returns."* If it saves, that's a server-side validation hole and I need to know.

Save properly. Dolo appears in the list with **0 in stock** — correct. An item existing is not the same as stock existing.

---

## Step 3 · Bring stock in

**Purchase → Suppliers → New Supplier.**
Name `Sunrise Pharma`, GST state code **36** (matches the demo hospital → CGST+SGST). Save.

**Purchase → Goods Receipt → New Goods Receipt.**

Header: Sunrise Pharma · store `MAIN` · invoice `SP-001` · today.

Line 1: Dolo 650mg · batch `DOLO2601` · expiry ~18 months out · MRP `32` · Qty `100` · **Free `10`** · Rate `19.50` · Disc `5`

Watch the totals: taxable ≈ ₹1,852.50, GST ≈ ₹222.30. The badge top-right reads *CGST + SGST — intra-state*. Change the supplier's state code to 27 and it flips to IGST.

**Post it.**

**Now check the ledger.** Inventory → Stock Ledger, top row:

> `GRN` · Dolo 650mg · **qtyIn = 110**

**Not 100.** Free goods enter stock at full count but cost nothing, so the effective purchase rate drops below ₹19.50. That number is what margin reporting reads, and getting it wrong is how a pharmacy believes it's profitable when it isn't.

Then in the terminal:

```powershell
npm run stock:rebuild -- --hospital=demo-hospital --check
```

Expect `✓ Balance cache agrees with the ledger.`

---

## Step 4 · Sell it

**Daily → Billing Counter.**

Search `dolo` — **nothing appears.** That is correct, not a bug. Dolo is at `MAIN`; the counter bills from `OPD-01`. Goods enter once at the main store and reach counters by indent. (Step 6 moves it.)

Bill Crocin instead: `F2` → `croc` → `↓`/`Enter` → qty `2` → `F9`.

Toast shows the bill number and amount. Then check:

- **Daily → Bills** — new row, status `POSTED`. **Click it** → full GST invoice with batch, expiry, HSN summary, drug licence number and amount in words. `Print` gives you A4 or 80mm thermal.
- **Stock Ledger** — a `SALE` row, qtyOut 2
- **Stock on Hand** — Crocin down by 2
- **Dashboard** — "Sales today" has moved

---

## Step 5 · The demo that sells the product

Back at the counter, bill **Alprax** (Schedule H1). It refuses:

> *"Schedule H1 drugs cannot be dispensed without a linked prescription."*

**Now do it properly.**

1. **Masters → Patients → New Patient** — add anyone.
2. **Daily → New Prescription** — pick the patient, pick `Dr. S. Reddy`, add Alprax qty 10, dosage `0-0-1 at bedtime`. Save.
3. Back to billing, bill Alprax against that prescription.
4. **Compliance → Schedule H1** — the register row **wrote itself**: patient, prescriber, registration number, batch, quantity, dispensing pharmacist.

Nobody typed that register. A register that depends on someone remembering to fill it is a register that's empty on the day the drug inspector visits — and that's exactly where Marg is weak.

Try Morphine too. The Narcotic Register keeps a running balance with opening and closing figures per entry, as the NDPS Act requires.

---

## Step 6 · Move stock to the counter

**Inventory → Ward Indents → Raise Indent.**
Requesting `OPD-01`, supplying `MAIN`, add Dolo qty 50. Raise.

Open the indent from the list. Four-step tracker: Submitted → Approved → Issued → Received.

- **Approve** — try approving *more* than requested; it refuses. Cut it to 40 and approve.
- **Issue** — FEFO picks the batch. Main store decrements.
- **Receive** — the ward increments.

Between issue and receive the goods are **in transit and belong to neither store**. That's deliberate: a single-step transfer hides trolley losses forever.

Now search `dolo` at the counter. It's there.

---

## Step 7 · Returns and adjustments

**Daily → Sale Return** — enter your Crocin bill number, return 1. Two guards to test:

- Try returning more than was sold → refused
- Return again → returnable quantity has dropped, so the same strip can't be refunded twice

**Purchase → Purchase Return** — pick a store, supplier, reason `NEAR_EXPIRY`, widen the filter to 365 days. Priced at purchase rate, because that's what the distributor credits.

**Inventory → Stock Adjustment** — pick `OPD-01`. The count sheet is pre-filled with system quantity; type only what differs. Enter 195 against Crocin's 197 and raise it.

It saves as **DRAFT — stock has not moved.** A manager other than you must approve it. That separation is the control: anyone who can silently write stock off is anyone who can steal. Sign in as `admin@velocare.in` (same password) to approve.

---

## Step 8 · Reports

**Reports → Day Book** — today's sales and purchases.
**Reports → GSTR-1 Summary** — rate-wise taxable value, CGST, SGST.
**Reports → Stock Valuation** — closing stock at cost, by store and category.

Hit **Export CSV** on any of them — that's what your client's accountant will actually open.

---

## The five things that must be *refused*

A client will try all of these. Each one should fail with a clear message:

1. Billing a Schedule H1 drug without a prescription
2. Posting a GRN with a rate above MRP
3. Posting a GRN with an expired batch
4. Entering the same supplier invoice number twice
5. Approving your own stock adjustment

**Anything that should have been refused but wasn't is the most important thing to tell me.** A screen that looks slightly off is not.

---

## What to send back

1. `npm run build:cloud` — pass or fail, with the output
2. Any screen that errored, with the message
3. Anything from the list of five that went through when it shouldn't have

I can query the database myself through the Supabase connector — you don't need to run SQL or paste results. Just finish the flow and tell me, and I'll verify the ledger, GST split, document sequences and audit trail directly.

---

## Still not built

- **Purchase Orders** (marked "soon" in the sidebar)
- **IPD charge-to-admission** — needs your answer on whether pharmacy posts into an existing HIS bill or owns the patient bill
- **Marg item-master import** — needs one real export file from you
- **Automated tests** beyond the GST assertions, error monitoring, rate limiting, password reset
