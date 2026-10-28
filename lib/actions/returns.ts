"use server";

import { requireStaff, requireUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { getSettings } from "@/lib/settings";
import { releaseStock } from "@/lib/stock";
import { revalidatePath } from "next/cache";

export async function requestReturn(orderId: string, reason: string) {
  const user = await requireUser();
  const userId = user.id;
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
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    if (elapsedDays > returnWindowDays) {
      throw new Error(`The return window for this order has expired (${returnWindowDays} days).`);
    }
  }

  const existingPending = order.returnRequests.find(
    (r) => r.status === "REQUESTED" || r.status === "APPROVED"
  );
  if (existingPending) {
    throw new Error("A return request has already been submitted for this order.");
  }

  if (!reason?.trim()) {
    throw new Error("Please select or describe the reason for your return.");
  }

  const returnReq = await prisma.returnRequest.create({
    data: {
      orderId,
      userId,
      reason: reason.trim(),
      status: "REQUESTED",
    },
  });

  await prisma.orderStatusEvent.create({
    data: {
      orderId,
      status: "DELIVERED",
      note: `Customer requested return / refund. Reason: ${reason.trim()}`,
    },
  });

  revalidatePath("/account");
  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${orderId}`);

  return returnReq;
}

export async function approveReturn(returnId: string, adminNote?: string) {
  await requireStaff();

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: { order: { include: { items: true, user: true } } },
  });

  if (!returnReq) throw new Error("Return request not found");
  const order = returnReq.order;
  const isCod = order.paymentMethod === "COD";
  const storeCreditRefund = order.storeCreditApplied || 0;
  const razorpayAmountToRefund = isCod ? 0 : Math.max(0, order.total - storeCreditRefund);

  // Claim first: atomically update ReturnRequest inside transaction
  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REQUESTED" },
      data: {
        status: "REFUNDED",
        adminNote: adminNote?.trim() || "Approved and refunded by store admin",
      },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    // Atomic order status update DELIVERED -> CANCELLED
    const orderUpdateRes = await tx.order.updateMany({
      where: { id: order.id, status: "DELIVERED" },
      data: {
        status: "CANCELLED",
        cancellationReason: `Return approved: ${returnReq.reason}`,
      },
    });

    if (orderUpdateRes.count === 0) {
      throw new Error("Order already changed");
    }

    // Release stock ONLY if stockDeducted
    if (order.stockDeducted && order.items && order.items.length > 0) {
      await releaseStock(tx, order.items, "RETURN", {
        refType: "ReturnRequest",
        refId: returnReq.id,
      });
      await tx.order.update({
        where: { id: order.id },
        data: { stockDeducted: false },
      });
    }

    // Issue COD store credit exactly once OR restore store credit applied
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

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: "CANCELLED",
        note: `Return approved & refunded by admin. Note: ${adminNote?.trim() || "Approved"}${isCod ? " (Issued Store Credit)" : ""}`,
      },
    });
  });

  // Refund after: process Razorpay refund after transaction commit
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

      await prisma.order.update({
        where: { id: order.id },
        data: {
          razorpayRefundId: refund.id,
          refundedAt: new Date(),
          refundAmount: razorpayAmountToRefund,
        },
      });

      await prisma.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "CANCELLED",
          note: `Razorpay refund processed: ${refund.id}`,
        },
      });
    } catch (err: any) {
      console.error("Razorpay refund error during return approval:", err);
      await prisma.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "CANCELLED",
          note: `REFUND FAILED – manual action required: ${err?.message || err}`,
        },
      });
    }
  }

  // Send store credit email if COD
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
  await requireStaff();

  if (!adminNote?.trim()) {
    throw new Error("Please provide a reason for rejecting the return request.");
  }

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
  });

  if (!returnReq) throw new Error("Return request not found");

  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REQUESTED" },
      data: {
        status: "REJECTED",
        adminNote: adminNote.trim(),
      },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: returnReq.orderId,
        status: "DELIVERED",
        note: `Return request rejected by admin. Reason: ${adminNote.trim()}`,
      },
    });
  });

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${returnReq.orderId}`);
  revalidatePath("/account");
}
