import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reserveStock } from "@/lib/stock";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { issueRefund } from "@/lib/refunds/issue-refund";
import { safeErrorSummary } from "@/lib/log-redact";

export async function markOrderPaid(
  tx: Prisma.TransactionClient,
  orderId: string,
  razorpayPaymentId: string
): Promise<{ updated: boolean }> {
  const now = new Date();

  // 1. Atomic updateMany where id and paymentStatus in [PENDING, FAILED] + fulfilmentStatus CREATED -> PAID / PLACED
  const updateRes = await tx.order.updateMany({
    where: {
      id: orderId,
      paymentStatus: { in: ["PENDING", "FAILED"] },
      fulfilmentStatus: "CREATED",
    },
    data: {
      paymentStatus: "PAID",
      fulfilmentStatus: "PLACED",
      paidAt: now,
      razorpayPaymentId,
    },
  });

  if (updateRes.count === 0) {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        paymentStatus: true,
        fulfilmentStatus: true,
        total: true,
        storeCreditApplied: true,
        displayId: true,
      },
    });

    if (!current) {
      return { updated: false };
    }

    if (current.paymentStatus === "PAID") {
      return { updated: false };
    }

    if (current.fulfilmentStatus === "CANCELLED") {
      // Do NOT change status. Save payment ID if missing and log note inside transaction.
      await tx.order.updateMany({
        where: { id: orderId, razorpayPaymentId: null },
        data: { razorpayPaymentId },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          note: "Payment captured after cancellation — refund required",
        },
      });

      // After transaction, attempt full Razorpay refund of captured amount via issueRefund
      const refundAmount = Math.max(0, current.total - (current.storeCreditApplied || 0));
      setTimeout(async () => {
        try {
          if (refundAmount <= 0) return;
          const res = await issueRefund({
            orderId,
            method: "RAZORPAY",
            amountPaise: refundAmount,
            idempotencyKey: `late-capture-refund-${orderId}-${razorpayPaymentId}`,
            reason: "Payment captured after cancellation",
          });
          if (!res.success) {
            await prisma.orderStatusEvent.create({
              data: {
                orderId,
                fulfilmentStatus: "CANCELLED",
                note: `REFUND FAILED for payment ${razorpayPaymentId}: ${res.error || "Gateway failure"}`,
              },
            });
          }
        } catch (err: unknown) {
          console.error(
            "Razorpay refund error after late capture on cancelled order:",
            safeErrorSummary(err)
          );
          await prisma.orderStatusEvent.create({
            data: {
              orderId,
              fulfilmentStatus: "CANCELLED",
              note: `REFUND FAILED for payment ${razorpayPaymentId}: ${safeErrorSummary(err)}`,
            },
          });
        }
      }, 100);

      return { updated: false };
    }

    return { updated: false };
  }

  // 2. Load order items to reserve stock
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (order) {
    // reserveStock with clampOnShortage (money captured, stays PAID even if stock ran out)
    await reserveStock(
      tx,
      order.items.map((i) => ({ variantId: i.variantId, qty: i.qty })),
      "SALE",
      { refType: "Order", refId: order.id },
      { clampOnShortage: true }
    );

    await tx.order.update({
      where: { id: order.id },
      data: { stockDeducted: true },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        paymentStatus: "PAID",
        fulfilmentStatus: "PLACED",
        note: `Payment captured via Razorpay (${razorpayPaymentId})`,
      },
    });

    // 3. After commit, send confirmation email (fire and forget)
    setTimeout(() => {
      sendOrderConfirmationEmail(order.id).catch((err) => {
        console.error("Failed to send order confirmation email:", safeErrorSummary(err));
      });
    }, 100);
  }

  return { updated: true };
}
