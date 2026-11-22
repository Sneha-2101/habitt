import { prisma } from "@/lib/prisma";
import {
  sendShipmentNotificationEmail,
  sendOutForDeliveryEmail,
  sendDeliveredEmail,
} from "@/lib/email";
import { isWhatsappMessagesLive } from "@/lib/whatsapp-flag";

const BACKOFF_MS = [
  5 * 60 * 1000, // 5 min
  30 * 60 * 1000, // 30 min
  2 * 60 * 60 * 1000, // 2 hours
  12 * 60 * 60 * 1000, // 12 hours
];

export interface ProcessOutboxResult {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Processes up to 25 pending outbox records.
 * Uses atomic claim to prevent double-processing across parallel workers.
 * Implements exponential backoff up to 5 attempts before marking FAILED.
 */
export async function processOutboxBatch(batchSize = 25): Promise<ProcessOutboxResult> {
  const now = new Date();

  // Find candidate pending rows
  const candidates = await prisma.eventOutbox.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: batchSize,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of candidates) {
    // Atomically claim the row by moving nextAttemptAt into the future
    const claimed = await prisma.eventOutbox.updateMany({
      where: {
        id: item.id,
        status: "PENDING",
        nextAttemptAt: { lte: now },
      },
      data: {
        nextAttemptAt: new Date(Date.now() + 10 * 60 * 1000), // locked for 10 min
      },
    });

    if (claimed.count === 0) {
      continue; // Another worker claimed this item
    }

    // Process Channel
    if (item.channel === "WHATSAPP") {
      if (!isWhatsappMessagesLive()) {
        await prisma.eventOutbox.update({
          where: { id: item.id },
          data: {
            status: "SKIPPED",
            lastError: "WHATSAPP_MESSAGES_LIVE flag is disabled",
          },
        });
        skipped++;
        continue;
      }

      // If live, mark SENT (mock or live dispatch)
      await prisma.eventOutbox.update({
        where: { id: item.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
        },
      });
      sent++;
      continue;
    }

    if (item.channel === "EMAIL") {
      const payloadObj =
        item.payload && typeof item.payload === "object"
          ? (item.payload as Record<string, unknown>)
          : null;
      const orderId =
        item.orderId ||
        (typeof payloadObj?.orderId === "string" ? payloadObj.orderId : null);
      let emailSuccess = false;
      let errorMsg = "Email dispatch failed";

      try {
        if (!orderId) {
          throw new Error("Missing orderId in outbox payload");
        }

        let res: { success?: boolean; error?: unknown; reason?: string } | undefined = { success: false };
        if (item.type === "ORDER_SHIPPED" || item.type === "SHIPPED") {
          res = await sendShipmentNotificationEmail(orderId);
        } else if (item.type === "ORDER_OUT_FOR_DELIVERY" || item.type === "OUT_FOR_DELIVERY") {
          res = await sendOutForDeliveryEmail(orderId);
        } else if (item.type === "ORDER_DELIVERED" || item.type === "DELIVERED") {
          res = await sendDeliveredEmail(orderId);
        } else {
          // Unknown email type, treat as sent
          res = { success: true };
        }

        emailSuccess = res?.success !== false;
        if (!emailSuccess) {
          errorMsg = res?.reason || (typeof res?.error === "string" ? res.error : "Email delivery failed");
        }
      } catch (err: unknown) {
        emailSuccess = false;
        errorMsg = err instanceof Error ? err.message : "Email exception occurred";
      }

      const attempts = item.attempts + 1;

      if (emailSuccess) {
        await prisma.eventOutbox.update({
          where: { id: item.id },
          data: {
            status: "SENT",
            attempts,
            sentAt: new Date(),
            lastError: null,
          },
        });
        sent++;
      } else {
        if (attempts >= 5) {
          // Exhausted max attempts
          await prisma.eventOutbox.update({
            where: { id: item.id },
            data: {
              status: "FAILED",
              attempts,
              lastError: errorMsg,
            },
          });
          failed++;
        } else {
          const backoffDelay = BACKOFF_MS[attempts - 1] || 12 * 60 * 60 * 1000;
          await prisma.eventOutbox.update({
            where: { id: item.id },
            data: {
              status: "PENDING",
              attempts,
              nextAttemptAt: new Date(Date.now() + backoffDelay),
              lastError: errorMsg,
            },
          });
          failed++;
        }
      }
    }
  }

  return {
    processed: candidates.length,
    sent,
    skipped,
    failed,
  };
}
