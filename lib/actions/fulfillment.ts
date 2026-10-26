"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail, sendDeliveredEmail, sendReviewRequestEmail } from "@/lib/email";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

export async function markOrderShipped(
  orderId: string,
  data: {
    courierName: string;
    awbNumber: string;
    trackingUrl?: string;
    note?: string;
  }
) {
  await requireStaffOrOwner();

  if (!data.courierName?.trim() || !data.awbNumber?.trim()) {
    throw new Error("Courier name and AWB / Tracking number are required.");
  }

  const shippedAt = new Date();

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: "SHIPPED",
        shippedAt,
        courierName: data.courierName.trim(),
        awbNumber: data.awbNumber.trim(),
        trackingUrl: data.trackingUrl?.trim() || null,
      },
    }),
    prisma.orderStatusEvent.create({
      data: {
        orderId,
        status: "SHIPPED",
        note: data.note?.trim() || `Dispatched via ${data.courierName.trim()} (AWB: ${data.awbNumber.trim()})`,
        createdAt: shippedAt,
      },
    }),
  ]);

  // Send shipment notification email asynchronously
  sendShipmentNotificationEmail(orderId).catch((err) => {
    console.error("Failed to send shipment notification email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}

export async function markOrderDelivered(orderId: string, note?: string) {
  await requireStaffOrOwner();

  const deliveredAt = new Date();
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Order not found");

  const isCod = order.paymentMethod === "COD";
  const defaultNote = isCod
    ? "Package delivered and cash collected."
    : "Package marked as delivered to recipient.";

  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: "DELIVERED",
        deliveredAt,
        ...(isCod && !order.paidAt ? { paidAt: deliveredAt } : {}),
      },
    }),
    prisma.orderStatusEvent.create({
      data: {
        orderId,
        status: "DELIVERED",
        note: note?.trim() || defaultNote,
        createdAt: deliveredAt,
      },
    }),
  ]);

  // Send delivery notification email & review request email asynchronously
  sendDeliveredEmail(orderId).catch((err) => {
    console.error("Failed to send delivery email:", err);
  });
  sendReviewRequestEmail(orderId).catch((err) => {
    console.error("Failed to send review request email:", err);
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/account");
}
