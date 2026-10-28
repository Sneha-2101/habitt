"use server";

import { requireStaff, requireUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { releaseStock } from "@/lib/stock";
import { canTransition } from "@/lib/orders/transitions";
import { revalidatePath } from "next/cache";
import { sendCancellationEmail } from "@/lib/email";
import { OrderStatus } from "@prisma/client";

export async function cancelOrderAsCustomer(orderId: string, reason: string) {
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");
  if (order.userId !== user.id) throw new Error("Unauthorized: Order does not belong to you.");

  // Check legal transition
  if (!canTransition(order.paymentMethod, order.status, "CANCELLED") || order.status === "DELIVERED") {
    throw new Error(`Order cannot be cancelled from status ${order.status}`);
  }

  const cancellationReason = reason?.trim() || "Cancelled by customer";
  const priorStatus = order.status;

  // Claim first: atomic conditional update inside transaction
  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
        status: priorStatus,
      },
      data: {
        status: "CANCELLED",
        cancellationReason,
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    // Release stock ONLY if stockDeducted
    if (order.stockDeducted && order.items.length > 0) {
      await releaseStock(tx, order.items, "CANCEL", {
        refType: "Order",
        refId: order.id,
      });
      await tx.order.update({
        where: { id: order.id },
        data: { stockDeducted: false },
      });
    }

    // Restore store credit
    if (order.storeCreditApplied > 0 && order.userId) {
      await tx.user.update({
        where: { id: order.userId },
        data: { storeCreditBalance: { increment: order.storeCreditApplied } },
      });

      await tx.storeCreditTransaction.create({
        data: {
          userId: order.userId,
          amount: order.storeCreditApplied,
          reason: `Refund store credit for cancelled Order #${order.displayId}`,
          relatedOrderId: order.id,
        },
      });
    }

    // Release coupon usage
    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode, timesUsed: { gt: 0 } },
        data: { timesUsed: { decrement: 1 } },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: `Cancelled by customer. Reason: ${cancellationReason}`,
      },
    });
  });

  // Refund after: if a Razorpay refund is owed, call after commit
  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);
  const owesRazorpayRefund =
    order.paymentMethod === "RAZORPAY" &&
    priorStatus === "PAID" &&
    razorpayAmountToRefund > 0 &&
    order.razorpayPaymentId;

  if (owesRazorpayRefund && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: razorpayAmountToRefund,
        notes: {
          reason: cancellationReason,
          orderId: order.displayId,
        },
      });

      await prisma.order.update({
        where: { id: orderId },
        data: {
          razorpayRefundId: refund.id,
          refundedAt: new Date(),
          refundAmount: razorpayAmountToRefund,
        },
      });

      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          status: "CANCELLED",
          note: `Razorpay refund processed: ${refund.id} (₹${(razorpayAmountToRefund / 100).toFixed(2)})`,
        },
      });
    } catch (err: any) {
      console.error("Razorpay refund error during customer cancellation:", err);
      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          status: "CANCELLED",
          note: `REFUND FAILED – manual action required: ${err?.message || err}`,
        },
      });
    }
  }

  // Async email notification
  sendCancellationEmail(orderId).catch((err) => {
    console.error("Failed to send cancellation email:", err);
  });

  revalidatePath("/account");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function cancelOrderAsAdmin(orderId: string, reason: string) {
  await requireStaff();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  if (!canTransition(order.paymentMethod, order.status, "CANCELLED") || order.status === "DELIVERED") {
    throw new Error(`Order cannot be cancelled from status ${order.status}`);
  }

  const cancellationReason = reason?.trim() || "Cancelled by admin";
  const priorStatus = order.status;

  // Claim first: atomic conditional update inside transaction
  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
        status: priorStatus,
      },
      data: {
        status: "CANCELLED",
        cancellationReason,
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    // Release stock ONLY if stockDeducted
    if (order.stockDeducted && order.items.length > 0) {
      await releaseStock(tx, order.items, "CANCEL", {
        refType: "Order",
        refId: order.id,
      });
      await tx.order.update({
        where: { id: order.id },
        data: { stockDeducted: false },
      });
    }

    // Restore store credit
    if (order.storeCreditApplied > 0 && order.userId) {
      await tx.user.update({
        where: { id: order.userId },
        data: { storeCreditBalance: { increment: order.storeCreditApplied } },
      });

      await tx.storeCreditTransaction.create({
        data: {
          userId: order.userId,
          amount: storeCreditToRestore,
          reason: `Refund store credit for cancelled Order #${order.displayId}`,
          relatedOrderId: order.id,
        },
      });
    }

    // Release coupon usage
    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode, timesUsed: { gt: 0 } },
        data: { timesUsed: { decrement: 1 } },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: `Cancelled by admin. Reason: ${cancellationReason}`,
      },
    });
  });

  // Refund after: if a Razorpay refund is owed, call after commit
  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);
  const owesRazorpayRefund =
    order.paymentMethod === "RAZORPAY" &&
    priorStatus === "PAID" &&
    razorpayAmountToRefund > 0 &&
    order.razorpayPaymentId;

  if (owesRazorpayRefund && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: razorpayAmountToRefund,
        notes: {
          reason: cancellationReason,
          orderId: order.displayId,
        },
      });

      await prisma.order.update({
        where: { id: orderId },
        data: {
          razorpayRefundId: refund.id,
          refundedAt: new Date(),
          refundAmount: razorpayAmountToRefund,
        },
      });

      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          status: "CANCELLED",
          note: `Razorpay refund processed: ${refund.id} (₹${(razorpayAmountToRefund / 100).toFixed(2)})`,
        },
      });
    } catch (err: any) {
      console.error("Razorpay refund error during admin cancellation:", err);
      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          status: "CANCELLED",
          note: `REFUND FAILED – manual action required: ${err?.message || err}`,
        },
      });
    }
  }

  sendCancellationEmail(orderId).catch((err) => {
    console.error("Failed to send cancellation email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}
