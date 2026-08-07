import { Prisma, SyncOp } from "@prisma/client";
import type { Tx } from "@velocare/core/lib/db";
import { env } from "@velocare/core/lib/env";

/**
 * Sync outbox.
 *
 * The row is written inside the SAME transaction as the business
 * document. If the bill commits, its outbox row commits with it;
 * if the bill rolls back, so does the outbox row. That is what
 * makes sync exactly-once rather than best-effort — there is no
 * window in which a document exists but its sync record does not.
 *
 * In pure-cloud mode (nodeId null) this is a no-op, costing one
 * branch per movement.
 */

export interface OutboxEntry {
  entity: string;
  entityId: string;
  op: keyof typeof SyncOp;
  payload: Prisma.InputJsonValue;
}

export async function enqueue(
  tx: Tx,
  ctx: { hospitalId: string; nodeId: string | null },
  entry: OutboxEntry,
): Promise<void> {
  if (!env.SYNC_ENABLED || !ctx.nodeId) return;

  // Bump the node's Lamport clock and read it back in one statement.
  // Atomic under concurrency: the UPDATE takes a row lock, so two
  // parallel bills on the same node cannot receive the same counter.
  const [{ lamportClock }] = await tx.$queryRaw<Array<{ lamportClock: bigint }>>(
    Prisma.sql`
      UPDATE "sync_nodes"
      SET "lamportClock" = "lamportClock" + 1, "updatedAt" = NOW()
      WHERE "id" = ${ctx.nodeId}
      RETURNING "lamportClock"
    `,
  );

  await tx.syncOutbox.create({
    data: {
      hospitalId: ctx.hospitalId,
      nodeId: ctx.nodeId,
      entity: entry.entity,
      entityId: entry.entityId,
      op: entry.op as SyncOp,
      payload: entry.payload,
      lamport: lamportClock,
    },
  });
}

/** Pending rows for a peer, oldest first. */
export async function pending(tx: Tx, nodeId: string, limit = 500) {
  return tx.syncOutbox.findMany({
    where: { nodeId, syncedAt: null },
    orderBy: { lamport: "asc" },
    take: limit,
  });
}

export async function markSynced(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  await tx.syncOutbox.updateMany({
    where: { id: { in: ids } },
    data: { syncedAt: new Date() },
  });
}

export async function markFailed(tx: Tx, id: string, error: string) {
  await tx.syncOutbox.update({
    where: { id },
    data: { attempts: { increment: 1 }, lastError: error.slice(0, 500) },
  });
}
