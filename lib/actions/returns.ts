"use server";

import { requireStaff, requireUser } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { releaseStock } from "@/lib/stock";
import { revalidatePath } from "next/cache";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import { isReturnWindowOpen } from "@/lib/returns/rules";
import { canTransition } from "@/lib/returns/transitions";
import { computeRefund } from "@/lib/returns/rules";
import { issueRefund } from "@/lib/refunds/issue-refund";
import { limit } from "@/lib/ratelimit";
import {
  sendReturnRequestedEmail,
  sendReturnApprovedEmail,
  sendReturnRejectedEmail,
  sendReturnReceivedEmail,
  sendReturnRefundedEmail,
} from "@/lib/email";
import { z } from "zod";
import type { ReturnReasonCode } from "@prisma/client";

const returnItemsSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1, "Item ID is required"),
        qty: z.number().int().positive("Quantity must be greater than 0"),
      })
    )
    .min(1, "At least one item must be returned"),
  reasonCode: z.enum([
    "WRONG_SIZE",
    "DEFECTIVE",
    "NOT_AS_DESCRIBED",
    "CHANGED_MIND",
    "OTHER",
  ]),
  note: z.string().optional(),
});

export type RequestReturnInput = z.infer<typeof returnItemsSchema>;

/**
 * Customer action to request a return for specific items and quantities.
 * Supports backward-compatible call: requestReturn(orderId, legacyReason)
 */
export async function requestReturn(
  inputOrOrderId: string | RequestReturnInput,
  legacyReason?: string
) {
  const user = await requireUser();
  const userId = user.id;

  // Rate limit
  const rl = await limit("returnRequest", userId);
  if (!rl.ok) {
    throw new Error(
      `Too many return requests. Please try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`
    );
  }

  // Parse input
  let parsed: RequestReturnInput;
  if (typeof inputOrOrderId === "string") {
    const orderId = inputOrOrderId;
    const reasonText = legacyReason?.trim() || "OTHER";
    // Check if order exists to pull items for legacy call
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existingOrder) throw new Error("Order not found");

    parsed = {
      orderId,
      items: existingOrder.items
        .filter((i) => !i.isGift)
        .map((i) => ({ orderItemId: i.id, qty: i.qty })),
      reasonCode: "OTHER",
      note: reasonText,
    };
  } else {
    const valResult = returnItemsSchema.safeParse(inputOrOrderId);
    if (!valResult.success) {
      throw new Error(valResult.error.issues[0]?.message || "Invalid return request input");
    }
    parsed = valResult.data;
  }

  const { orderId, items, reasonCode, note } = parsed;

  const returnReq = await prisma.$transaction(async (tx) => {
    // Row lock on Order
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        returnRequests: {
          where: { status: { notIn: ["REJECTED", "CANCELLED"] } },
          include: { items: true },
        },
      },
    });

    if (!order) throw new Error("Order not found");
    if (order.userId !== userId) throw new Error("Unauthorized: Order does not belong to you.");

    if (order.fulfilmentStatus !== "DELIVERED") {
      throw new Error("Returns can only be requested for delivered orders.");
    }

    const settings = await getSettings();
    const returnWindowDays = settings.returnWindowDays || 7;
    if (!isReturnWindowOpen(order.deliveredAt, new Date(), returnWindowDays)) {
      throw new Error(`The return window for this order has expired (${returnWindowDays} days).`);
    }

    // Cumulative returned qty map
    const existingReturnedByItem = new Map<string, number>();
    for (const req of order.returnRequests) {
      for (const it of req.items) {
        existingReturnedByItem.set(
          it.orderItemId,
          (existingReturnedByItem.get(it.orderItemId) || 0) + it.qty
        );
      }
    }

    // Validate each requested item
    const orderItemMap = new Map(order.items.map((i) => [i.id, i]));
    for (const reqItem of items) {
      const orderItem = orderItemMap.get(reqItem.orderItemId);
      if (!orderItem) {
        throw new Error(`Order item ${reqItem.orderItemId} does not belong to this order.`);
      }
      if (orderItem.isGift) {
        throw new Error(`Free gift items (${orderItem.name}) cannot be returned.`);
      }

      const alreadyReturned = existingReturnedByItem.get(reqItem.orderItemId) || 0;
      if (alreadyReturned + reqItem.qty > orderItem.qty) {
        throw new Error(
          `Requested return quantity (${alreadyReturned + reqItem.qty}) exceeds ordered quantity (${orderItem.qty}) for ${orderItem.name}.`
        );
      }
    }

    // Create ReturnRequest
    const created = await tx.returnRequest.create({
      data: {
        orderId,
        userId,
        reason: note?.trim() || reasonCode,
        reasonCode: reasonCode as ReturnReasonCode,
        customerNote: note?.trim() || null,
        status: "REQUESTED",
        items: {
          create: items.map((i) => ({
            orderItemId: i.orderItemId,
            qty: i.qty,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "DELIVERED",
        paymentStatus: order.paymentStatus,
        note: `Customer requested return for ${items.length} item line(s). Reason: ${reasonCode}${note ? ` (${note.trim()})` : ""
          }`,
      },
    });

    return created;
  });

  // Async customer email
  sendReturnRequestedEmail(returnReq.id).catch((err) => {
    console.error("Failed to send return requested email:", err);
  });

  revalidatePath("/account");
  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${orderId}`);

  return returnReq;
}

/**
 * Customer action to cancel a return request while still in REQUESTED status.
 */
export async function cancelReturn(returnId: string) {
  const user = await requireUser();

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
  });

  if (!returnReq) throw new Error("Return request not found");
  if (returnReq.userId !== user.id) {
    throw new Error("Unauthorized: You do not own this return request");
  }

  if (returnReq.status !== "REQUESTED") {
    throw new Error("Return requests can only be cancelled while in REQUESTED status");
  }

  if (!canTransition(returnReq.status, "CANCELLED")) {
    throw new Error("Illegal transition to CANCELLED");
  }

  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REQUESTED" },
      data: { status: "CANCELLED" },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: returnReq.orderId,
        fulfilmentStatus: "DELIVERED",
        note: `Customer cancelled return request #${returnReq.id}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "RETURN_CANCELLED",
        entity: "ReturnRequest",
        entityId: returnId,
      },
    });
  });

  revalidatePath("/account");
  revalidatePath("/admin/returns");
  revalidatePath(`/admin/orders/${returnReq.orderId}`);

  return { success: true };
}

