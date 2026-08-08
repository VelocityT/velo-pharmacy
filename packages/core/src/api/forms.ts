import { z } from "zod";

/**
 * ────────────────────────────────────────────────────────────────
 *  FORM REGISTRY
 * ────────────────────────────────────────────────────────────────
 *
 *  Field definitions + validation for every master. One config entry
 *  gives you a create form, an edit form, server-side validation and
 *  a write endpoint — the same trick as the resource registry, so
 *  six modules arrive at once instead of over six days.
 *
 *  Validation lives HERE, not in the browser, because the browser is
 *  not a security boundary. The UI reads these definitions to render
 *  fields; the server re-validates everything on write.
 */

export type FieldType =
  | "text" | "number" | "money" | "select" | "checkbox" | "date" | "textarea" | "ref";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** For select. */
  options?: Array<{ value: string; label: string }>;
  /** For ref — which resource to look up. */
  refResource?: string;
  /** Grid width out of 12. */
  span?: number;
  step?: string;
  defaultValue?: string | number | boolean;
}

export interface FormDef {
  model: string;
  title: string;
  singular: string;
  roles: string[];
  fields: Field[];
  schema: z.ZodTypeAny;
  /** Fields that must be unique within the hospital. */
  unique?: string[][];
  /** Human message when a unique constraint trips. */
  uniqueMessage?: string;
}

const MANAGER = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "PHARMACY_MANAGER"];
const PURCHASE = [...MANAGER, "PURCHASE_OFFICER"];
const COUNTER = [...MANAGER, "PHARMACIST"];

const GST_OPTIONS = [0, 5, 12, 18, 28].map((v) => ({ value: String(v), label: `${v}%` }));

const SCHEDULE_OPTIONS = [
  { value: "NONE", label: "None — over the counter" },
  { value: "H", label: "H — prescription required" },
  { value: "H1", label: "H1 — prescription + separate register" },
  { value: "X", label: "X — strictest schedule" },
  { value: "NARCOTIC", label: "Narcotic — NDPS, double lock" },
];

