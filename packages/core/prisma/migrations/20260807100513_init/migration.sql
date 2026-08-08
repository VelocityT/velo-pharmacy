-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('MAIN', 'SUB', 'OPD_COUNTER', 'IPD_COUNTER', 'NARCOTIC');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'PHARMACY_MANAGER', 'PURCHASE_OFFICER', 'PHARMACIST', 'STORE_KEEPER', 'ACCOUNTANT', 'AUDITOR');

-- CreateEnum
CREATE TYPE "DrugSchedule" AS ENUM ('NONE', 'H', 'H1', 'X', 'NARCOTIC');

-- CreateEnum
CREATE TYPE "LedgerTxnType" AS ENUM ('GRN', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'INDENT_ISSUE', 'INDENT_RECEIPT', 'WARD_RETURN', 'EXPIRY_WRITE_OFF', 'BREAKAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_STOCK');

-- CreateEnum
CREATE TYPE "PoStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IndentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED', 'ISSUED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PatientType" AS ENUM ('OPD', 'IPD', 'EMERGENCY', 'WALK_IN');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('CASH', 'CREDIT_IPD', 'CREDIT_TPA', 'STAFF');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD', 'CREDIT', 'MIXED');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('EXPIRY', 'BREAKAGE', 'THEFT', 'PHYSICAL_COUNT', 'RECALL', 'OTHER');

-- CreateEnum
CREATE TYPE "NodeMode" AS ENUM ('CLOUD', 'ONPREM_SERVER', 'EDGE_COUNTER');

-- CreateEnum
CREATE TYPE "SyncOp" AS ENUM ('UPSERT', 'DELETE', 'LEDGER_APPEND');