/**
 * Staff action to approve a return request.
 * Transitions ReturnRequest from REQUESTED to APPROVED.
 * Does NOT refund or restock at approval (stock is restocked when marked RECEIVED).
 */
export async function approveReturn(returnId: string, adminNote?: string) {
  const staff = await requireStaff();

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: { order: true },
  });

  if (!returnReq) throw new Error("Return request not found");

  if (!canTransition(returnReq.status, "APPROVED")) {
    throw new Error("Return request already processed");
  }

  const noteText = adminNote?.trim() || "Approved by store staff";

  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REQUESTED" },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        adminNote: noteText,
      },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: returnReq.orderId,
        fulfilmentStatus: returnReq.order.fulfilmentStatus,
        paymentStatus: returnReq.order.paymentStatus,
        note: `Return request approved by staff. Note: ${noteText}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: staff.id,
        action: "RETURN_APPROVED",
        entity: "ReturnRequest",
        entityId: returnId,
        meta: { adminNote: noteText },
      },
    });
  });

  sendReturnApprovedEmail(returnId).catch((err) => {
    console.error("Failed to send return approved email:", err);
  });

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/returns/${returnId}`);
  revalidatePath(`/admin/orders/${returnReq.orderId}`);
  revalidatePath("/account");

  return { success: true };
}

/**
 * Staff action to reject a return request.
 * Transitions ReturnRequest from REQUESTED to REJECTED.
 * Rejection reason is required.
 */
