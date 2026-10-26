"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function markCodRefused(orderId: string, note?: string) {
  const session = await auth();
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user?.id || (userRole !== "STAFF" && userRole !== "OWNER")) {
    throw new Error("Unauthorized: Only store staff or admins can mark COD refusal");
  }

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

  if (order.status !== "SHIPPED" && order.status !== "PENDING") {
    throw new Error(`Order cannot be marked refused from status ${order.status}`);
  }

  const refusalNote = `[COD REFUSED / RTO] ${note?.trim() || "Delivery refused by customer at doorstep / Return to Origin"}`;

  await prisma.$transaction(async (tx) => {
    // 1. Update order status to CANCELLED
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancellationReason: refusalNote,
      },
    });

    // 2. Restock all variant items
    for (const item of order.items) {
      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.qty } },
        });
      }
    }

    // 3. Log status event
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
