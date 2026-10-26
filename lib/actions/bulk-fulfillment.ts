"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { sendShipmentNotificationEmail } from "@/lib/email";

async function requireStaffOrOwner() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user || (role !== "STAFF" && role !== "OWNER")) {
    throw new Error("Unauthorized: Action requires STAFF or OWNER role.");
  }
  return session;
}

export async function bulkMarkShipped(
  shipments: {
    orderId: string;
    courierName: string;
    awbNumber: string;
    trackingUrl?: string;
  }[]
) {
  await requireStaffOrOwner();

  if (!shipments.length) {
    throw new Error("No orders selected for bulk shipment.");
  }

  for (const s of shipments) {
    if (!s.courierName?.trim() || !s.awbNumber?.trim()) {
      throw new Error(`Real courier name and AWB number are required for order ID ${s.orderId}`);
    }
  }

  const shippedAt = new Date();
  const orderIds = shipments.map((s) => s.orderId);

  const eligibleOrders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      status: "PAID",
    },
    select: { id: true, displayId: true },
  });

  if (!eligibleOrders.length) {
    throw new Error("None of the selected orders are in PAID status eligible for shipping.");
  }

  const eligibleMap = new Map(eligibleOrders.map((o) => [o.id, o]));

  for (const item of shipments) {
    const order = eligibleMap.get(item.orderId);
    if (!order) continue; // skip non-PAID orders

    const courierName = item.courierName.trim();
    const awbNumber = item.awbNumber.trim();
    const trackingUrl = item.trackingUrl?.trim() || null;

    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "SHIPPED",
          shippedAt,
          courierName,
          awbNumber,
          trackingUrl,
        },
      }),
      prisma.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "SHIPPED",
          note: `Bulk dispatched via ${courierName} (AWB: ${awbNumber})`,
          createdAt: shippedAt,
        },
      }),
    ]);

    sendShipmentNotificationEmail(order.id).catch((err) => {
      console.error(`Failed to send bulk shipment email for ${order.id}:`, err);
    });
  }

  revalidatePath("/admin/orders");
  return { count: eligibleOrders.length };
}
