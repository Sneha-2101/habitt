"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { getSettings } from "@/lib/settings";
import { revalidatePath } from "next/cache";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

export async function requestReturn(orderId: string, reason: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to request a return.");
  }

  const userId = session.user.id;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { returnRequests: true },
  });

  if (!order) throw new Error("Order not found");
  if (order.userId !== userId) throw new Error("Unauthorized: Order does not belong to you.");

  if (order.status !== "DELIVERED") {
    throw new Error("Returns can only be requested for delivered orders.");
  }

  const settings = await getSettings();
  const returnWindowDays = settings.returnWindowDays || 7;
  if (order.deliveredAt) {
    const elapsedMs = Date.now() - new Date(order.deliveredAt).getTime();
    const allowedMs = returnWindowDays * 24 * 60 * 60 * 1000;
    if (elapsedMs > allowedMs) {
      throw new Error(`The ${returnWindowDays}-day return window for this order has closed.`);
    }
  }

  const existingRequest = order.returnRequests.find(
    (r) => r.status === "REQUESTED" || r.status === "APPROVED" || r.status === "REFUNDED"
  );
  if (existingRequest) {
    throw new Error(`A return request is already ${existingRequest.status.toLowerCase()} for this order.`);
  }

  const returnReason = reason?.trim() || "Defective or unsatisfactory item";

  const returnReq = await prisma.returnRequest.create({
    data: {
      orderId,
      userId,
      reason: returnReason,
      status: "REQUESTED",
    },
  });

  await prisma.orderStatusEvent.create({
    data: {
      orderId,
      status: "DELIVERED",
      note: `Return request submitted by customer. Reason: ${returnReason}`,
    },
  });

  revalidatePath("/account");
  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${orderId}`);

  return returnReq;
}

export async function approveReturn(returnId: string, adminNote?: string) {
  await requireStaffOrOwner();

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: { order: { include: { items: true, user: true } } },
  });

  if (!returnReq) throw new Error("Return request not found");
  const order = returnReq.order;

  let razorpayRefundId: string | undefined = undefined;
  let refundedAt: Date | undefined = undefined;
  let refundAmount: number | undefined = undefined;

  const storeCreditRefund = order.storeCreditApplied || 0;
  const isCod = order.paymentMethod === "COD";
  const razorpayAmountToRefund = isCod ? 0 : Math.max(0, order.total - storeCreditRefund);

  // Process Razorpay refund if order had online balance paid via Razorpay
  if (razorpayAmountToRefund > 0 && order.razorpayPaymentId) {
    try {
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        amount: razorpayAmountToRefund,
        notes: {
          reason: `Approved return: ${returnReq.reason}`,
          returnId: returnReq.id,
          orderId: order.displayId,
        },
      });
      razorpayRefundId = refund.id;
      refundedAt = new Date();
      refundAmount = razorpayAmountToRefund;
    } catch (err) {
      console.error("Razorpay refund error during return approval:", err);
      throw new Error(`Failed to process payment refund via Razorpay: ${err instanceof Error ? err.message : "Refund API error"}`);
    }
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Issue store credit for COD return OR restore store credit applied
    if (order.userId) {
      if (isCod) {
        await tx.user.update({
          where: { id: order.userId },
          data: { storeCreditBalance: { increment: order.total } },
        });

        await tx.storeCreditTransaction.create({
          data: {
            userId: order.userId,
            amount: order.total,
            reason: `Refund voucher for returned COD Order #${order.displayId}`,
            relatedOrderId: order.id,
          },
        });
      } else if (storeCreditRefund > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { storeCreditBalance: { increment: storeCreditRefund } },
        });

        await tx.storeCreditTransaction.create({
          data: {
            userId: order.userId,
            amount: storeCreditRefund,
            reason: `Restored store credit for returned Order #${order.displayId}`,
            relatedOrderId: order.id,
          },
        });
      }
    }

    await tx.returnRequest.update({
      where: { id: returnId },
      data: {
        status: "REFUNDED",
        adminNote: adminNote?.trim() || "Approved and refunded by store admin",
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancellationReason: `Return approved: ${returnReq.reason}`,
        ...(razorpayRefundId ? { razorpayRefundId, refundedAt, refundAmount } : {}),
      },
    });

    // Restore item stock
    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: "CANCELLED",
        note: `Return approved & refunded by admin. Note: ${adminNote?.trim() || "Approved"}${isCod ? " (Issued Store Credit)" : ""}${razorpayRefundId ? ` (Refund ID: ${razorpayRefundId})` : ""}`,
        createdAt: now,
      },
    });
  });

  const { sendStoreCreditIssuedEmail } = await import("@/lib/email");
  if (isCod && order.userId && (order.user?.email || order.customerEmail)) {
    const emailToUse = order.user?.email || order.customerEmail;
    if (emailToUse) {
      sendStoreCreditIssuedEmail(
        emailToUse,
        order.user?.name || order.customerName,
        order.total,
        `Refund voucher for returned COD Order #${order.displayId}`
      ).catch(console.error);
    }
  }

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath("/account");
}

export async function rejectReturn(returnId: string, adminNote: string) {
  await requireStaffOrOwner();

  if (!adminNote?.trim()) {
    throw new Error("Please provide a reason for rejecting the return request.");
  }

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
  });

  if (!returnReq) throw new Error("Return request not found");

  await prisma.returnRequest.update({
    where: { id: returnId },
    data: {
      status: "REJECTED",
      adminNote: adminNote.trim(),
    },
  });

  await prisma.orderStatusEvent.create({
    data: {
      orderId: returnReq.orderId,
      status: "DELIVERED",
      note: `Return request rejected by admin. Reason: ${adminNote.trim()}`,
    },
  });

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${returnReq.orderId}`);
  revalidatePath("/account");
}
