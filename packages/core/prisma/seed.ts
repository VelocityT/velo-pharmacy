import { PrismaClient, StoreType, UserRole, DrugSchedule, NodeMode } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Demo tenant — enough to run a real bill end to end within a minute
 * of `npm run db:seed`, which is exactly what a client demo needs.
 *
 * Note the store layout: it is the store hierarchy, not a config
 * flag, that makes offline safe. MAIN receives purchases; OPD-01 is
 * a billing counter owned by its own node; ICU-2 is a ward that can
 * only get stock by indent. See docs/ARCHITECTURE.md §2.
 */

const prisma = new PrismaClient();

async function main() {
  const hospital = await prisma.hospital.upsert({
    where: { id: "demo-hospital" },
    update: {},
    create: {
      id: "demo-hospital",
      name: "Velocare Demo Hospital",
      legalName: "Velocare Healthcare Pvt Ltd",
      gstin: "36AABCV1234M1Z5",
      drugLicenseNo: "TS/HYD/20B/2024/1188",
      city: "Hyderabad",
      state: "Telangana",
      stateCode: "36",
      phone: "+91 40 4000 1234",
      fyStartMonth: 4,
    },
  });

  const cloudNode = await prisma.syncNode.upsert({
    where: { hospitalId_nodeKey: { hospitalId: hospital.id, nodeKey: "CLOUD" } },
    update: {},
    create: { hospitalId: hospital.id, nodeKey: "CLOUD", name: "Cloud", mode: NodeMode.CLOUD },
  });

  const counterNode = await prisma.syncNode.upsert({
    where: { hospitalId_nodeKey: { hospitalId: hospital.id, nodeKey: "COUNTER-01" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      nodeKey: "COUNTER-01",
      name: "OPD Counter 1",
      mode: NodeMode.EDGE_COUNTER,
    },
  });

  const main = await prisma.store.upsert({
    where: { hospitalId_code: { hospitalId: hospital.id, code: "MAIN" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      code: "MAIN",
      name: "Central Pharmacy Store",
      type: StoreType.MAIN,
      canReceivePurchase: true,
      canBillPatient: false,
      owningNodeId: cloudNode.id,
    },
  });

  const opd = await prisma.store.upsert({
    where: { hospitalId_code: { hospitalId: hospital.id, code: "OPD-01" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      code: "OPD-01",
      name: "OPD Dispensing Counter 1",
      type: StoreType.OPD_COUNTER,
      parentStoreId: main.id,
      canBillPatient: true,
      // Owned by the counter node — this is what lets it bill offline
      // without any other node being able to touch its stock.
      owningNodeId: counterNode.id,
    },
  });

  await prisma.store.upsert({
    where: { hospitalId_code: { hospitalId: hospital.id, code: "ICU-2" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      code: "ICU-2",
      name: "ICU Floor 2 Sub-store",
      type: StoreType.SUB,
      parentStoreId: main.id,
      owningNodeId: cloudNode.id,
    },
  });

  const passwordHash = await bcrypt.hash("Demo@12345", 10);

  const admin = await prisma.user.upsert({
    where: { hospitalId_email: { hospitalId: hospital.id, email: "admin@velocare.in" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      name: "Hospital Admin",
      email: "admin@velocare.in",
      passwordHash,
      role: UserRole.HOSPITAL_ADMIN,
    },
  });

  const pharmacist = await prisma.user.upsert({
    where: { hospitalId_email: { hospitalId: hospital.id, email: "pharmacist@velocare.in" } },
    update: {},
    create: {
      hospitalId: hospital.id,
      name: "R. Kumar",
      email: "pharmacist@velocare.in",
      passwordHash,
      role: UserRole.PHARMACIST,
      pharmacistRegNo: "TSPC/45821",
    },
  });

  await prisma.userStore.upsert({
    where: { userId_storeId: { userId: pharmacist.id, storeId: opd.id } },
    update: {},
    create: { userId: pharmacist.id, storeId: opd.id },
  });

  const [tablet, injection, consumable] = await Promise.all(
    ["Tablet", "Injection", "Consumable"].map((name, i) =>
      prisma.itemCategory.upsert({
        where: { hospitalId_name: { hospitalId: hospital.id, name } },
        update: {},
        create: { hospitalId: hospital.id, name, isDrug: i < 2 },
      }),
    ),
  );

  const mfr = await prisma.manufacturer.upsert({
    where: { hospitalId_name: { hospitalId: hospital.id, name: "GSK Pharmaceuticals" } },
    update: {},
    create: { hospitalId: hospital.id, name: "GSK Pharmaceuticals" },
  });

  const items = [
    { code: "MED0001", name: "Crocin Advance 500mg Tab", cat: tablet.id, gst: 12, hsn: "30049099", sch: DrugSchedule.NONE, packing: "10x15", barcode: "8901234567890" },
    { code: "MED0002", name: "Azithral 500mg Tab", cat: tablet.id, gst: 12, hsn: "30042019", sch: DrugSchedule.H, packing: "1x5" },
    { code: "MED0003", name: "Alprax 0.5mg Tab", cat: tablet.id, gst: 12, hsn: "30049069", sch: DrugSchedule.H1, packing: "1x15" },
    { code: "MED0004", name: "Morphine Sulphate 10mg Inj", cat: injection.id, gst: 5, hsn: "30039011", sch: DrugSchedule.NARCOTIC, packing: "1x1", narcotic: true },
    { code: "SUR0001", name: "Disposable Syringe 5ml", cat: consumable.id, gst: 12, hsn: "90183100", sch: DrugSchedule.NONE, packing: "1x100" },
  ];

  for (const it of items) {
    const item = await prisma.item.upsert({
      where: { hospitalId_code: { hospitalId: hospital.id, code: it.code } },
      update: {},
      create: {
        hospitalId: hospital.id,
        code: it.code,
        name: it.name,
        categoryId: it.cat,
        manufacturerId: mfr.id,
        packing: it.packing,
        unitOfSale: "STRIP",
        hsnCode: it.hsn,
        gstRate: it.gst,
        schedule: it.sch,
        isNarcotic: it.narcotic ?? false,
        barcode: it.barcode,
        minStock: 50,
        maxStock: 500,
        reorderQty: 200,
      },
    });

    // One batch per item, 18 months of shelf life, opening stock at
    // the OPD counter so a demo bill works immediately.
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 18);

    const batch = await prisma.batch.upsert({
      where: {
        hospitalId_itemId_batchNo_expiryDate: {
          hospitalId: hospital.id,
          itemId: item.id,
          batchNo: "DEMO001",
          expiryDate: expiry,
        },
      },
      update: {},
      create: {
        hospitalId: hospital.id,
        itemId: item.id,
        batchNo: "DEMO001",
        expiryDate: expiry,
        mrp: 100,
        purchaseRate: 62,
        saleRate: 100,
      },
    });

    // Opening stock goes through the ledger like everything else.
    // There is no back door that writes a balance directly.
    await prisma.stockLedger.create({
      data: {
        hospitalId: hospital.id,
        storeId: opd.id,
        itemId: item.id,
        batchId: batch.id,
        txnType: "OPENING_STOCK",
        qtyIn: 200,
        qtyOut: 0,
        rate: 62,
        refType: "OPENING",
        refId: "seed",
        refNo: "OPENING/SEED",
        createdBy: admin.id,
        originNodeId: cloudNode.id,
      },
    });

    await prisma.stockBalance.upsert({
      where: { storeId_batchId: { storeId: opd.id, batchId: batch.id } },
      update: { quantity: 200 },
      create: {
        hospitalId: hospital.id,
        storeId: opd.id,
        itemId: item.id,
        batchId: batch.id,
        quantity: 200,
      },
    });
  }

  await prisma.doctor.create({
    data: {
      hospitalId: hospital.id,
      name: "Dr. S. Reddy",
      registrationNo: "TSMC/2011/34512",
      department: "General Medicine",
    },
  });

  const supplier = await prisma.supplier.create({
    data: {
      hospitalId: hospital.id,
      name: "Hyderabad Medical Distributors",
      gstin: "36AAECH9876P1Z2",
      drugLicenseNo: "TS/HYD/20B/2019/442",
      stateCode: "36",
      creditDays: 30,
    },
  });

  console.log(`
  Seeded.
    Hospital   ${hospital.name}
    Stores     MAIN (purchase) · OPD-01 (billing, offline-capable) · ICU-2 (indent only)
    Login      admin@velocare.in / pharmacist@velocare.in — Demo@12345
    Stock      200 units of 5 items at OPD-01
    Supplier   ${supplier.name}

    Try: bill Crocin at OPD-01, then pull the network cable and bill again.
  `);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