-- CreateTable
CREATE TABLE "hospitals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "drugLicenseNo" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "fyStartMonth" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StoreType" NOT NULL,
    "location" TEXT,
    "parentStoreId" TEXT,
    "canReceivePurchase" BOOLEAN NOT NULL DEFAULT false,
    "canBillPatient" BOOLEAN NOT NULL DEFAULT false,
    "owningNodeId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "pharmacistRegNo" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "user_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salts" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "salts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDrug" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "manufacturerId" TEXT,
    "packing" TEXT,
    "unitOfSale" TEXT NOT NULL DEFAULT 'STRIP',
    "unitsPerPack" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "hsnCode" TEXT,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "schedule" "DrugSchedule" NOT NULL DEFAULT 'NONE',
    "isNarcotic" BOOLEAN NOT NULL DEFAULT false,
    "isRefrigerated" BOOLEAN NOT NULL DEFAULT false,
    "isFormulary" BOOLEAN NOT NULL DEFAULT true,
    "minStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "maxStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "barcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_salts" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "saltId" TEXT NOT NULL,
    "strength" TEXT,

    CONSTRAINT "item_salts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "mfgDate" TIMESTAMP(3),
    "mrp" DECIMAL(14,2) NOT NULL,
    "purchaseRate" DECIMAL(14,2) NOT NULL,
    "saleRate" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "txnType" "LedgerTxnType" NOT NULL,
    "qtyIn" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "originNodeId" TEXT,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "drugLicenseNo" TEXT,
    "address" TEXT,
    "city" TEXT,
    "stateCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "creditDays" INTEGER NOT NULL DEFAULT 0,
    "openingBal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PoStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedDate" TIMESTAMP(3),
    "remarks" TEXT,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "qtyRecd" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grns" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "grnNo" TEXT NOT NULL,
    "grnDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "poId" TEXT,
    "supplierInvoiceNo" TEXT NOT NULL,
    "supplierInvoiceDate" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cessAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "postedAt" TIMESTAMP(3),
    "originNodeId" TEXT,
    "clientUuid" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_lines" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "freeQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxableAmt" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "gstAmt" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "gstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "grnId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "refNo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indents" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "indentNo" TEXT NOT NULL,
    "indentDate" TIMESTAMP(3) NOT NULL,
    "status" "IndentStatus" NOT NULL DEFAULT 'DRAFT',
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3),
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3),
    "originNodeId" TEXT,
    "clientUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indent_lines" (
    "id" TEXT NOT NULL,
    "indentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qtyRequested" DECIMAL(14,3) NOT NULL,
    "qtyApproved" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyIssued" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "indent_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indent_issue_batches" (
    "id" TEXT NOT NULL,
    "indentLineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "indent_issue_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNo" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "uhid" TEXT,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "gender" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_visits" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitNo" TEXT NOT NULL,
    "type" "PatientType" NOT NULL,
    "admittedAt" TIMESTAMP(3) NOT NULL,
    "dischargedAt" TIMESTAMP(3),
    "wardStoreId" TEXT,
    "bedNo" TEXT,
    "isBillClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "rxNo" TEXT NOT NULL,
    "rxDate" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "doctorId" TEXT NOT NULL,
    "notes" TEXT,
    "scanUrl" TEXT,
    "isDispensed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_lines" (
    "id" TEXT NOT NULL,
    "rxId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "dosage" TEXT,
    "days" INTEGER,
    "qtyDispensed" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "prescription_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "saleType" "SaleType" NOT NULL DEFAULT 'CASH',
    "patientId" TEXT,
    "visitId" TEXT,
    "rxId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxableAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "originNodeId" TEXT,
    "clientUuid" TEXT,
    "isOfflineOrigin" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "mrp" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxableAmt" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "gstAmt" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "qtyReturned" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "saleId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" TEXT,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "originNodeId" TEXT,
    "clientUuid" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "gstAmt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_h1_register" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "saleId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientAddress" TEXT,
    "doctorName" TEXT NOT NULL,
    "doctorRegNo" TEXT,
    "rxNo" TEXT,
    "dispensedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_h1_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "narcotic_register" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "openingBal" DECIMAL(14,3) NOT NULL,
    "qtyIn" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "closingBal" DECIMAL(14,3) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "patientName" TEXT,
    "doctorName" TEXT,
    "witnessedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narcotic_register_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "adjNo" TEXT NOT NULL,
    "adjDate" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "remarks" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "isPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" TEXT NOT NULL,
    "adjId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "actualQty" DECIMAL(14,3) NOT NULL,
    "diffQty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "storeId" TEXT,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_nodes" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "NodeMode" NOT NULL,
    "authTokenHash" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastPushedAt" TIMESTAMP(3),
    "lastPulledAt" TIMESTAMP(3),
    "lamportClock" BIGINT NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sync_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_outbox" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" "SyncOp" NOT NULL,
    "payload" JSONB NOT NULL,
    "lamport" BIGINT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "peerNodeId" TEXT NOT NULL,
    "lastLamport" BIGINT NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_blocks" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "storeId" TEXT,
    "docType" TEXT NOT NULL,
    "fyYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "nextNumber" INTEGER NOT NULL,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "localValue" JSONB NOT NULL,
    "peerValue" JSONB NOT NULL,
    "peerNodeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stores_hospitalId_type_idx" ON "stores"("hospitalId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "stores_hospitalId_code_key" ON "stores"("hospitalId", "code");

-- CreateIndex
CREATE INDEX "users_hospitalId_role_idx" ON "users"("hospitalId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_hospitalId_email_key" ON "users"("hospitalId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "user_stores_userId_storeId_key" ON "user_stores"("userId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturers_hospitalId_name_key" ON "manufacturers"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "salts_hospitalId_name_key" ON "salts"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_hospitalId_name_key" ON "item_categories"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "items_hospitalId_name_idx" ON "items"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "items_hospitalId_barcode_idx" ON "items"("hospitalId", "barcode");

-- CreateIndex
CREATE INDEX "items_hospitalId_schedule_idx" ON "items"("hospitalId", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "items_hospitalId_code_key" ON "items"("hospitalId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "item_salts_itemId_saltId_key" ON "item_salts"("itemId", "saltId");

-- CreateIndex
CREATE INDEX "batches_hospitalId_expiryDate_idx" ON "batches"("hospitalId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "batches_hospitalId_itemId_batchNo_expiryDate_key" ON "batches"("hospitalId", "itemId", "batchNo", "expiryDate");

-- CreateIndex
CREATE INDEX "stock_balances_hospitalId_itemId_idx" ON "stock_balances"("hospitalId", "itemId");

-- CreateIndex
CREATE INDEX "stock_balances_storeId_itemId_idx" ON "stock_balances"("storeId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_balances_storeId_batchId_key" ON "stock_balances"("storeId", "batchId");

-- CreateIndex
CREATE INDEX "stock_ledger_originNodeId_idx" ON "stock_ledger"("originNodeId");

-- CreateIndex
CREATE INDEX "stock_ledger_hospitalId_storeId_itemId_createdAt_idx" ON "stock_ledger"("hospitalId", "storeId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_ledger_batchId_idx" ON "stock_ledger"("batchId");

-- CreateIndex
CREATE INDEX "stock_ledger_refType_refId_idx" ON "stock_ledger"("refType", "refId");

-- CreateIndex
CREATE INDEX "suppliers_hospitalId_name_idx" ON "suppliers"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_hospitalId_status_idx" ON "purchase_orders"("hospitalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_hospitalId_poNo_key" ON "purchase_orders"("hospitalId", "poNo");

-- CreateIndex
CREATE INDEX "purchase_order_lines_poId_idx" ON "purchase_order_lines"("poId");

-- CreateIndex
CREATE INDEX "grns_hospitalId_grnDate_idx" ON "grns"("hospitalId", "grnDate");

-- CreateIndex
CREATE UNIQUE INDEX "grns_hospitalId_grnNo_key" ON "grns"("hospitalId", "grnNo");

-- CreateIndex
CREATE UNIQUE INDEX "grns_hospitalId_clientUuid_key" ON "grns"("hospitalId", "clientUuid");

-- CreateIndex
CREATE UNIQUE INDEX "grns_hospitalId_supplierId_supplierInvoiceNo_key" ON "grns"("hospitalId", "supplierId", "supplierInvoiceNo");

-- CreateIndex
CREATE INDEX "grn_lines_grnId_idx" ON "grn_lines"("grnId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_hospitalId_returnNo_key" ON "purchase_returns"("hospitalId", "returnNo");

-- CreateIndex
CREATE INDEX "purchase_return_lines_returnId_idx" ON "purchase_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "supplier_payments_hospitalId_supplierId_idx" ON "supplier_payments"("hospitalId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_hospitalId_paymentNo_key" ON "supplier_payments"("hospitalId", "paymentNo");

-- CreateIndex
CREATE INDEX "indents_hospitalId_status_idx" ON "indents"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "indents_toStoreId_status_idx" ON "indents"("toStoreId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "indents_hospitalId_indentNo_key" ON "indents"("hospitalId", "indentNo");

-- CreateIndex
CREATE UNIQUE INDEX "indents_hospitalId_clientUuid_key" ON "indents"("hospitalId", "clientUuid");

-- CreateIndex
CREATE INDEX "indent_lines_indentId_idx" ON "indent_lines"("indentId");

-- CreateIndex
CREATE INDEX "indent_issue_batches_indentLineId_idx" ON "indent_issue_batches"("indentLineId");

-- CreateIndex
CREATE INDEX "doctors_hospitalId_name_idx" ON "doctors"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "patients_hospitalId_uhid_idx" ON "patients"("hospitalId", "uhid");

-- CreateIndex
CREATE INDEX "patients_hospitalId_phone_idx" ON "patients"("hospitalId", "phone");

-- CreateIndex
CREATE INDEX "patients_hospitalId_name_idx" ON "patients"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "patient_visits_hospitalId_patientId_idx" ON "patient_visits"("hospitalId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_visits_hospitalId_visitNo_key" ON "patient_visits"("hospitalId", "visitNo");

-- CreateIndex
CREATE INDEX "prescriptions_hospitalId_patientId_idx" ON "prescriptions"("hospitalId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_hospitalId_rxNo_key" ON "prescriptions"("hospitalId", "rxNo");

-- CreateIndex
CREATE INDEX "prescription_lines_rxId_idx" ON "prescription_lines"("rxId");

-- CreateIndex
CREATE INDEX "sales_hospitalId_billDate_idx" ON "sales"("hospitalId", "billDate");

-- CreateIndex
CREATE INDEX "sales_storeId_billDate_idx" ON "sales"("storeId", "billDate");

-- CreateIndex
CREATE INDEX "sales_visitId_idx" ON "sales"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_hospitalId_billNo_key" ON "sales"("hospitalId", "billNo");

-- CreateIndex
CREATE UNIQUE INDEX "sales_hospitalId_clientUuid_key" ON "sales"("hospitalId", "clientUuid");

-- CreateIndex
CREATE INDEX "sale_lines_saleId_idx" ON "sale_lines"("saleId");

-- CreateIndex
CREATE INDEX "sale_lines_batchId_idx" ON "sale_lines"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_hospitalId_returnNo_key" ON "sale_returns"("hospitalId", "returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_hospitalId_clientUuid_key" ON "sale_returns"("hospitalId", "clientUuid");

-- CreateIndex
CREATE INDEX "sale_return_lines_returnId_idx" ON "sale_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "schedule_h1_register_hospitalId_entryDate_idx" ON "schedule_h1_register"("hospitalId", "entryDate");

-- CreateIndex
CREATE INDEX "narcotic_register_hospitalId_storeId_itemId_entryDate_idx" ON "narcotic_register"("hospitalId", "storeId", "itemId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_hospitalId_adjNo_key" ON "stock_adjustments"("hospitalId", "adjNo");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjId_idx" ON "stock_adjustment_lines"("adjId");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_hospitalId_storeId_docType_fyYear_key" ON "document_sequences"("hospitalId", "storeId", "docType", "fyYear");

-- CreateIndex
CREATE INDEX "audit_logs_hospitalId_entityType_entityId_idx" ON "audit_logs"("hospitalId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_hospitalId_createdAt_idx" ON "audit_logs"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_nodes_hospitalId_mode_idx" ON "sync_nodes"("hospitalId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "sync_nodes_hospitalId_nodeKey_key" ON "sync_nodes"("hospitalId", "nodeKey");

-- CreateIndex
CREATE INDEX "sync_outbox_hospitalId_syncedAt_idx" ON "sync_outbox"("hospitalId", "syncedAt");

-- CreateIndex
CREATE INDEX "sync_outbox_entity_entityId_idx" ON "sync_outbox"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_outbox_nodeId_lamport_key" ON "sync_outbox"("nodeId", "lamport");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_nodeId_peerNodeId_key" ON "sync_cursors"("nodeId", "peerNodeId");

-- CreateIndex
CREATE INDEX "sequence_blocks_hospitalId_nodeId_docType_fyYear_exhausted_idx" ON "sequence_blocks"("hospitalId", "nodeId", "docType", "fyYear", "exhausted");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_blocks_hospitalId_nodeId_docType_fyYear_rangeStart_key" ON "sequence_blocks"("hospitalId", "nodeId", "docType", "fyYear", "rangeStart");

-- CreateIndex
CREATE INDEX "sync_conflicts_hospitalId_resolvedAt_idx" ON "sync_conflicts"("hospitalId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_parentStoreId_fkey" FOREIGN KEY ("parentStoreId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_owningNodeId_fkey" FOREIGN KEY ("owningNodeId") REFERENCES "sync_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "manufacturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_salts" ADD CONSTRAINT "item_salts_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_salts" ADD CONSTRAINT "item_salts_saltId_fkey" FOREIGN KEY ("saltId") REFERENCES "salts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grns" ADD CONSTRAINT "grns_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "grns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indents" ADD CONSTRAINT "indents_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indents" ADD CONSTRAINT "indents_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indent_lines" ADD CONSTRAINT "indent_lines_indentId_fkey" FOREIGN KEY ("indentId") REFERENCES "indents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indent_issue_batches" ADD CONSTRAINT "indent_issue_batches_indentLineId_fkey" FOREIGN KEY ("indentLineId") REFERENCES "indent_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_visits" ADD CONSTRAINT "patient_visits_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "patient_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_lines" ADD CONSTRAINT "prescription_lines_rxId_fkey" FOREIGN KEY ("rxId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "patient_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_rxId_fkey" FOREIGN KEY ("rxId") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjId_fkey" FOREIGN KEY ("adjId") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "sync_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "sync_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_peerNodeId_fkey" FOREIGN KEY ("peerNodeId") REFERENCES "sync_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_blocks" ADD CONSTRAINT "sequence_blocks_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "sync_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
