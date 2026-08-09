import { Prisma } from "@prisma/client";

/**
 * ────────────────────────────────────────────────────────────────
 *  RESOURCE REGISTRY
 * ────────────────────────────────────────────────────────────────
 *
 *  Every list screen in the app is driven from this one file. Adding
 *  a module is a config entry, not a new controller + route + page.
 *
 *  Security: this is a WHITELIST. A resource key that is not in this
 *  map cannot be queried, so the generic endpoint can never be
 *  pointed at a table it was not meant to expose. Each entry also
 *  declares which roles may read it — enforced server-side, because
 *  hiding a sidebar link is not access control.
 */

export interface Column {
  key: string;
  label: string;
  /** Rendering hint for the table. */
  type?: "text" | "money" | "qty" | "date" | "badge" | "bool";
  align?: "left" | "right";
}

export interface ResourceDef {
  title: string;
  subtitle?: string;
  /** Raw SQL. Must include {where} and {order} placeholders. */
  sql: (params: { hospitalId: string; storeId?: string }) => Prisma.Sql;
  columns: Column[];
  searchable: boolean;
  roles: string[];
}

const ALL = [
  "SUPER_ADMIN",
  "HOSPITAL_ADMIN",
  "PHARMACY_MANAGER",
  "PHARMACIST",
  "PURCHASE_OFFICER",
  "STORE_KEEPER",
  "ACCOUNTANT",
  "AUDITOR",
];
const MANAGER = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER"];
const FINANCE = [...MANAGER, "ACCOUNTANT", "AUDITOR"];

