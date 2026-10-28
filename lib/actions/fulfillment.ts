"use server";

import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail, sendDeliveredEmail, sendReviewRequestEmail } from "@/lib/email";

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
  const requiredStatus = isCod ? "PENDING" : "PAID";

  if (order.status !== requiredStatus) {
    throw new Error(`Order cannot be marked shipped from status ${order.status}`);
  }

  const shippedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, status: requiredStatus },
      data: {
        status: "SHIPPED",
        shippedAt,
        courierName: data.courierName.trim(),
        awbNumber: data.awbNumber.trim(),
        trackingUrl: data.trackingUrl?.trim() || null,
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "SHIPPED",
        note: `Dispatched via ${data.courierName.trim()} (AWB: ${data.awbNumber.trim()})${data.note ? ` - ${data.note.trim()}` : ""}`,
      },
    });
  });

  // Send shipment notification email asynchronously
  sendShipmentNotificationEmail(orderId).catch((err) => {
    console.error("Failed to send shipment notification email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}

export async function markOrderDelivered(orderId: string, note?: string) {
  await requireStaff();

  const deliveredAt = new Date();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found");

  if (order.status !== "SHIPPED") {
    throw new Error(`Order cannot be marked delivered from status ${order.status}`);
  }

  const isCod = order.paymentMethod === "COD";
  const defaultNote = isCod
    ? "Package delivered and cash collected."
    : "Package marked as delivered to recipient.";

  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, status: "SHIPPED" },
      data: {
        status: "DELIVERED",
        deliveredAt,
        ...(isCod ? { paidAt: deliveredAt } : {}),
      },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "DELIVERED",
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