export const FORMS: Record<string, FormDef> = {
  items: {
    model: "item",
    title: "Item Master",
    singular: "Item",
    roles: PURCHASE,
    unique: [["code"]],
    uniqueMessage: "An item with this code already exists.",
    fields: [
      { key: "code", label: "Item Code", type: "text", required: true, span: 4, placeholder: "MED0001" },
      { key: "name", label: "Item Name", type: "text", required: true, span: 8, placeholder: "Crocin Advance 500mg Tab" },
      { key: "categoryId", label: "Category", type: "ref", refResource: "itemCategories", required: true, span: 6 },
      { key: "manufacturerId", label: "Manufacturer", type: "ref", refResource: "manufacturers", span: 6 },
      { key: "packing", label: "Packing", type: "text", span: 3, placeholder: "10x15" },
      { key: "unitOfSale", label: "Unit of Sale", type: "select", span: 3, defaultValue: "STRIP",
        options: ["STRIP", "TAB", "VIAL", "BOTTLE", "TUBE", "PACK", "NOS"].map((v) => ({ value: v, label: v })) },
      { key: "unitsPerPack", label: "Units / Pack", type: "number", span: 3, step: "0.001", defaultValue: 1 },
      { key: "barcode", label: "Barcode", type: "text", span: 3, hint: "Enables scan-to-bill" },
      { key: "hsnCode", label: "HSN Code", type: "text", required: true, span: 4, placeholder: "30049099", hint: "Required for GSTR-1" },
      { key: "gstRate", label: "GST Rate", type: "select", required: true, span: 4, options: GST_OPTIONS, defaultValue: "12" },
      { key: "cessRate", label: "Cess %", type: "number", span: 4, step: "0.01", defaultValue: 0 },
      { key: "schedule", label: "Drug Schedule", type: "select", required: true, span: 6, options: SCHEDULE_OPTIONS, defaultValue: "NONE",
        hint: "H1 and Narcotic write their registers automatically" },
      { key: "isNarcotic", label: "Narcotic (NDPS)", type: "checkbox", span: 2 },
      { key: "isRefrigerated", label: "Cold chain", type: "checkbox", span: 2 },
      { key: "isFormulary", label: "In formulary", type: "checkbox", span: 2, defaultValue: true },
      { key: "minStock", label: "Min Stock", type: "number", span: 4, step: "0.001", hint: "Triggers the low-stock alert" },
      { key: "maxStock", label: "Max Stock", type: "number", span: 4, step: "0.001" },
      { key: "reorderQty", label: "Reorder Qty", type: "number", span: 4, step: "0.001" },
    ],
    schema: z.object({
      code: z.string().min(1).max(40),
      name: z.string().min(2).max(200),
      categoryId: z.string().min(1, "Pick a category."),
      manufacturerId: z.string().optional().nullable(),
      packing: z.string().max(40).optional().nullable(),
      unitOfSale: z.string().default("STRIP"),
      unitsPerPack: z.coerce.number().positive().default(1),
      barcode: z.string().max(60).optional().nullable(),
      hsnCode: z.string().min(4, "HSN is required for GST returns.").max(10),
      gstRate: z.coerce.number().min(0).max(28),
      cessRate: z.coerce.number().min(0).max(100).default(0),
      schedule: z.enum(["NONE", "H", "H1", "X", "NARCOTIC"]),
      isNarcotic: z.coerce.boolean().default(false),
      isRefrigerated: z.coerce.boolean().default(false),
      isFormulary: z.coerce.boolean().default(true),
      minStock: z.coerce.number().min(0).default(0),
      maxStock: z.coerce.number().min(0).default(0),
      reorderQty: z.coerce.number().min(0).default(0),
    }),
  },

  suppliers: {
    model: "supplier",
    title: "Suppliers",
    singular: "Supplier",
    roles: PURCHASE,
    fields: [
      { key: "name", label: "Supplier Name", type: "text", required: true, span: 8 },
      { key: "gstin", label: "GSTIN", type: "text", span: 4, placeholder: "36AAECH9876P1Z2" },
      { key: "drugLicenseNo", label: "Drug Licence No", type: "text", span: 6 },
      { key: "stateCode", label: "GST State Code", type: "text", required: true, span: 3, placeholder: "36",
        hint: "Different from yours = IGST" },
      { key: "creditDays", label: "Credit Days", type: "number", span: 3, defaultValue: 0 },
      { key: "address", label: "Address", type: "textarea", span: 8 },
      { key: "city", label: "City", type: "text", span: 4 },
      { key: "phone", label: "Phone", type: "text", span: 6 },
      { key: "email", label: "Email", type: "text", span: 6 },
      { key: "openingBal", label: "Opening Balance", type: "money", span: 6, hint: "Amount owed on go-live day" },
    ],
    schema: z.object({
      name: z.string().min(2).max(200),
      gstin: z.string().max(20).optional().nullable(),
      drugLicenseNo: z.string().max(60).optional().nullable(),
      stateCode: z.string().min(1).max(3),
      creditDays: z.coerce.number().int().min(0).default(0),
      address: z.string().max(400).optional().nullable(),
      city: z.string().max(80).optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      email: z.string().email().optional().nullable().or(z.literal("")),
      openingBal: z.coerce.number().default(0),
    }),
  },

  doctors: {
    model: "doctor",
    title: "Doctors",
    singular: "Doctor",
    roles: COUNTER,
    fields: [
      { key: "name", label: "Doctor Name", type: "text", required: true, span: 7 },
      { key: "registrationNo", label: "Registration No", type: "text", required: true, span: 5,
        hint: "Legally required on the Schedule H1 register — H1 sales are blocked without it" },
      { key: "department", label: "Department", type: "text", span: 7 },
      { key: "phone", label: "Phone", type: "text", span: 5 },
    ],
    schema: z.object({
      name: z.string().min(2).max(120),
      registrationNo: z.string().min(2, "Required — H1 dispensing is blocked without it.").max(60),
      department: z.string().max(80).optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
    }),
  },

  patients: {
    model: "patient",
    title: "Patients",
    singular: "Patient",
    roles: COUNTER,
    fields: [
      { key: "name", label: "Patient Name", type: "text", required: true, span: 7 },
      { key: "uhid", label: "UHID", type: "text", span: 5, hint: "Hospital master patient index number" },
      { key: "age", label: "Age", type: "number", span: 3 },
      { key: "gender", label: "Gender", type: "select", span: 3,
        options: [{ value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }] },
      { key: "phone", label: "Phone", type: "text", span: 6 },
      { key: "address", label: "Address", type: "textarea", span: 12 },
    ],
    schema: z.object({
      name: z.string().min(2).max(120),
      uhid: z.string().max(40).optional().nullable(),
      age: z.coerce.number().int().min(0).max(130).optional().nullable(),
      gender: z.string().max(10).optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      address: z.string().max(400).optional().nullable(),
    }),
  },

  stores: {
    model: "store",
    title: "Stores & Counters",
    singular: "Store",
    roles: MANAGER,
    unique: [["code"]],
    uniqueMessage: "A store with this code already exists.",
    fields: [
      { key: "code", label: "Store Code", type: "text", required: true, span: 4, placeholder: "OPD-02" },
      { key: "name", label: "Store Name", type: "text", required: true, span: 8 },
      { key: "type", label: "Store Type", type: "select", required: true, span: 6,
        options: [
          { value: "MAIN", label: "MAIN — central store, receives purchases" },
          { value: "SUB", label: "SUB — ward / floor sub-store" },
          { value: "OPD_COUNTER", label: "OPD Counter — dispenses to outpatients" },
          { value: "IPD_COUNTER", label: "IPD Counter — charges to admission" },
          { value: "NARCOTIC", label: "Narcotic — double-lock cabinet" },
        ] },
      { key: "parentStoreId", label: "Indents From", type: "ref", refResource: "stores", span: 6,
        hint: "Blank for the main store" },
      { key: "location", label: "Location / Floor", type: "text", span: 12 },
      { key: "canReceivePurchase", label: "Can receive GRN", type: "checkbox", span: 6,
        hint: "Only the main store should" },
      { key: "canBillPatient", label: "Can bill patients", type: "checkbox", span: 6 },
    ],
    schema: z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(2).max(120),
      type: z.enum(["MAIN", "SUB", "OPD_COUNTER", "IPD_COUNTER", "NARCOTIC"]),
      parentStoreId: z.string().optional().nullable(),
      location: z.string().max(120).optional().nullable(),
      canReceivePurchase: z.coerce.boolean().default(false),
      canBillPatient: z.coerce.boolean().default(false),
    }),
  },
};

export const FORM_KEYS = Object.keys(FORMS);
