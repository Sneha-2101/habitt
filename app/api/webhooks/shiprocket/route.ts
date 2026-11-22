import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";
import { z } from "zod";
import { mapShiprocketStatus } from "@/lib/shipping/status-map";
import {
  canShipmentTransition,
  computeShipmentEventDedupeKey,
} from "@/lib/shipping/transitions";
import { enqueueOutbox } from "@/lib/outbox/enqueue";

const webhookSchema = z.object({
  awb: z.string().min(1, "awb is required"),
  current_status: z.string().min(1, "current_status is required"),
  current_timestamp: z.string().optional(),
  courier_name: z.string().optional(),
  location: z.string().optional(),
  order_id: z.union([z.string(), z.number()]).optional(),
  shipment_id: z.union([z.string(), z.number()]).optional(),
});

export async function POST(req: Request) {
  // If Shiprocket is disabled, return 404
  if (process.env.SHIPROCKET_ENABLED !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const webhookToken = process.env.SHIPROCKET_WEBHOOK_TOKEN?.trim();
  if (!webhookToken) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const tokenHeader =
    req.headers.get("x-api-key") || req.headers.get("http_x_api_key");

  if (!tokenHeader) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const tokenBuf = Buffer.from(tokenHeader);
  const expectedBuf = Buffer.from(webhookToken);
  if (
    tokenBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(tokenBuf, expectedBuf)
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const val = webhookSchema.safeParse(parsedJson);
  if (!val.success) {
    return new NextResponse("Invalid payload format", { status: 400 });
  }

  const data = val.data;
  const awb = data.awb.trim();
  const rawStatus = data.current_status.trim();
  const location = data.location?.trim() || null;
  const occurredAt = data.current_timestamp
    ? new Date(data.current_timestamp)
    : new Date();

  // Find shipment by AWB
  const shipment = await prisma.shipment.findFirst({
    where: { awb },
    include: { order: true },
  });

  if (!shipment) {
    // Unknown AWB returns 200 without side effects
    return new NextResponse("OK", { status: 200 });
  }

  const dedupeKey = computeShipmentEventDedupeKey(awb, rawStatus, occurredAt);

  // Check if event was already recorded (idempotent no-op)
  const existingEvent = await prisma.shipmentEvent.findUnique({
    where: { dedupeKey },
  });

  if (existingEvent) {
    return NextResponse.json({ success: true, message: "Duplicate event" });
  }

  const mapResult = mapShiprocketStatus(rawStatus, shipment.status);
  const targetStatus = mapResult.status;

  await prisma.$transaction(async (tx) => {
    // Record the shipment event
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: targetStatus || shipment.status,
        rawStatus,
        location,
        occurredAt,
        source: "WEBHOOK",
        dedupeKey,
      },
    });

    if (!targetStatus || !canShipmentTransition(shipment.status, targetStatus)) {
      // Transition not allowed or out-of-order older event: keep current status
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          lastEventAt: occurredAt,
          lastSyncedAt: new Date(),
        },
      });
      return;
    }

    // Apply shipment status transition
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: targetStatus,
        lastEventAt: occurredAt,
        lastSyncedAt: new Date(),
      },
    });

    const isCod = shipment.order.paymentMethod === "COD";

    // Order status transitions
    if (targetStatus === "DELIVERED") {
      await tx.order.update({
        where: { id: shipment.orderId },
        data: {
          fulfilmentStatus: "DELIVERED",
          deliveredAt: occurredAt,
          ...(isCod ? { paymentStatus: "COD_COLLECTED", paidAt: occurredAt } : {}),
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          fulfilmentStatus: "DELIVERED",
          paymentStatus: isCod ? "COD_COLLECTED" : shipment.order.paymentStatus,
          note: `Delivered via ${shipment.courierName || "Courier"} (AWB: ${awb})`,
        },
      });
    } else if (targetStatus === "RTO_DELIVERED") {
      await tx.order.update({
        where: { id: shipment.orderId },
        data: {
          fulfilmentStatus: "RTO",
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          fulfilmentStatus: "RTO",
          paymentStatus: shipment.order.paymentStatus,
          note: `Package returned to origin (RTO) - AWB: ${awb}`,
        },
      });
    } else if (
      (targetStatus === "IN_TRANSIT" || targetStatus === "OUT_FOR_DELIVERY") &&
      shipment.order.fulfilmentStatus !== "SHIPPED" &&
      shipment.order.fulfilmentStatus !== "DELIVERED" &&
      shipment.order.fulfilmentStatus !== "RTO"
    ) {
      await tx.order.update({
        where: { id: shipment.orderId },
        data: {
          fulfilmentStatus: "SHIPPED",
          shippedAt: shipment.order.shippedAt || occurredAt,
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: shipment.orderId,
          fulfilmentStatus: "SHIPPED",
          paymentStatus: shipment.order.paymentStatus,
          note: `Order marked shipped via ${shipment.courierName || "Courier"} (AWB: ${awb})`,
        },
      });
    }
  });

  // Enqueue outbox notifications outside transaction
  if (targetStatus === "DELIVERED") {
    await enqueueOutbox({
      type: "ORDER_DELIVERED",
      channel: "EMAIL",
      orderId: shipment.orderId,
      payload: { orderId: shipment.orderId },
      dedupeKey: `email_delivered_${shipment.orderId}`,
    });

    await enqueueOutbox({
      type: "ORDER_DELIVERED",
      channel: "WHATSAPP",
      orderId: shipment.orderId,
      payload: { orderId: shipment.orderId },
      dedupeKey: `whatsapp_delivered_${shipment.orderId}`,
    });
  } else if (targetStatus === "OUT_FOR_DELIVERY") {
    await enqueueOutbox({
      type: "ORDER_OUT_FOR_DELIVERY",
      channel: "EMAIL",
      orderId: shipment.orderId,
      payload: { orderId: shipment.orderId },
      dedupeKey: `email_ofd_${shipment.id}_${dedupeKey}`,
    });

    await enqueueOutbox({
      type: "ORDER_OUT_FOR_DELIVERY",
      channel: "WHATSAPP",
      orderId: shipment.orderId,
      payload: { orderId: shipment.orderId },
      dedupeKey: `whatsapp_ofd_${shipment.id}_${dedupeKey}`,
    });
  }

  return NextResponse.json({ success: true });
}