export const RESOURCES: Record<string, ResourceDef> = {
  // ── Masters ─────────────────────────────────────────────────
  items: {
    title: "Item Master",
    subtitle: "Every product the pharmacy can dispense",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Item Name" },
      { key: "category", label: "Category" },
      { key: "manufacturer", label: "Manufacturer" },
      { key: "packing", label: "Packing" },
      { key: "hsnCode", label: "HSN" },
      { key: "gstRate", label: "GST %", type: "qty", align: "right" },
      { key: "schedule", label: "Schedule", type: "badge" },
      { key: "stock", label: "In Stock", type: "qty", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT i."id", i."code", i."name",
             c."name" AS category,
             COALESCE(m."name",'—') AS manufacturer,
             COALESCE(i."packing",'—') AS packing,
             COALESCE(i."hsnCode",'—') AS "hsnCode",
             i."gstRate", i."schedule"::text AS schedule,
             COALESCE((SELECT SUM(sb."quantity") FROM stock_balances sb WHERE sb."itemId"=i."id"),0) AS stock
      FROM items i
      JOIN item_categories c ON c."id"=i."categoryId"
      LEFT JOIN manufacturers m ON m."id"=i."manufacturerId"
      WHERE i."hospitalId"=${hospitalId} AND i."deletedAt" IS NULL
    `,
  },

  // ── Inventory ───────────────────────────────────────────────
  stock: {
    title: "Stock on Hand",
    subtitle: "Batch-wise, per store — derived from the ledger",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "store", label: "Store" },
      { key: "name", label: "Item" },
      { key: "batchNo", label: "Batch" },
      { key: "expiry", label: "Expiry", type: "date" },
      { key: "quantity", label: "Qty", type: "qty", align: "right" },
      { key: "mrp", label: "MRP", type: "money", align: "right" },
      { key: "value", label: "Stock Value", type: "money", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT st."code" AS store, i."name", b."batchNo",
             b."expiryDate" AS expiry,
             sb."quantity", b."mrp",
             (sb."quantity" * b."purchaseRate") AS value
      FROM stock_balances sb
      JOIN items i  ON i."id"=sb."itemId"
      JOIN batches b ON b."id"=sb."batchId"
      JOIN stores st ON st."id"=sb."storeId"
      WHERE sb."hospitalId"=${hospitalId} AND sb."quantity" > 0
    `,
  },

  expiry: {
    title: "Expiry & Near-Expiry",
    subtitle: "Return to supplier while the batch still has credit value",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "name", label: "Item" },
      { key: "batchNo", label: "Batch" },
      { key: "expiry", label: "Expiry", type: "date" },
      { key: "days", label: "Days Left", type: "qty", align: "right" },
      { key: "store", label: "Store" },
      { key: "quantity", label: "Qty", type: "qty", align: "right" },
      { key: "value", label: "Value at Risk", type: "money", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT i."name", b."batchNo", b."expiryDate" AS expiry,
             (b."expiryDate"::date - CURRENT_DATE) AS days,
             st."code" AS store, sb."quantity",
             (sb."quantity" * b."purchaseRate") AS value
      FROM stock_balances sb
      JOIN items i   ON i."id"=sb."itemId"
      JOIN batches b ON b."id"=sb."batchId"
      JOIN stores st ON st."id"=sb."storeId"
      WHERE sb."hospitalId"=${hospitalId}
        AND sb."quantity" > 0
        AND b."expiryDate" <= CURRENT_DATE + INTERVAL '180 days'
    `,
  },

  // ── Sales ───────────────────────────────────────────────────
  sales: {
    title: "Bills",
    subtitle: "Every dispensing transaction",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "billNo", label: "Bill No" },
      { key: "billDate", label: "Date", type: "date" },
      { key: "store", label: "Counter" },
      { key: "customer", label: "Patient" },
      { key: "lines", label: "Items", type: "qty", align: "right" },
      { key: "taxableAmt", label: "Taxable", type: "money", align: "right" },
      { key: "gst", label: "GST", type: "money", align: "right" },
      { key: "netAmount", label: "Net", type: "money", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT s."billNo", s."billDate", st."code" AS store,
             COALESCE(p."name", s."customerName", 'Walk-in') AS customer,
             (SELECT count(*) FROM sale_lines sl WHERE sl."saleId"=s."id") AS lines,
             s."taxableAmt", (s."cgstAmt"+s."sgstAmt"+s."igstAmt") AS gst,
             s."netAmount",
             CASE WHEN s."isCancelled" THEN 'CANCELLED'
                  WHEN s."isOfflineOrigin" AND s."syncedAt" IS NULL THEN 'OFFLINE'
                  ELSE 'POSTED' END AS status
      FROM sales s
      JOIN stores st ON st."id"=s."storeId"
      LEFT JOIN patients p ON p."id"=s."patientId"
      WHERE s."hospitalId"=${hospitalId}
    `,
  },

  ledger: {
    title: "Stock Ledger",
    subtitle: "Immutable movement log — the source of truth for stock",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "createdAt", label: "When", type: "date" },
      { key: "txnType", label: "Type", type: "badge" },
      { key: "name", label: "Item" },
      { key: "batchNo", label: "Batch" },
      { key: "store", label: "Store" },
      { key: "qtyIn", label: "In", type: "qty", align: "right" },
      { key: "qtyOut", label: "Out", type: "qty", align: "right" },
      { key: "refNo", label: "Document" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT sl."createdAt", sl."txnType"::text AS "txnType", i."name",
             b."batchNo", st."code" AS store, sl."qtyIn", sl."qtyOut", sl."refNo"
      FROM stock_ledger sl
      JOIN items i   ON i."id"=sl."itemId"
      JOIN batches b ON b."id"=sl."batchId"
      JOIN stores st ON st."id"=sl."storeId"
      WHERE sl."hospitalId"=${hospitalId}
    `,
  },

  // ── Purchase ────────────────────────────────────────────────
  grns: {
    title: "Goods Receipt Notes",
    subtitle: "Supplier invoices — where stock enters the building",
    roles: [...MANAGER, "PURCHASE_OFFICER", "ACCOUNTANT", "AUDITOR"],
    searchable: true,
    columns: [
      { key: "grnNo", label: "GRN No" },
      { key: "grnDate", label: "Date", type: "date" },
      { key: "supplier", label: "Supplier" },
      { key: "supplierInvoiceNo", label: "Invoice No" },
      { key: "store", label: "Store" },
      { key: "taxableAmt", label: "Taxable", type: "money", align: "right" },
      { key: "netAmount", label: "Net", type: "money", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT g."grnNo", g."grnDate", sup."name" AS supplier,
             g."supplierInvoiceNo", st."code" AS store,
             g."taxableAmt", g."netAmount",
             CASE WHEN g."isPosted" THEN 'POSTED' ELSE 'DRAFT' END AS status
      FROM grns g
      JOIN suppliers sup ON sup."id"=g."supplierId"
      JOIN stores st ON st."id"=g."storeId"
      WHERE g."hospitalId"=${hospitalId}
    `,
  },

  suppliers: {
    title: "Suppliers",
    subtitle: "Distributors and stockists",
    roles: [...MANAGER, "PURCHASE_OFFICER", "ACCOUNTANT", "AUDITOR"],
    searchable: true,
    columns: [
      { key: "name", label: "Supplier" },
      { key: "gstin", label: "GSTIN" },
      { key: "drugLicenseNo", label: "Drug Licence" },
      { key: "city", label: "City" },
      { key: "stateCode", label: "State" },
      { key: "creditDays", label: "Credit Days", type: "qty", align: "right" },
      { key: "phone", label: "Phone" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT "id", "name", COALESCE("gstin",'—') AS gstin,
             COALESCE("drugLicenseNo",'—') AS "drugLicenseNo",
             COALESCE("city",'—') AS city, COALESCE("stateCode",'—') AS "stateCode",
             "creditDays", COALESCE("phone",'—') AS phone
      FROM suppliers
      WHERE "hospitalId"=${hospitalId} AND "deletedAt" IS NULL
    `,
  },

  // ── Indents ─────────────────────────────────────────────────
  indents: {
    title: "Ward Indents",
    subtitle: "Ward requests stock from the main store",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "indentNo", label: "Indent No" },
      { key: "indentDate", label: "Date", type: "date" },
      { key: "fromStore", label: "From" },
      { key: "toStore", label: "To" },
      { key: "lines", label: "Items", type: "qty", align: "right" },
      { key: "isEmergency", label: "Emergency", type: "bool" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT ind."id", ind."indentNo", ind."indentDate",
             f."code" AS "fromStore", t."code" AS "toStore",
             (SELECT count(*) FROM indent_lines il WHERE il."indentId"=ind."id") AS lines,
             ind."isEmergency", ind."status"::text AS status
      FROM indents ind
      JOIN stores f ON f."id"=ind."fromStoreId"
      JOIN stores t ON t."id"=ind."toStoreId"
      WHERE ind."hospitalId"=${hospitalId}
    `,
  },

  // ── Compliance ──────────────────────────────────────────────
  h1register: {
    title: "Schedule H1 Register",
    subtitle: "Written automatically on every H1 sale · retain 3 years",
    roles: FINANCE.concat("PHARMACIST"),
    searchable: true,
    columns: [
      { key: "entryDate", label: "Date", type: "date" },
      { key: "item", label: "Drug" },
      { key: "batchNo", label: "Batch" },
      { key: "qty", label: "Qty", type: "qty", align: "right" },
      { key: "patientName", label: "Patient" },
      { key: "doctorName", label: "Prescriber" },
      { key: "doctorRegNo", label: "Reg No" },
      { key: "rxNo", label: "Rx No" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT r."entryDate", i."name" AS item, b."batchNo", r."qty",
             r."patientName", r."doctorName",
             COALESCE(r."doctorRegNo",'—') AS "doctorRegNo",
             COALESCE(r."rxNo",'—') AS "rxNo"
      FROM schedule_h1_register r
      JOIN items i   ON i."id"=r."itemId"
      JOIN batches b ON b."id"=r."batchId"
      WHERE r."hospitalId"=${hospitalId}
    `,
  },

  narcotics: {
    title: "Narcotic Register",
    subtitle: "NDPS Act · running balance must reconcile daily",
    roles: FINANCE.concat("PHARMACIST"),
    searchable: true,
    columns: [
      { key: "entryDate", label: "Date", type: "date" },
      { key: "item", label: "Drug" },
      { key: "batchNo", label: "Batch" },
      { key: "openingBal", label: "Opening", type: "qty", align: "right" },
      { key: "qtyIn", label: "In", type: "qty", align: "right" },
      { key: "qtyOut", label: "Out", type: "qty", align: "right" },
      { key: "closingBal", label: "Closing", type: "qty", align: "right" },
      { key: "patientName", label: "Patient" },
      { key: "witnessedBy", label: "Witness" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT r."entryDate", i."name" AS item, b."batchNo",
             r."openingBal", r."qtyIn", r."qtyOut", r."closingBal",
             COALESCE(r."patientName",'—') AS "patientName",
             COALESCE(r."witnessedBy",'—') AS "witnessedBy"
      FROM narcotic_register r
      JOIN items i   ON i."id"=r."itemId"
      JOIN batches b ON b."id"=r."batchId"
      WHERE r."hospitalId"=${hospitalId}
    `,
  },

  // ── People ──────────────────────────────────────────────────
  patients: {
    title: "Patients",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "uhid", label: "UHID" },
      { key: "name", label: "Name" },
      { key: "age", label: "Age", type: "qty", align: "right" },
      { key: "gender", label: "Gender" },
      { key: "phone", label: "Phone" },
      { key: "bills", label: "Bills", type: "qty", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT p."id", COALESCE(p."uhid",'—') AS uhid, p."name", p."age",
             COALESCE(p."gender",'—') AS gender, COALESCE(p."phone",'—') AS phone,
             (SELECT count(*) FROM sales s WHERE s."patientId"=p."id") AS bills
      FROM patients p
      WHERE p."hospitalId"=${hospitalId} AND p."deletedAt" IS NULL
    `,
  },

  doctors: {
    title: "Doctors",
    subtitle: "Registration number is required to dispense Schedule H1",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "name", label: "Doctor" },
      { key: "registrationNo", label: "Registration No" },
      { key: "department", label: "Department" },
      { key: "phone", label: "Phone" },
      { key: "prescriptions", label: "Rx", type: "qty", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT d."id", d."name", COALESCE(d."registrationNo",'⚠ missing') AS "registrationNo",
             COALESCE(d."department",'—') AS department,
             COALESCE(d."phone",'—') AS phone,
             (SELECT count(*) FROM prescriptions p WHERE p."doctorId"=d."id") AS prescriptions
      FROM doctors d
      WHERE d."hospitalId"=${hospitalId} AND d."deletedAt" IS NULL
    `,
  },


  // ── Documents that had no history screen ────────────────────
  adjustments: {
    title: "Stock Adjustments",
    subtitle: "Write-offs and physical counts — draft until a second person approves",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "adjNo", label: "Adj No" },
      { key: "adjDate", label: "Date", type: "date" },
      { key: "store", label: "Store" },
      { key: "reason", label: "Reason", type: "badge" },
      { key: "lines", label: "Lines", type: "qty", align: "right" },
      { key: "netUnits", label: "Net Units", type: "qty", align: "right" },
      { key: "valueImpact", label: "Value Impact", type: "money", align: "right" },
      { key: "raisedBy", label: "Raised By" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT a."id", a."adjNo", a."adjDate", st."code" AS store,
             a."reason"::text AS reason,
             (SELECT count(*) FROM stock_adjustment_lines l WHERE l."adjId"=a."id") AS lines,
             COALESCE((SELECT SUM(l."diffQty") FROM stock_adjustment_lines l WHERE l."adjId"=a."id"),0) AS "netUnits",
             COALESCE((SELECT SUM(l."diffQty"*l."rate") FROM stock_adjustment_lines l WHERE l."adjId"=a."id"),0) AS "valueImpact",
             COALESCE(u."name",'—') AS "raisedBy",
             CASE WHEN a."isPosted" THEN 'POSTED' ELSE 'DRAFT' END AS status
      FROM stock_adjustments a
      JOIN stores st ON st."id"=a."storeId"
      LEFT JOIN users u ON u."id"=a."createdBy"
      WHERE a."hospitalId"=${hospitalId}
    `,
  },

  salereturns: {
    title: "Credit Notes",
    subtitle: "Medicine returned by patients",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "returnNo", label: "Credit Note" },
      { key: "returnDate", label: "Date", type: "date" },
      { key: "billNo", label: "Against Bill" },
      { key: "store", label: "Counter" },
      { key: "lines", label: "Items", type: "qty", align: "right" },
      { key: "reason", label: "Reason" },
      { key: "netAmount", label: "Refunded", type: "money", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT r."returnNo", r."returnDate", s."billNo", st."code" AS store,
             (SELECT count(*) FROM sale_return_lines l WHERE l."returnId"=r."id") AS lines,
             COALESCE(r."reason",'—') AS reason, r."netAmount"
      FROM sale_returns r
      JOIN sales s   ON s."id"=r."saleId"
      JOIN stores st ON st."id"=r."storeId"
      WHERE r."hospitalId"=${hospitalId}
    `,
  },

  purchasereturns: {
    title: "Debit Notes",
    subtitle: "Stock sent back to suppliers for credit",
    roles: [...MANAGER, "PURCHASE_OFFICER", "ACCOUNTANT", "AUDITOR"],
    searchable: true,
    columns: [
      { key: "returnNo", label: "Debit Note" },
      { key: "returnDate", label: "Date", type: "date" },
      { key: "supplier", label: "Supplier" },
      { key: "reason", label: "Reason", type: "badge" },
      { key: "lines", label: "Batches", type: "qty", align: "right" },
      { key: "netAmount", label: "Claimable", type: "money", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT r."returnNo", r."returnDate", sup."name" AS supplier, r."reason",
             (SELECT count(*) FROM purchase_return_lines l WHERE l."returnId"=r."id") AS lines,
             r."netAmount",
             CASE WHEN r."isPosted" THEN 'POSTED' ELSE 'DRAFT' END AS status
      FROM purchase_returns r
      JOIN suppliers sup ON sup."id"=r."supplierId"
      WHERE r."hospitalId"=${hospitalId}
    `,
  },

  prescriptions: {
    title: "Prescriptions",
    subtitle: "Required before Schedule H1 or narcotic drugs can be dispensed",
    roles: ALL,
    searchable: true,
    columns: [
      { key: "rxNo", label: "Rx No" },
      { key: "rxDate", label: "Date", type: "date" },
      { key: "patient", label: "Patient" },
      { key: "doctor", label: "Prescriber" },
      { key: "regNo", label: "Reg No" },
      { key: "drugs", label: "Drugs", type: "qty", align: "right" },
      { key: "status", label: "Status", type: "badge" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT rx."rxNo", rx."rxDate", p."name" AS patient, d."name" AS doctor,
             COALESCE(d."registrationNo",'⚠ missing') AS "regNo",
             (SELECT count(*) FROM prescription_lines l WHERE l."rxId"=rx."id") AS drugs,
             CASE WHEN rx."isDispensed" THEN 'DISPENSED' ELSE 'PENDING' END AS status
      FROM prescriptions rx
      JOIN patients p ON p."id"=rx."patientId"
      JOIN doctors  d ON d."id"=rx."doctorId"
      WHERE rx."hospitalId"=${hospitalId}
    `,
  },

  // ── Settings ────────────────────────────────────────────────
  stores: {
    title: "Stores & Counters",
    subtitle: "This layout decides who can bill and who must indent",
    roles: MANAGER,
    searchable: true,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "type", label: "Type", type: "badge" },
      { key: "parent", label: "Indents From" },
      { key: "canReceivePurchase", label: "Receives GRN", type: "bool" },
      { key: "canBillPatient", label: "Bills Patients", type: "bool" },
      { key: "skus", label: "SKUs", type: "qty", align: "right" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT s."id", s."code", s."name", s."type"::text AS type,
             COALESCE(p."code",'—') AS parent,
             s."canReceivePurchase", s."canBillPatient",
             (SELECT count(*) FROM stock_balances sb WHERE sb."storeId"=s."id" AND sb."quantity">0) AS skus
      FROM stores s
      LEFT JOIN stores p ON p."id"=s."parentStoreId"
      WHERE s."hospitalId"=${hospitalId} AND s."deletedAt" IS NULL
    `,
  },

  users: {
    title: "Users",
    roles: MANAGER,
    searchable: true,
    columns: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role", type: "badge" },
      { key: "pharmacistRegNo", label: "Pharmacist Reg No" },
      { key: "stores", label: "Counters" },
      { key: "lastLoginAt", label: "Last Login", type: "date" },
    ],
    sql: ({ hospitalId }) => Prisma.sql`
      SELECT u."name", u."email", u."role"::text AS role,
             COALESCE(u."pharmacistRegNo",'—') AS "pharmacistRegNo",
             COALESCE((SELECT string_agg(st."code", ', ')
                       FROM user_stores us JOIN stores st ON st."id"=us."storeId"
                       WHERE us."userId"=u."id"), 'all') AS stores,
             u."lastLoginAt"
      FROM users u
      WHERE u."hospitalId"=${hospitalId} AND u."deletedAt" IS NULL
    `,
  },
};

export const RESOURCE_KEYS = Object.keys(RESOURCES);
