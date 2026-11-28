import { prisma } from "@/lib/prisma";
import { getShippingProvider } from "@/lib/shipping/shiprocket";
import { mapShiprocketStatus } from "@/lib/shipping/status-map";
import {
  canShipmentTransition,
  computeShipmentEventDedupeKey,
} from "@/lib/shipping/transitions";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { safeErrorSummary } from "@/lib/log-redact";

export async function syncShipmentsBatch(batchSize = 25): Promise<{ itemsProcessed: number }> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  // Poll shipments in transit longer than 6 hours
  const shipments = await prisma.shipment.findMany({
    where: {
      status: {
        in: ["AWB_ASSIGNED", "PICKUP_SCHEDULED", "IN_TRANSIT", "OUT_FOR_DELIVERY"],
      },
      awb: { not: null },
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lte: sixHoursAgo } },
      ],
    },
    orderBy: [
      { lastSyncedAt: "asc" },
      { createdAt: "asc" },
    ],
    take: batchSize,
    include: { order: true },
  });

  if (shipments.length === 0) {
    return { itemsProcessed: 0 };
  }

  const provider = getShippingProvider();
  let processed = 0;

  for (const shipment of shipments) {
    if (!shipment.awb) continue;

    try {
      const tracking = await provider.track(shipment.awb);
      const rawStatus = tracking.rawStatus;
      const occurredAt = new Date();
      const dedupeKey = computeShipmentEventDedupeKey(shipment.awb, rawStatus, occurredAt);

      const mapResult = mapShiprocketStatus(rawStatus, shipment.status);
      const targetStatus = mapResult.status;

      await prisma.$transaction(async (tx) => {
        // Record event idempotently
        await tx.shipmentEvent.upsert({
          where: { dedupeKey },
          create: {
            shipmentId: shipment.id,
            status: targetStatus || shipment.status,
            rawStatus,
            location: tracking.currentLocation || null,
            occurredAt,
            source: "POLL",
            dedupeKey,
          },
          update: {},
        });

        if (!targetStatus || !canShipmentTransition(shipment.status, targetStatus)) {
          await tx.shipment.update({
            where: { id: shipment.id },
            data: {
              lastSyncedAt: new Date(),
              lastEventAt: occurredAt,
            },
          });
          return;
        }

        // Apply transition
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            status: targetStatus,
            lastSyncedAt: new Date(),
            lastEventAt: occurredAt,
          },
        });

        const isCod = shipment.order.paymentMethod === "COD";

        if (targetStatus === "DELIVERED") {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: {
              fulfilmentStatus: "DELIVERED",
              deliveredAt: occurredAt,
              ...(isCod ? { paymentStatus: "COD_COLLECTED", paidAt: occurredAt } : {}),
            },
          });
        } else if (targetStatus === "RTO_DELIVERED") {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: { fulfilmentStatus: "RTO" },
          });
        }
      });

      // Outbox notifications
      if (targetStatus === "DELIVERED") {
        await enqueueOutbox({
          type: "ORDER_DELIVERED",
          channel: "EMAIL",
          orderId: shipment.orderId,
          payload: { orderId: shipment.orderId },
          dedupeKey: `email_delivered_${shipment.orderId}`,
        });
      } else if (targetStatus === "OUT_FOR_DELIVERY") {
        await enqueueOutbox({
          type: "ORDER_OUT_FOR_DELIVERY",
          channel: "EMAIL",
          orderId: shipment.orderId,
          payload: { orderId: shipment.orderId },
          dedupeKey: `email_ofd_${shipment.id}_${dedupeKey}`,
        });
      }

      processed++;
    } catch (err) {
      console.error(`Failed to sync tracking for AWB ${shipment.awb}:`, safeErrorSummary(err));
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { lastSyncedAt: new Date() },
      });
    }
  }

  return { itemsProcessed: processed };
}
