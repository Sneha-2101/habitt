import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  sendShipmentNotificationEmail,
  sendOutForDeliveryEmail,
  sendDeliveredEmail,
  sendTicketEventEmail,
  sendNewsletterWelcomeEmail,
  sendWalletExpiryWarningEmail,
} from "@/lib/email";
import { isWhatsappMessagesLive } from "@/lib/whatsapp-flag";

function redactOutboxPayload(payload: unknown): Prisma.InputJsonValue | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const copy = { ...(payload as Record<string, unknown>) };
  let modified = false;
  if ("token" in copy) {
    copy.token = "[redacted]";
    modified = true;
  }
  if (typeof copy.viewUrl === "string" && copy.viewUrl.includes("?t=")) {
    copy.viewUrl = copy.viewUrl.split("?t=")[0] + "?t=[redacted]";
    modified = true;
  }
  if ("accessToken" in copy) {
    copy.accessToken = "[redacted]";
    modified = true;
  }
  if ("couponCode" in copy) {
    copy.couponCode = "[redacted]";
    modified = true;
  }
  return modified ? (copy as Prisma.InputJsonObject) : undefined;
}

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
        let res: { success?: boolean; error?: unknown; reason?: string } | undefined = { success: false };

        if (item.type.startsWith("TICKET_")) {
          res = await sendTicketEventEmail(item.type, payloadObj || {});
          if (
            res?.success !== false &&
            item.type === "TICKET_ACKNOWLEDGED" &&
            typeof payloadObj?.ticketId === "string"
          ) {
            await prisma.ticket.update({
              where: { id: payloadObj.ticketId },
              data: { acknowledgedAt: new Date() },
            });
          }
        } else if (item.type === "ORDER_SHIPPED" || item.type === "SHIPPED") {
          if (!orderId) throw new Error("Missing orderId in outbox payload");
          res = await sendShipmentNotificationEmail(orderId);
        } else if (item.type === "ORDER_OUT_FOR_DELIVERY" || item.type === "OUT_FOR_DELIVERY") {
          if (!orderId) throw new Error("Missing orderId in outbox payload");
          res = await sendOutForDeliveryEmail(orderId);
        } else if (item.type === "ORDER_DELIVERED" || item.type === "DELIVERED") {
          if (!orderId) throw new Error("Missing orderId in outbox payload");
          res = await sendDeliveredEmail(orderId);
        } else if (item.type === "WELCOME_COUPON") {
          const toEmail = typeof payloadObj?.email === "string" ? payloadObj.email : null;
          const couponCode = typeof payloadObj?.couponCode === "string" ? payloadObj.couponCode : null;
          if (!toEmail || !couponCode) {
            throw new Error("Missing email or couponCode in WELCOME_COUPON outbox payload");
          }
          res = await sendNewsletterWelcomeEmail(toEmail, couponCode);
        } else if (item.type === "WALLET_EXPIRY_WARNING") {
          const toEmail = typeof payloadObj?.email === "string" ? payloadObj.email : null;
          const amountPaise = typeof payloadObj?.amountPaise === "number" ? payloadObj.amountPaise : null;
          const expiresAt = typeof payloadObj?.expiresAt === "string" ? payloadObj.expiresAt : null;
          if (!toEmail || amountPaise === null || !expiresAt) {
            throw new Error("Missing email, amountPaise, or expiresAt in WALLET_EXPIRY_WARNING outbox payload");
          }
          res = await sendWalletExpiryWarningEmail({ to: toEmail, amountPaise, expiresAt });
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
        const redacted = redactOutboxPayload(item.payload);
        await prisma.eventOutbox.update({
          where: { id: item.id },
          data: {
            status: "SENT",
            attempts,
            sentAt: new Date(),
            lastError: null,
            ...(redacted !== undefined ? { payload: redacted } : {}),
          },
        });
        sent++;
      } else {
        if (attempts >= 5) {
          // Exhausted max attempts
          const redacted = redactOutboxPayload(item.payload);
          await prisma.eventOutbox.update({
            where: { id: item.id },
            data: {
              status: "FAILED",
              attempts,
              lastError: errorMsg,
              ...(redacted !== undefined ? { payload: redacted } : {}),
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
