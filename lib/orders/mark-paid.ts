import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reserveStock } from "@/lib/stock";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { getRazorpay } from "@/lib/razorpay";

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
      // Do NOT change status. Log note inside transaction.
      await tx.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          note: "Payment captured after cancellation — refund required",
        },
      });

      // After transaction, attempt full Razorpay refund of captured amount
      const refundAmount = Math.max(0, current.total - (current.storeCreditApplied || 0));
      setTimeout(async () => {
        try {
          const razorpay = getRazorpay();
          await razorpay.payments.refund(razorpayPaymentId, {
            amount: refundAmount,
            notes: {
              reason: "Payment captured after cancellation",
              orderId: current.displayId,
            },
          });
          await prisma.orderStatusEvent.create({
            data: {
              orderId,
              fulfilmentStatus: "CANCELLED",
              note: `Auto-refunded ₹${(refundAmount / 100).toFixed(2)} via Razorpay for payment ${razorpayPaymentId}`,
            },
          });
        } catch (err: any) {
          console.error("Razorpay refund error after late capture on cancelled order:", err);
          await prisma.orderStatusEvent.create({
            data: {
              orderId,
              fulfilmentStatus: "CANCELLED",
              note: `REFUND FAILED for payment ${razorpayPaymentId}: ${err?.message || err}`,
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
        console.error("Failed to send order confirmation email:", err);
      });
    }, 100);
  }

  return { updated: true };
}
