import { PrismaClient } from "@prisma/client";

/**
 * Rebuild the StockBalance cache from the immutable ledger.
 *
 * Run this when:
 *   · a sync merge has just applied ledger rows from a peer
 *   · balances are suspected of drift after a crash
 *   · a physical count disagrees with the system and you want to
 *     rule out the cache before blaming the shelf
 *
 * Always safe: the ledger is the source of truth, so this can only
 * move balances toward correctness. It never invents a movement.
 *
 *   npm run stock:rebuild -- --hospital=demo-hospital [--store=<id>] [--check]
 */

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const hospitalId = arg("hospital");
  const storeId = arg("store");
  const checkOnly = process.argv.includes("--check");

  if (!hospitalId) {
    console.error("Usage: npm run stock:rebuild -- --hospital=<id> [--store=<id>] [--check]");
    process.exit(1);
  }

  // Report the drift BEFORE changing anything. If the cache was
  // wrong, that is a bug worth knowing about, not something to
  // silently paper over.
  const drift = await prisma.$queryRawUnsafe<
    Array<{ storeId: string; itemId: string; batchId: string; cached: string; actual: string }>
  >(
    `
    WITH computed AS (
      SELECT "storeId", "itemId", "batchId", SUM("qtyIn" - "qtyOut") AS qty
      FROM "stock_ledger"
      WHERE "hospitalId" = $1 ${storeId ? `AND "storeId" = $2` : ""}
      GROUP BY 1,2,3
    )
    SELECT c."storeId", c."itemId", c."batchId",
           COALESCE(sb."quantity", 0)::text AS cached,
           c.qty::text                      AS actual
    FROM computed c
    LEFT JOIN "stock_balances" sb
      ON sb."storeId" = c."storeId" AND sb."batchId" = c."batchId"
    WHERE COALESCE(sb."quantity", 0) <> c.qty
    `,
    ...(storeId ? [hospitalId, storeId] : [hospitalId]),
  );

  if (drift.length === 0) {
    console.log("✓ Balance cache agrees with the ledger. Nothing to do.");
    return;
  }

  console.log(`\n⚠ ${drift.length} balance row(s) disagree with the ledger:\n`);
  for (const d of drift.slice(0, 25)) {
    console.log(
      `  store=${d.storeId} batch=${d.batchId}  cached=${d.cached}  ledger=${d.actual}`,
    );
  }
  if (drift.length > 25) console.log(`  … and ${drift.length - 25} more`);

  if (checkOnly) {
    console.log("\n--check given: no changes written.");
    process.exit(2);
  }

  const affected = await prisma.$executeRawUnsafe(
    `
    WITH computed AS (
      SELECT "hospitalId", "storeId", "itemId", "batchId", SUM("qtyIn" - "qtyOut") AS qty
      FROM "stock_ledger"
      WHERE "hospitalId" = $1 ${storeId ? `AND "storeId" = $2` : ""}
      GROUP BY 1,2,3,4
    )
    INSERT INTO "stock_balances"
      ("id","hospitalId","storeId","itemId","batchId","quantity","reserved","updatedAt")
    SELECT md5(c."storeId" || c."batchId"), c."hospitalId", c."storeId",
           c."itemId", c."batchId", c.qty, 0, NOW()
    FROM computed c
    ON CONFLICT ("storeId","batchId")
    DO UPDATE SET "quantity" = EXCLUDED."quantity", "updatedAt" = NOW()
    `,
    ...(storeId ? [hospitalId, storeId] : [hospitalId]),
  );

  console.log(`\n✓ Rebuilt ${affected} balance row(s) from the ledger.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
