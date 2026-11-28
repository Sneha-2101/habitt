"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail } from "@/lib/email";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { computeShipmentEventDedupeKey } from "@/lib/shipping/transitions";
import { safeErrorSummary } from "@/lib/log-redact";

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
  const skipped: Array<{ row: number; orderId: string; reason: string }> = [];
  let successCount = 0;
  const shippedAt = new Date();

  for (let i = 0; i < shipments.length; i++) {
    const item = shipments[i];
    const rowNum = i + 1;
    const order = orderMap.get(item.orderId);
    if (!order) {
      skipped.push({ row: rowNum, orderId: item.orderId, reason: "Order not found" });
      continue;
    }

    if (!item.courierName?.trim() || !item.awbNumber?.trim()) {
      skipped.push({ row: rowNum, orderId: item.orderId, reason: "Missing courier name or AWB" });
      continue;
    }

    const isCod = order.paymentMethod === "COD";
    const canShip =
      order.fulfilmentStatus === "PLACED" &&
      (isCod ? order.paymentStatus === "COD_PENDING" : order.paymentStatus === "PAID");

    if (!canShip) {
      skipped.push({
        row: rowNum,
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

        // Create or update MANUAL Shipment row
        const existingShipment = await tx.shipment.findFirst({
          where: { orderId: order.id, status: { notIn: ["CANCELLED", "FAILED"] } },
        });

        let shipmentId: string;
        if (existingShipment) {
          shipmentId = existingShipment.id;
          await tx.shipment.update({
            where: { id: existingShipment.id },
            data: {
              awb: awbNumber,
              courierName,
              trackingUrl,
              status: "IN_TRANSIT",
            },
          });
        } else {
          const createdShpm = await tx.shipment.create({
            data: {
              orderId: order.id,
              provider: "MANUAL",
              status: "IN_TRANSIT",
              awb: awbNumber,
              courierName,
              trackingUrl,
            },
          });
          shipmentId = createdShpm.id;
        }

        const dedupeKey = computeShipmentEventDedupeKey(
          awbNumber,
          "BULK_DISPATCH",
          shippedAt
        );
        await tx.shipmentEvent.upsert({
          where: { dedupeKey },
          create: {
            shipmentId,
            status: "IN_TRANSIT",
            rawStatus: "BULK_DISPATCH",
            source: "MANUAL",
            occurredAt: shippedAt,
            dedupeKey,
          },
          update: {},
        });

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
        skipped.push({ row: rowNum, orderId: item.orderId, reason: "Order already changed" });
        continue;
      }

      // Issue invoice in its own transaction after shipping transaction commits
      try {
        await prisma.$transaction(async (invTx) => {
          await issueInvoiceForOrder(invTx, order.id);
        });
      } catch (invErr) {
        console.error(`Failed to issue invoice for bulk order ${order.id}:`, safeErrorSummary(invErr));
        await prisma.orderStatusEvent.create({
          data: {
            orderId: order.id,
            note: "INVOICE PENDING: retry from admin",
          },
        });
      }

      successCount++;
      sendShipmentNotificationEmail(order.id).catch((err) => {
        console.error(`Failed to send bulk shipment email for ${order.id}:`, safeErrorSummary(err));
      });
    } catch (err) {
      console.error(`Bulk fulfill error for ${item.orderId}:`, safeErrorSummary(err));
      skipped.push({ row: rowNum, orderId: item.orderId, reason: "Failed to fulfill" });
    }
  }

  revalidatePath("/admin/orders");
  return { count: successCount, skipped };
}
