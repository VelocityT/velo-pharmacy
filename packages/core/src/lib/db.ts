import { PrismaClient, Prisma } from "@prisma/client";
import { env } from "./env";

/**
 * Prisma client + tenant isolation.
 *
 * hospitalId is injected by a client extension rather than left to
 * the caller, because eventually a caller forgets — and a forgotten
 * hospitalId in a multi-tenant pharmacy is a cross-hospital data leak.
 *
 * In cloud mode this is backed up by Postgres RLS (see
 * prisma/migrations/*_rls). Two independent layers on purpose.
 */

const base = () =>
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? base();
if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Models that are NOT tenant-scoped or are scoped via their parent. */
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
 * Returns a client permanently bound to one hospital.
 * Every route handler should obtain its client through this and
 * never touch the raw `prisma` export directly.
 */
export function forHospital(hospitalId: string) {
  if (!hospitalId) throw new Error("forHospital() called without hospitalId");

  return prisma.$extends({
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
