"use server";

import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { releaseStock } from "@/lib/stock";
import { canTransition } from "@/lib/orders/transitions";
import { legacyStage } from "@/lib/orders/status-label";
import { revalidatePath } from "next/cache";
import { releaseOfferUsage } from "@/lib/offers/release";
import { createCreditNoteForRefund } from "@/lib/gst/credit-note";
import { issueRefund } from "@/lib/refunds/issue-refund";
import { restoreWalletDebit } from "@/lib/wallet/service";
import { safeErrorSummary } from "@/lib/log-redact";

export async function markCodRefused(orderId: string, note?: string) {
  await requireStaff();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.paymentMethod !== "COD") {
    throw new Error("Only COD orders can be marked as Refused / RTO");
  }

  if (!canTransition("COD", order.fulfilmentStatus, "CANCELLED") || order.fulfilmentStatus === "DELIVERED") {
    throw new Error(`Order cannot be marked refused from status ${legacyStage(order)}`);
  }

  const refusalNote = `[COD REFUSED / RTO] ${note?.trim() || "Delivery refused by customer at doorstep / Return to Origin"}`;
  const priorFulfilmentStatus = order.fulfilmentStatus;

  await prisma.$transaction(async (tx) => {
    // 1. Update order status to CANCELLED atomically
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, fulfilmentStatus: priorFulfilmentStatus },
      data: {
        fulfilmentStatus: "CANCELLED",
        cancellationReason: refusalNote,
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    // 2. Release stock ONLY if stock was deducted
    if (order.stockDeducted && order.items && order.items.length > 0) {
      await releaseStock(tx, order.items, "RTO", {
        refType: "Order",
        refId: order.id,
      });
      await tx.order.update({
        where: { id: order.id },
        data: { stockDeducted: false },
      });
    }

    // 3. Restore any storeCreditApplied
    if (order.storeCreditApplied > 0 && order.userId) {
      await restoreWalletDebit(tx, {
        userId: order.userId,
        orderId: order.id,
        amountPaise: order.storeCreditApplied,
        reason: `Restored store credit for refused COD Order #${order.displayId}`,
        idempotencyKey: `cod-refusal-restore:${order.id}`,
      });
    }

    // 4. Release offer usage and redemptions
    await releaseOfferUsage(tx, order.id);

    // 5. Log status event
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "CANCELLED",
        paymentStatus: order.paymentStatus,
        note: refusalNote,
      },
    });
  });

  if (order.storeCreditApplied > 0) {
    try {
      await issueRefund({
        orderId: order.id,
        method: "STORE_CREDIT",
        amountPaise: order.storeCreditApplied,
        idempotencyKey: `cod-refusal-sc-${order.id}`,
        recordOnly: true,
        reason: refusalNote,
      });
    } catch (refErr) {
      console.error("Failed to record refund ledger for COD refusal:", safeErrorSummary(refErr));
    }
  }

  // Issue Credit Note in its own transaction after COD refusal transaction commits
  try {
    await prisma.$transaction(async (cnTx) => {
      await createCreditNoteForRefund(cnTx, {
        orderId: order.id,
        reason: refusalNote,
        refundRef: `cod-refusal-${order.id}`,
        refundedItems: order.items.map((i) => ({ orderItemId: i.id, qty: i.qty })),
        includeFeeShare: true,
        refundShippingFee: true,
        refundCodFee: true,
      });
    });
  } catch (cnErr) {
    console.error(`Failed to create credit note for COD refusal on order ${order.id}:`, safeErrorSummary(cnErr));
    await prisma.orderStatusEvent.create({
      data: {
        orderId,
        note: `CREDIT NOTE PENDING (refundRef=cod-refusal-${order.id})`,
      },
    });
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}