export async function rejectReturn(returnId: string, adminNote: string) {
  const staff = await requireStaff();

  if (!adminNote?.trim()) {
    throw new Error("Please provide a reason for rejecting the return request.");
  }

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: { order: true },
  });

  if (!returnReq) throw new Error("Return request not found");

  if (!canTransition(returnReq.status, "REJECTED")) {
    throw new Error("Return request already processed");
  }

  const reasonText = adminNote.trim();

  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "REQUESTED" },
      data: {
        status: "REJECTED",
        rejectedReason: reasonText,
        adminNote: reasonText,
      },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: returnReq.orderId,
        fulfilmentStatus: returnReq.order.fulfilmentStatus,
        paymentStatus: returnReq.order.paymentStatus,
        note: `Return request rejected by staff. Reason: ${reasonText}`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: staff.id,
        action: "RETURN_REJECTED",
        entity: "ReturnRequest",
        entityId: returnId,
        meta: { reason: reasonText },
      },
    });
  });

  sendReturnRejectedEmail(returnId, reasonText).catch((err) => {
    console.error("Failed to send return rejected email:", err);
  });

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/returns/${returnId}`);
  revalidatePath(`/admin/orders/${returnReq.orderId}`);
  revalidatePath("/account");

  return { success: true };
}

/**
 * Staff action to mark returned items as RECEIVED.
 * Restocks stock only for items marked restock = true with condition.
 * Restocks stock exactly once.
 */
export async function receiveReturn(
  returnId: string,
  itemActions: Array<{ returnItemId: string; restock: boolean; condition?: string }>,
  adminNote?: string
) {
  const staff = await requireStaff();

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: {
      items: { include: { orderItem: true } },
      order: true,
    },
  });

  if (!returnReq) throw new Error("Return request not found");

  if (!canTransition(returnReq.status, "RECEIVED")) {
    throw new Error(`Cannot mark received from status ${returnReq.status}`);
  }

  const itemActionMap = new Map(itemActions.map((a) => [a.returnItemId, a]));

  await prisma.$transaction(async (tx) => {
    const claimRes = await tx.returnRequest.updateMany({
      where: { id: returnId, status: "APPROVED" },
      data: {
        status: "RECEIVED",
        receivedAt: new Date(),
        adminNote: adminNote?.trim() || returnReq.adminNote,
      },
    });

    if (claimRes.count === 0) {
      throw new Error("Return request already processed");
    }

    const itemsToRestock: Array<{ variantId: string; qty: number }> = [];

    for (const returnItem of returnReq.items) {
      const action = itemActionMap.get(returnItem.id);
      const shouldRestock = action ? action.restock : true;
      const condition = action?.condition?.trim() || "Good";

      await tx.returnItem.update({
        where: { id: returnItem.id },
        data: {
          restock: shouldRestock,
          condition,
        },
      });

      if (shouldRestock && returnItem.orderItem?.variantId) {
        itemsToRestock.push({
          variantId: returnItem.orderItem.variantId,
          qty: returnItem.qty,
        });
      }
    }

    // Release stock via the stock helper with a StockMovement exactly once
    if (itemsToRestock.length > 0) {
      await releaseStock(tx, itemsToRestock, "RETURN", {
        refType: "ReturnRequest",
        refId: returnReq.id,
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: returnReq.orderId,
        fulfilmentStatus: returnReq.order.fulfilmentStatus,
        paymentStatus: returnReq.order.paymentStatus,
        note: `Returned items received & inspected by staff. ${itemsToRestock.length} item(s) restocked.`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: staff.id,
        action: "RETURN_RECEIVED",
        entity: "ReturnRequest",
        entityId: returnId,
        meta: {
          itemsRestocked: itemsToRestock.length,
          adminNote,
        },
      },
    });
  });

  sendReturnReceivedEmail(returnId).catch((err) => {
    console.error("Failed to send return received email:", err);
  });

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/returns/${returnId}`);
  revalidatePath(`/admin/orders/${returnReq.orderId}`);
  revalidatePath("/account");

  return { success: true };
}

/**
 * Staff action to initiate refund for a received return.
 * Claims return atomically: updateMany where id AND status RECEIVED AND refundInitiatedAt IS NULL.
 * Computes net item refunds + fee share and executes via issueRefund.
 * Creates Credit Note in its own transaction after commit.
 */
