"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { revalidatePath } from "next/cache";
import { sendCancellationEmail } from "@/lib/email";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

export async function cancelOrderAsCustomer(orderId: string, reason: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to cancel your order.");
  }

  const userId = session.user.id;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");
  if (order.userId !== userId) throw new Error("Unauthorized: Order does not belong to you.");

  if (order.status === "SHIPPED" || order.status === "DELIVERED") {
    throw new Error("Shipped or delivered orders cannot be cancelled directly. Please request a return instead.");
  }

  if (order.status === "CANCELLED" || order.status === "FAILED") {
    throw new Error(`Order is already ${order.status.toLowerCase()}.`);
  }

  let razorpayRefundId: string | undefined = undefined;
  let refundedAt: Date | undefined = undefined;
  let refundAmount: number | undefined = undefined;

  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);

  // Process Razorpay refund if remaining balance was paid via Razorpay
  if (order.paymentMethod !== "COD" && order.status === "PAID" && razorpayAmountToRefund > 0 && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: razorpayAmountToRefund,
        notes: {
          reason: reason || "Customer cancellation",
          orderId: order.displayId,
        },
      });
      razorpayRefundId = refund.id;
      refundedAt = new Date();
      refundAmount = razorpayAmountToRefund;
    } catch (err) {
      console.error("Razorpay refund error during customer cancellation:", err);
      throw new Error(`Failed to process payment refund via Razorpay: ${err instanceof Error ? err.message : "Refund API error"}`);
    }
  }

  const cancellationReason = reason?.trim() || "Cancelled by customer";
  const now = new Date();

  // Transaction: update order, restore stock, restore store credit, log event
  await prisma.$transaction(async (tx) => {
    if (storeCreditToRestore > 0 && order.userId) {
      await tx.user.update({
        where: { id: order.userId },
        data: { storeCreditBalance: { increment: storeCreditToRestore } },
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

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancellationReason,
        ...(razorpayRefundId ? { razorpayRefundId, refundedAt, refundAmount } : {}),
      },
    });

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: `Cancelled by customer. Reason: ${cancellationReason}${razorpayRefundId ? ` (Refund ID: ${razorpayRefundId})` : ""}`,
        createdAt: now,
      },
    });
  });

  // Async email notification
  sendCancellationEmail(orderId).catch((err) => {
    console.error("Failed to send cancellation email:", err);
  });

  revalidatePath("/account");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function cancelOrderAsAdmin(orderId: string, reason: string) {
  await requireStaffOrOwner();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");

  if (order.status === "CANCELLED" || order.status === "FAILED") {
    throw new Error(`Order is already ${order.status.toLowerCase()}.`);
  }

  let razorpayRefundId: string | undefined = undefined;
  let refundedAt: Date | undefined = undefined;
  let refundAmount: number | undefined = undefined;

  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);

  // Process Razorpay refund if remaining balance was paid via Razorpay
  if (order.paymentMethod !== "COD" && order.status === "PAID" && razorpayAmountToRefund > 0 && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: razorpayAmountToRefund,
        notes: {
          reason: reason || "Admin cancellation & refund",
          orderId: order.displayId,
        },
      });
      razorpayRefundId = refund.id;
      refundedAt = new Date();
      refundAmount = razorpayAmountToRefund;
    } catch (err) {
      console.error("Razorpay refund error during admin cancellation:", err);
      throw new Error(`Failed to process payment refund via Razorpay: ${err instanceof Error ? err.message : "Refund API error"}`);
    }
  }

  const cancellationReason = reason?.trim() || "Cancelled by admin";
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (storeCreditToRestore > 0 && order.userId) {
      await tx.user.update({
        where: { id: order.userId },
        data: { storeCreditBalance: { increment: storeCreditToRestore } },
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

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancellationReason,
        ...(razorpayRefundId ? { razorpayRefundId, refundedAt, refundAmount } : {}),
      },
    });

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: `Cancelled by admin. Reason: ${cancellationReason}${razorpayRefundId ? ` (Refund ID: ${razorpayRefundId})` : ""}`,
        createdAt: now,
      },
    });
  });

  sendCancellationEmail(orderId).catch((err) => {
    console.error("Failed to send cancellation email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}
