"use server";

import { requireStaff, requireUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { releaseStock } from "@/lib/stock";
import { canTransition } from "@/lib/orders/transitions";
import { legacyStage } from "@/lib/orders/status-label";
import { revalidatePath } from "next/cache";
import { sendCancellationEmail } from "@/lib/email";
import { releaseOfferUsage } from "@/lib/offers/release";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import { issueRefund } from "@/lib/refunds/issue-refund";

export async function cancelOrderAsCustomer(orderId: string, reason: string) {
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) throw new Error("Order not found");
  if (order.userId !== user.id) throw new Error("Unauthorized: Order does not belong to you.");

  // Check legal transition
  if (!canTransition(order.paymentMethod, order.fulfilmentStatus, "CANCELLED") || order.fulfilmentStatus === "DELIVERED") {
    throw new Error(`Order cannot be cancelled from status ${legacyStage(order)}`);
  }

  const cancellationReason = reason?.trim() || "Cancelled by customer";
  const priorFulfilmentStatus = order.fulfilmentStatus;

  // Claim first: atomic conditional update inside transaction
  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfilmentStatus: priorFulfilmentStatus,
      },
      data: {
        fulfilmentStatus: "CANCELLED",
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

    // Release offer usage and redemptions
    await releaseOfferUsage(tx, order.id);

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "CANCELLED",
        paymentStatus: order.paymentStatus,
        note: `Cancelled by customer. Reason: ${cancellationReason}`,
      },
    });
  });

  // Refund after: if a Razorpay refund is owed, call after commit
  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);
  const owesRazorpayRefund =
    order.paymentMethod === "RAZORPAY" &&
    order.paymentStatus === "PAID" &&
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

      const nextPaymentStatus = razorpayAmountToRefund >= order.total ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await prisma.order.update({
        where: { id: orderId },
        data: {
          razorpayRefundId: refund.id,
          refundedAt: new Date(),
          refundAmount: razorpayAmountToRefund,
          paymentStatus: nextPaymentStatus,
        },
      });

      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          paymentStatus: nextPaymentStatus,
          note: `Razorpay refund processed: ${refund.id} (₹${(razorpayAmountToRefund / 100).toFixed(2)})`,
        },
      });

      await issueRefund({
        orderId,
        method: "RAZORPAY",
        amountPaise: razorpayAmountToRefund,
        idempotencyKey: `cancel-customer-razorpay-${orderId}`,
        recordOnly: true,
        providerRefundId: refund.id,
        reason: cancellationReason,
      });
    } catch (err: any) {
      console.error("Razorpay refund error during customer cancellation:", err);
      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          paymentStatus: order.paymentStatus,
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

  if (!canTransition(order.paymentMethod, order.fulfilmentStatus, "CANCELLED") || order.fulfilmentStatus === "DELIVERED") {
    throw new Error(`Order cannot be cancelled from status ${legacyStage(order)}`);
  }

  const cancellationReason = reason?.trim() || "Cancelled by admin";
  const priorFulfilmentStatus = order.fulfilmentStatus;

  // Claim first: atomic conditional update inside transaction
  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
        fulfilmentStatus: priorFulfilmentStatus,
      },
      data: {
        fulfilmentStatus: "CANCELLED",
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

    // Release offer usage and redemptions
    await releaseOfferUsage(tx, order.id);

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "CANCELLED",
        paymentStatus: order.paymentStatus,
        note: `Cancelled by admin. Reason: ${cancellationReason}`,
      },
    });
  });

  // Refund after: if a Razorpay refund is owed, call after commit
  const storeCreditToRestore = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = Math.max(0, order.total - storeCreditToRestore);
  const owesRazorpayRefund =
    order.paymentMethod === "RAZORPAY" &&
    order.paymentStatus === "PAID" &&
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

      const nextPaymentStatus = razorpayAmountToRefund >= order.total ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await prisma.order.update({
        where: { id: orderId },
        data: {
          razorpayRefundId: refund.id,
          refundedAt: new Date(),
          refundAmount: razorpayAmountToRefund,
          paymentStatus: nextPaymentStatus,
        },
      });

      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          paymentStatus: nextPaymentStatus,
          note: `Razorpay refund processed: ${refund.id} (₹${(razorpayAmountToRefund / 100).toFixed(2)})`,
        },
      });

      await issueRefund({
        orderId,
        method: "RAZORPAY",
        amountPaise: razorpayAmountToRefund,
        idempotencyKey: `cancel-admin-razorpay-${orderId}`,
        recordOnly: true,
        providerRefundId: refund.id,
        reason: cancellationReason,
      });
    } catch (err: any) {
      console.error("Razorpay refund error during admin cancellation:", err);
      await prisma.orderStatusEvent.create({
        data: {
          orderId,
          fulfilmentStatus: "CANCELLED",
          paymentStatus: order.paymentStatus,
          note: `REFUND FAILED – manual action required: ${err?.message || err}`,
        },
      });
    }
  }

  // Issue Credit Note in its own transaction after cancellation/refund transaction commits
  try {
    await prisma.$transaction(async (cnTx) => {
      await createCreditNoteForRefund(cnTx, {
        orderId: order.id,
        reason: `Cancelled by admin: ${cancellationReason}`,
        refundRef: `cancel-admin-${order.id}`,
        refundedItems: order.items.map((i) => ({ orderItemId: i.id, qty: i.qty })),
        includeFeeShare: true,
        refundShippingFee: true,
        refundCodFee: true,
      });
    });
  } catch (cnErr) {
    console.error(`Failed to create credit note on admin cancel for order ${order.id}:`, cnErr);
    await prisma.orderStatusEvent.create({
      data: {
        orderId,
        note: `CREDIT NOTE PENDING (refundRef=cancel-admin-${order.id})`,
      },
    });
  }

  sendCancellationEmail(orderId).catch((err) => {
    console.error("Failed to send cancellation email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}
