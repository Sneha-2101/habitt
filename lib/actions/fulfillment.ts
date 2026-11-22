"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail, sendDeliveredEmail, sendReviewRequestEmail } from "@/lib/email";
import { legacyStage } from "@/lib/orders/status-label";
import { issueInvoiceForOrder } from "@/lib/gst/issue-invoice";
import { getShippingProvider } from "@/lib/shipping/shiprocket";
import { computeShipmentEventDedupeKey } from "@/lib/shipping/transitions";

export async function markOrderShipped(
  orderId: string,
  data: {
    courierName: string;
    awbNumber: string;
    trackingUrl?: string;
    note?: string;
  }
) {
  await requireStaff();

  if (!data.courierName?.trim() || !data.awbNumber?.trim()) {
    throw new Error("Courier name and AWB / Tracking number are required.");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });
  if (!order) throw new Error("Order not found");

  const isCod = order.paymentMethod === "COD";
  const canShip =
    order.fulfilmentStatus === "PLACED" &&
    (isCod ? order.paymentStatus === "COD_PENDING" : order.paymentStatus === "PAID");

  if (!canShip) {
    throw new Error(`Order cannot be marked shipped from status ${legacyStage(order)}`);
  }

  const shippedAt = new Date();
  const courierName = data.courierName.trim();
  const awbNumber = data.awbNumber.trim();
  const trackingUrl = data.trackingUrl?.trim() || null;

  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: {
        id: orderId,
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
      throw new Error("Order already changed");
    }

    // Create or update MANUAL Shipment row in the same transaction
    const existingShipment = await tx.shipment.findFirst({
      where: { orderId, status: { notIn: ["CANCELLED", "FAILED"] } },
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
          orderId,
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
      "MANUAL_DISPATCH",
      shippedAt
    );
    await tx.shipmentEvent.upsert({
      where: { dedupeKey },
      create: {
        shipmentId,
        status: "IN_TRANSIT",
        rawStatus: "MANUAL_DISPATCH",
        source: "MANUAL",
        occurredAt: shippedAt,
        dedupeKey,
      },
      update: {},
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "SHIPPED",
        paymentStatus: order.paymentStatus,
        note: `Dispatched via ${courierName} (AWB: ${awbNumber})${data.note ? ` - ${data.note.trim()}` : ""}`,
      },
    });
  });

  // Issue invoice in its own transaction after shipping transaction commits
  try {
    await prisma.$transaction(async (invTx) => {
      await issueInvoiceForOrder(invTx, orderId);
    });
  } catch (invErr) {
    console.error(`Failed to issue invoice for order ${orderId}:`, invErr);
    await prisma.orderStatusEvent.create({
      data: {
        orderId,
        note: "INVOICE PENDING: retry from admin",
      },
    });
  }

  // Send shipment notification email asynchronously
  sendShipmentNotificationEmail(orderId).catch((err) => {
    console.error("Failed to send shipment notification email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}

/**
 * Staff action to create and dispatch a shipment via the configured shipping provider (Shiprocket or Manual).
 * Provider calls happen strictly OUTSIDE the database transaction.
 * Idempotent: returns existing active shipment if one exists.
 */
export async function createShipmentAction(orderId: string) {
  const staff = await requireStaff();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      shipments: { where: { status: { notIn: ["CANCELLED", "FAILED"] } } },
    },
  });

  if (!order) throw new Error("Order not found");

  // Idempotent: a second call for an order with an active shipment returns it
  const activeShipment = order.shipments[0];
  if (
    activeShipment &&
    activeShipment.status !== "FAILED" &&
    activeShipment.status !== "CANCELLED"
  ) {
    return { ok: true, success: true, shipment: activeShipment, idempotent: true };
  }

  const isCod = order.paymentMethod === "COD";
  const isPaid = isCod ? order.paymentStatus === "COD_PENDING" : order.paymentStatus === "PAID";
  const allowedFulfilment = ["PLACED", "CONFIRMED", "PACKED"].includes(
    order.fulfilmentStatus
  );

  if (!isPaid || !allowedFulfilment) {
    throw new Error(
      `Order cannot be shipped from current status (fulfilment: ${order.fulfilmentStatus}, payment: ${order.paymentStatus})`
    );
  }

  // Load product variants to provide SKU if present
  const variantIds = order.items.map((i) => i.variantId).filter(Boolean);
  const variants = variantIds.length > 0
    ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } } })
    : [];
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const orderWithVariants = {
    ...order,
    items: order.items.map((item) => ({
      ...item,
      variant: variantMap.get(item.variantId) || null,
    })),
  };

  const provider = getShippingProvider();

  // 1. Create the Shipment row CREATED inside DB first
  const shipment = await prisma.shipment.create({
    data: {
      orderId: order.id,
      provider: provider.name,
      status: "CREATED",
    },
  });

  // 2. Provider calls happen OUTSIDE any DB transaction
  let createRes;
  try {
    createRes = await provider.createShipment(orderWithVariants);
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : "Provider shipment creation failed";
    const failedShipment = await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: "FAILED", failureReason: errorMsg },
    });
    return { ok: false, success: false, shipment: failedShipment, error: errorMsg };
  }

  let awb = createRes.awb;
  let courierName = createRes.courierName;
  let trackingUrl = createRes.trackingUrl;
  let labelUrl = createRes.labelUrl;

  if (!awb && createRes.providerShipmentId) {
    try {
      const assignRes = await provider.assignAwb(
        createRes.providerShipmentId,
        createRes.providerOrderId
      );
      awb = assignRes.awb;
      courierName = assignRes.courierName;
      trackingUrl = assignRes.trackingUrl;
      labelUrl = assignRes.labelUrl;
    } catch (assignErr: unknown) {
      const errorMsg =
        assignErr instanceof Error ? assignErr.message : "AWB assignment failed";
      const failedShipment = await prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          providerOrderId: createRes.providerOrderId,
          providerShipmentId: createRes.providerShipmentId,
          status: "FAILED",
          failureReason: errorMsg,
        },
      });
      return { ok: false, success: false, shipment: failedShipment, error: errorMsg };
    }
  }

  // 3. Update Shipment & mark order SHIPPED through existing transition code
  const updatedShipment = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      providerOrderId: createRes.providerOrderId,
      providerShipmentId: createRes.providerShipmentId,
      awb: awb || null,
      courierName: courierName || null,
      trackingUrl: trackingUrl || null,
      labelUrl: labelUrl || null,
      status: awb ? "AWB_ASSIGNED" : "CREATED",
    },
  });

  if (awb) {
    await markOrderShipped(order.id, {
      courierName: courierName || "Shiprocket Partner",
      awbNumber: awb,
      trackingUrl: trackingUrl || undefined,
      note: `Shipment booked via ${provider.name}`,
    });
  }

  await writeAudit({
    actorId: staff.id,
    action: "SHIPMENT_CREATED",
    entity: "Shipment",
    entityId: shipment.id,
    meta: {
      orderId: order.id,
      provider: provider.name,
      awb,
    },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, success: true, shipment: updatedShipment };
}

export async function markOrderDelivered(orderId: string, note?: string) {
  await requireStaff();

  const deliveredAt = new Date();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found");

  if (order.fulfilmentStatus !== "SHIPPED") {
    throw new Error(`Order cannot be marked delivered from status ${legacyStage(order)}`);
  }

  const isCod = order.paymentMethod === "COD";
  const defaultNote = isCod
    ? "Package delivered and cash collected."
    : "Package marked as delivered to recipient.";

  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, fulfilmentStatus: "SHIPPED" },
      data: {
        fulfilmentStatus: "DELIVERED",
        deliveredAt,
        ...(isCod ? { paymentStatus: "COD_COLLECTED", paidAt: deliveredAt } : {}),
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        fulfilmentStatus: "DELIVERED",
        ...(isCod ? { paymentStatus: "COD_COLLECTED" } : { paymentStatus: order.paymentStatus }),
        note: note?.trim() || defaultNote,
      },
    });
  });

  sendDeliveredEmail(orderId).catch((err) => {
    console.error("Failed to send delivery email:", err);
  });

  // Trigger review request email
  sendReviewRequestEmail(orderId).catch((err) => {
    console.error("Failed to send review request email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}