export async function refundReturn(
  returnId: string,
  options?: { overrideMethod?: "STORE_CREDIT" }
) {
  const staff = await requireStaff();

  // Atomically claim the return: must be RECEIVED and refundInitiatedAt IS NULL
  const claimRes = await prisma.returnRequest.updateMany({
    where: {
      id: returnId,
      status: "RECEIVED",
      refundInitiatedAt: null,
    },
    data: {
      refundInitiatedAt: new Date(),
    },
  });

  if (claimRes.count === 0) {
    throw new Error("Return request is already being refunded or not in RECEIVED status");
  }

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: {
      items: { include: { orderItem: true } },
      order: {
        include: {
          items: true,
          refunds: true,
          creditNotes: { include: { lines: true } },
          returnRequests: {
            where: { status: { notIn: ["REJECTED", "CANCELLED"] } },
            include: { items: true },
          },
        },
      },
    },
  });

  if (!returnReq) {
    throw new Error("Return request not found");
  }

  const order = returnReq.order;

  // Determine refund method:
  // Prepaid (RAZORPAY) -> Razorpay refund to original method
  // COD -> store credit
  // Staff may override to STORE_CREDIT
  let refundMethod: "RAZORPAY" | "STORE_CREDIT" | "MANUAL" =
    order.paymentMethod === "COD" ? "STORE_CREDIT" : "RAZORPAY";

  if (options?.overrideMethod === "STORE_CREDIT") {
    refundMethod = "STORE_CREDIT";
  }

  // Calculate existing returned qtys across other returns
  const existingReturnedQtys: Record<string, number> = {};
  for (const otherReq of order.returnRequests) {
    if (otherReq.id !== returnId) {
      for (const it of otherReq.items) {
        existingReturnedQtys[it.orderItemId] =
          (existingReturnedQtys[it.orderItemId] || 0) + it.qty;
      }
    }
  }

  const returningQtys: Record<string, number> = {};
  for (const it of returnReq.items) {
    returningQtys[it.orderItemId] = it.qty;
  }

  const cumProcessed = order.refunds
    .filter((r) => r.status === "PROCESSED")
    .reduce((s, r) => s + r.amountPaise, 0);

  // Ledger-based check: derive whether fees were already refunded
  const feesAlreadyRefunded =
    order.feesRefunded ||
    (order.creditNotes || []).some((cn) =>
      cn.lines.some((l) => l.kind === "SHIPPING" || l.kind === "COD")
    );

  const codFeePaise = order.codFee || 0;

  const refundCalc = computeRefund({
    orderItems: order.items,
    returningQtys,
    existingReturnedQtys,
    shippingFeePaise: order.shippingFee,
    codFeePaise,
    feesAlreadyRefunded,
    totalPaidPaise: order.total,
    cumulativeRefundedPaise: cumProcessed,
  });

  const amountPaise = refundCalc.totalRefundPaise;
  if (amountPaise <= 0) {
    // Reset claim before throwing
    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { refundInitiatedAt: null },
    });
    throw new Error("Calculated refund amount is 0");
  }

  // Execute refund via issueRefund
  const idempotencyKey = `return-refund-${returnReq.id}`;
  let refundResult;
  try {
    refundResult = await issueRefund({
      orderId: order.id,
      returnId: returnReq.id,
      method: refundMethod,
      amountPaise,
      idempotencyKey,
      actorId: staff.id,
      reason: `Refund for return #${returnReq.id}`,
    });
  } catch (err) {
    // Reset refundInitiatedAt to null so staff can retry with the same idempotency key
    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { refundInitiatedAt: null },
    });
    throw err;
  }

  if (!refundResult.success || refundResult.refund.status !== "PROCESSED") {
    // Reset refundInitiatedAt to null so staff can retry with the same idempotency key
    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { refundInitiatedAt: null },
    });
    throw new Error(
      `Refund failed: ${refundResult.error || refundResult.refund.failureReason || "Gateway failure"}`
    );
  }

  // Only mark REFUNDED when Refund is PROCESSED
  await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({
      where: { id: returnId },
      data: {
        status: "REFUNDED",
      },
    });

    if (refundCalc.feesRefundPaise > 0) {
      await tx.order.update({
        where: { id: order.id },
        data: { feesRefunded: true },
      });
    }
  });

  // Async customer email ONLY after successful refund
  sendReturnRefundedEmail(returnReq.id, amountPaise, refundMethod).catch((err) => {
    console.error("Failed to send return refunded email:", err);
  });

  // Credit Note in its own transaction after commit
  try {
    await prisma.$transaction(async (cnTx) => {
      await createCreditNoteForRefund(cnTx, {
        orderId: order.id,
        reason: `Return refunded: ${returnReq.reason}`,
        refundRef: refundResult.refund.id,
        refundedItems: returnReq.items.map((i) => ({ orderItemId: i.orderItemId, qty: i.qty })),
        includeFeeShare: refundCalc.isCompleteReturn,
        refundShippingFee: refundCalc.shippingFeeRefundPaise > 0,
        refundCodFee: refundCalc.codFeeRefundPaise > 0,
      });
    });
  } catch (cnErr) {
    console.error(`Failed to create credit note for return ${returnReq.id} on order ${order.id}:`, cnErr);
    await prisma.orderStatusEvent.create({
      data: {
        orderId: order.id,
        note: `CREDIT NOTE PENDING (refundRef=${refundResult.refund.id})`,
      },
    });
  }

  revalidatePath("/admin/returns");
  revalidatePath(`/admin/returns/${returnId}`);
  revalidatePath(`/admin/orders/${order.id}`);
  revalidatePath("/account");

  return { success: true, refund: refundResult.refund };
}
