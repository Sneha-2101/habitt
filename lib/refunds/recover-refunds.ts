import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { safeErrorSummary } from "@/lib/log-redact";

export const STALE_REFUND_THRESHOLD_MS = 15 * 60 * 1000;

export interface GatewayRefundRecord {
  id: string;
  status: string;
  amount?: number;
  notes?: Record<string, string | number | undefined>;
  receipt?: string | null;
}

export function isRefundStale(
  refund: { status: string; initiatedAt: Date },
  now: Date = new Date(),
  thresholdMs: number = STALE_REFUND_THRESHOLD_MS
): boolean {
  if (refund.status !== "PENDING") return false;
  return refund.initiatedAt.getTime() <= now.getTime() - thresholdMs;
}

export function findMatchingGatewayRefund(
  items: GatewayRefundRecord[],
  refundId: string
): GatewayRefundRecord | null {
  for (const item of items) {
    if (item.notes && String(item.notes.refundId ?? "") === refundId) {
      return item;
    }
    if (item.receipt && item.receipt === refundId) {
      return item;
    }
  }
  return null;
}

export function computeRefundPaymentStatus(
  processedAmountPaise: number,
  orderTotalPaise: number
): "REFUNDED" | "PARTIALLY_REFUNDED" {
  return processedAmountPaise >= orderTotalPaise ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

export interface RecoverRefundsResult {
  checked: number;
  recoveredProcessed: number;
  markedFailed: number;
  stillPending: number;
  skipped: number;
}

/**
 * Recovers interrupted PENDING refund attempts older than STALE_REFUND_THRESHOLD_MS.
 * Uses FOR UPDATE SKIP LOCKED per refund row for concurrency safety.
 */
export async function recoverInterruptedRefunds(
  now: Date = new Date()
): Promise<RecoverRefundsResult> {
  const cutoff = new Date(now.getTime() - STALE_REFUND_THRESHOLD_MS);

  const candidates = await prisma.refund.findMany({
    where: {
      status: "PENDING",
      initiatedAt: { lte: cutoff },
    },
    select: { id: true },
    orderBy: [{ initiatedAt: "asc" }, { id: "asc" }],
    take: 25,
  });

  let recoveredProcessed = 0;
  let markedFailed = 0;
  let stillPending = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "Refund"
            WHERE "id" = ${candidate.id} AND "status" = 'PENDING'
            FOR UPDATE SKIP LOCKED
          `;
          if (locked.length === 0) {
            return "skipped" as const;
          }

          const refund = await tx.refund.findUnique({
            where: { id: candidate.id },
            include: {
              order: {
                include: { refunds: true },
              },
            },
          });

          if (!refund || refund.status !== "PENDING") {
            return "skipped" as const;
          }

          const order = refund.order;

          if (refund.method !== "RAZORPAY") {
            const reason = "Interrupted non-gateway refund";
            await tx.refund.update({
              where: { id: refund.id },
              data: { status: "FAILED", failureReason: reason },
            });
            await tx.auditLog.create({
              data: {
                actorId: null,
                action: "REFUND_RECOVERY_FAILED",
                entity: "Refund",
                entityId: refund.id,
                meta: {
                  orderId: refund.orderId,
                  returnId: refund.returnId,
                  method: refund.method,
                  amountPaise: refund.amountPaise,
                  reason,
                },
              },
            });
            return "failed" as const;
          }

          if (!order.razorpayPaymentId) {
            const reason = "Missing razorpayPaymentId on order";
            await tx.refund.update({
              where: { id: refund.id },
              data: { status: "FAILED", failureReason: reason },
            });
            await tx.orderStatusEvent.create({
              data: {
                orderId: order.id,
                fulfilmentStatus: order.fulfilmentStatus,
                paymentStatus: order.paymentStatus,
                note: `REFUND RECOVERY FAILED – ${reason}`,
              },
            });
            await tx.auditLog.create({
              data: {
                actorId: null,
                action: "REFUND_RECOVERY_FAILED",
                entity: "Refund",
                entityId: refund.id,
                meta: {
                  orderId: refund.orderId,
                  returnId: refund.returnId,
                  method: refund.method,
                  amountPaise: refund.amountPaise,
                  reason,
                },
              },
            });
            return "failed" as const;
          }

          let gatewayRefund: GatewayRefundRecord | null = null;
          try {
            const razorpay = getRazorpay();
            if (refund.providerRefundId) {
              gatewayRefund = (await razorpay.payments.fetchRefund(
                order.razorpayPaymentId,
                refund.providerRefundId
              )) as GatewayRefundRecord;
            } else {
              const list = await razorpay.payments.fetchMultipleRefund(
                order.razorpayPaymentId,
                { count: 100 }
              );
              gatewayRefund = findMatchingGatewayRefund(
                (list?.items ?? []) as GatewayRefundRecord[],
                refund.id
              );
            }
          } catch (err: unknown) {
            console.error(
              `[RefundRecovery] Gateway lookup failed for refund ${refund.id}:`,
              safeErrorSummary(err)
            );
            return "pending" as const;
          }

          if (gatewayRefund && gatewayRefund.status === "processed") {
            const otherProcessed = order.refunds
              .filter((r) => r.status === "PROCESSED" && r.id !== refund.id)
              .reduce((sum, r) => sum + r.amountPaise, 0);
            const newCumulative = otherProcessed + refund.amountPaise;
            const nextPaymentStatus = computeRefundPaymentStatus(newCumulative, order.total);

            await tx.refund.update({
              where: { id: refund.id },
              data: {
                status: "PROCESSED",
                providerRefundId: gatewayRefund.id,
                processedAt: now,
                failureReason: null,
              },
            });

            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: nextPaymentStatus,
                razorpayRefundId: gatewayRefund.id,
                refundAmount: newCumulative,
                refundedAt: now,
              },
            });

            await tx.orderStatusEvent.create({
              data: {
                orderId: order.id,
                fulfilmentStatus: order.fulfilmentStatus,
                paymentStatus: nextPaymentStatus,
                note: `Razorpay refund recovered: ${gatewayRefund.id} (₹${(
                  refund.amountPaise / 100
                ).toFixed(2)})`,
              },
            });

            await tx.auditLog.create({
              data: {
                actorId: null,
                action: "REFUND_RECOVERED_PROCESSED",
                entity: "Refund",
                entityId: refund.id,
                meta: {
                  orderId: refund.orderId,
                  returnId: refund.returnId,
                  method: "RAZORPAY",
                  amountPaise: refund.amountPaise,
                  providerRefundId: gatewayRefund.id,
                  nextPaymentStatus,
                },
              },
            });

            return "processed" as const;
          }

          if (gatewayRefund && gatewayRefund.status === "pending") {
            if (!refund.providerRefundId && gatewayRefund.id) {
              await tx.refund.update({
                where: { id: refund.id },
                data: { providerRefundId: gatewayRefund.id },
              });
            }
            return "pending" as const;
          }

          const failureReason =
            gatewayRefund && gatewayRefund.status === "failed"
              ? "Gateway reported refund failed"
              : "Interrupted before gateway confirmation";

          await tx.refund.update({
            where: { id: refund.id },
            data: {
              status: "FAILED",
              ...(gatewayRefund?.id ? { providerRefundId: gatewayRefund.id } : {}),
              failureReason,
            },
          });

          await tx.orderStatusEvent.create({
            data: {
              orderId: order.id,
              fulfilmentStatus: order.fulfilmentStatus,
              paymentStatus: order.paymentStatus,
              note: `REFUND RECOVERY FAILED – ${failureReason}`,
            },
          });

          await tx.auditLog.create({
            data: {
              actorId: null,
              action: "REFUND_RECOVERY_FAILED",
              entity: "Refund",
              entityId: refund.id,
              meta: {
                orderId: refund.orderId,
                returnId: refund.returnId,
                method: "RAZORPAY",
                amountPaise: refund.amountPaise,
                providerRefundId: gatewayRefund?.id ?? null,
                reason: failureReason,
              },
            },
          });

          return "failed" as const;
        },
        { timeout: 15000 }
      );

      if (outcome === "processed") recoveredProcessed++;
      else if (outcome === "failed") markedFailed++;
      else if (outcome === "pending") stillPending++;
      else skipped++;
    } catch (err: unknown) {
      console.error(
        `[RefundRecovery] Transaction error for refund ${candidate.id}:`,
        safeErrorSummary(err)
      );
      skipped++;
    }
  }

  return {
    checked: candidates.length,
    recoveredProcessed,
    markedFailed,
    stillPending,
    skipped,
  };
}
