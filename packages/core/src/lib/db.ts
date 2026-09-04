import { PrismaClient, Prisma } from "@prisma/client";
import { env } from "./env";

/**
 * Prisma client + tenant isolation.
 *
 * LAZY, for the same reason env.ts is: `next build` imports every route
 * handler while collecting page data. Constructing a PrismaClient at
 * module load would read DATABASE_URL at build time and fail the build
 * on a machine that legitimately has no database.
 *
 * The exported `prisma` is a Proxy that constructs the real client on
 * first use. Call sites are unchanged — `prisma.sale.findFirst(...)`
 * works exactly as before.
 *
 * hospitalId is injected by a client extension rather than left to the
 * caller, because eventually a caller forgets — and a forgotten
 * hospitalId in a multi-tenant pharmacy is a cross-hospital data leak.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const c = new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // Reuse across hot reloads in dev and across warm serverless
  // invocations in production — a new client per request exhausts the
  // connection pool within minutes.
  globalForPrisma.prisma = c;
  return c;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop: string | symbol) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? value.bind(c) : value;
  },
});

/** Models that are NOT tenant-scoped, or are scoped via their parent. */
const UNSCOPED = new Set<string>([
  "Hospital",
  "UserStore",
  "ItemSalt",
  "PurchaseOrderLine",
  "GrnLine",
  "PurchaseReturnLine",
  "IndentLine",
  "IndentIssueBatch",
  "PrescriptionLine",
  "SaleLine",
  "SaleReturnLine",
  "StockAdjustmentLine",
]);

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

const WRITE_OPS = new Set(["create", "createMany", "upsert"]);

/**
 * Returns a client permanently bound to one hospital. Route handlers
 * should obtain their client through this rather than touching the raw
 * `prisma` export.
 */
export function forHospital(hospitalId: string) {
  if (!hospitalId) throw new Error("forHospital() called without hospitalId");

  return client().$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && UNSCOPED.has(model)) return query(args);

          const a = args as Record<string, unknown>;

          if (READ_OPS.has(operation)) {
            a.where = { ...((a.where as object) ?? {}), hospitalId };
          }

          if (WRITE_OPS.has(operation)) {
            if (operation === "createMany") {
              const data = a.data as Record<string, unknown>[];
              a.data = (Array.isArray(data) ? data : [data]).map((d) => ({
                ...d,
                hospitalId,
              }));
            } else if (operation === "upsert") {
              a.where = { ...((a.where as object) ?? {}), hospitalId };
              a.create = { ...((a.create as object) ?? {}), hospitalId };
            } else {
              a.data = { ...((a.data as object) ?? {}), hospitalId };
            }
          }

          return query(a);
        },
      },
    },
  });
}

export type Db = ReturnType<typeof forHospital>;
export type Tx = Prisma.TransactionClient;
export { Prisma };
