"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail } from "@/lib/email";

export async function bulkMarkShipped(
  shipments: {
    orderId: string;
    courierName: string;
    awbNumber: string;
    trackingUrl?: string;
  }[]
) {
  await requireStaff();

  if (!shipments.length) {
    throw new Error("No orders selected for bulk shipment.");
  }

  const orderIds = shipments.map((s) => s.orderId);
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, displayId: true, paymentStatus: true, fulfilmentStatus: true, paymentMethod: true },
  });

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const skipped: Array<{ orderId: string; reason: string }> = [];
  let successCount = 0;
  const shippedAt = new Date();

  for (const item of shipments) {
    const order = orderMap.get(item.orderId);
    if (!order) {
      skipped.push({ orderId: item.orderId, reason: "Order not found" });
      continue;
    }

    if (!item.courierName?.trim() || !item.awbNumber?.trim()) {
      skipped.push({ orderId: item.orderId, reason: "Missing courier name or AWB" });
      continue;
    }

    const isCod = order.paymentMethod === "COD";
    const canShip =
      order.fulfilmentStatus === "PLACED" &&
      (isCod ? order.paymentStatus === "COD_PENDING" : order.paymentStatus === "PAID");

    if (!canShip) {
      skipped.push({
        orderId: item.orderId,
        reason: `Illegal status for ${order.paymentMethod} order (fulfilment: ${order.fulfilmentStatus}, payment: ${order.paymentStatus})`,
      });
      continue;
    }

    const courierName = item.courierName.trim();
    const awbNumber = item.awbNumber.trim();
    const trackingUrl = item.trackingUrl?.trim() || null;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const updateRes = await tx.order.updateMany({
          where: {
            id: order.id,
            fulfilmentStatus: "PLACED",
            ...(isCod ? { paymentStatus: "COD_PENDING" } : { paymentStatus: "PAID" }),
          },
          data: {
            fulfilmentStatus: "SHIPPED",
            shippedAt,
            courierName,
            awbNumber,
            trackingUrl,
          },
        });

        if (updateRes.count === 0) {
          return false;
        }

        await tx.orderStatusEvent.create({
          data: {
            orderId: order.id,
            fulfilmentStatus: "SHIPPED",
            paymentStatus: order.paymentStatus,
            note: `Bulk dispatched via ${courierName} (AWB: ${awbNumber})`,
            createdAt: shippedAt,
          },
        });

        return true;
      });

      if (!updated) {
        skipped.push({ orderId: item.orderId, reason: "Order already changed" });
        continue;
      }

      successCount++;
      sendShipmentNotificationEmail(order.id).catch((err) => {
        console.error(`Failed to send bulk shipment email for ${order.id}:`, err);
      });
    } catch (err) {
      console.error(`Bulk fulfill error for ${item.orderId}:`, err);
      skipped.push({ orderId: item.orderId, reason: "Failed to fulfill" });
    }
  }

  revalidatePath("/admin/orders");
  return { count: successCount, skipped };
}
