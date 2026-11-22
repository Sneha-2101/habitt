import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface EnqueueOutboxInput {
  type: string;
  channel: "EMAIL" | "WHATSAPP";
  orderId?: string | null;
  payload: Prisma.InputJsonValue;
  dedupeKey: string;
}

/**
 * Enqueues an outbox event idempotently.
 * Safe to call inside or outside database transactions.
 * If dedupeKey is already recorded, returns existing record without throwing.
 */
export async function enqueueOutbox(
  input: EnqueueOutboxInput,
  tx?: Prisma.TransactionClient
) {
  const db = tx || prisma;

  return await db.eventOutbox.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      type: input.type,
      channel: input.channel,
      orderId: input.orderId || null,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
      dedupeKey: input.dedupeKey,
    },
    update: {},
  });
}

