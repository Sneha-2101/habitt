import { Prisma, Order } from "@prisma/client";
import { releaseStock } from "@/lib/stock";

export type OrderWithItems = Order & {
  items: Array<{ variantId: string; qty: number }>;
};

export async function failOrder(
  tx: Prisma.TransactionClient,
  order: OrderWithItems,
  note?: string
): Promise<{ updated: boolean }> {
  // 1. Atomic conditional update PENDING -> FAILED
  const result = await tx.order.updateMany({
    where: { id: order.id, status: "PENDING" },
    data: { status: "FAILED" },
  });

  if (result.count === 0) {
    return { updated: false };
  }

  // 2. Restore storeCreditApplied if any
  if (order.storeCreditApplied > 0) {
    await tx.user.update({
      where: { id: order.userId },
      data: { storeCreditBalance: { increment: order.storeCreditApplied } },
    });
    await tx.storeCreditTransaction.create({
      data: {
        userId: order.userId,
        amount: order.storeCreditApplied,
        reason: `Store credit refunded from failed order ${order.displayId}`,
        relatedOrderId: order.id,
      },
    });
  }

  // 3. Release coupon usage
  if (order.couponCode) {
    await tx.coupon.updateMany({
      where: { code: order.couponCode, timesUsed: { gt: 0 } },
      data: { timesUsed: { decrement: 1 } },
    });
  }

  // 4. Release stock only if stock was deducted
  if (order.stockDeducted && order.items && order.items.length > 0) {
    await releaseStock(tx, order.items, "CANCEL", {
      refType: "Order",
      refId: order.id,
    });
    await tx.order.update({
      where: { id: order.id },
      data: { stockDeducted: false },
    });
  }

  // 5. Write OrderStatusEvent
  await tx.orderStatusEvent.create({
    data: {
      orderId: order.id,
      status: "FAILED",
      note: note || "Order marked as failed",
    },
  });

  return { updated: true };
}
