"use server";

import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { releaseStock } from "@/lib/stock";
import { canTransition } from "@/lib/orders/transitions";
import { revalidatePath } from "next/cache";

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

  if (!canTransition("COD", order.status, "CANCELLED") || order.status === "DELIVERED") {
    throw new Error(`Order cannot be marked refused from status ${order.status}`);
  }

  const refusalNote = `[COD REFUSED / RTO] ${note?.trim() || "Delivery refused by customer at doorstep / Return to Origin"}`;
  const priorStatus = order.status;

  await prisma.$transaction(async (tx) => {
    // 1. Update order status to CANCELLED atomically
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, status: priorStatus },
      data: {
        status: "CANCELLED",
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
      await tx.user.update({
        where: { id: order.userId },
        data: { storeCreditBalance: { increment: order.storeCreditApplied } },
      });

      await tx.storeCreditTransaction.create({
        data: {
          userId: order.userId,
          amount: order.storeCreditApplied,
          reason: `Restored store credit for refused COD Order #${order.displayId}`,
          relatedOrderId: order.id,
        },
      });
    }

    // 4. Release coupon usage
    if (order.couponCode) {
      await tx.coupon.updateMany({
        where: { code: order.couponCode, timesUsed: { gt: 0 } },
        data: { timesUsed: { decrement: 1 } },
      });
    }

    // 5. Log status event
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "CANCELLED",
        note: refusalNote,
      },
    });
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}
