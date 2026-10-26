import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAbandonedCartEmail } from "@/lib/email";
import { getSettings } from "@/lib/settings";

export async function GET() {
  try {
    const settings = await getSettings();
    const delayMs = (settings.abandonedCartDelayHours || 24) * 60 * 60 * 1000;
    const thresholdDate = new Date(Date.now() - delayMs);

    const abandonedOrders = await prisma.order.findMany({
      where: {
        status: "PENDING",
        createdAt: { lte: thresholdDate },
        customerEmail: { not: null },
      },
      select: {
        id: true,
        displayId: true,
        customerName: true,
        customerEmail: true,
      },
    });

    let sentCount = 0;
    for (const order of abandonedOrders) {
      if (order.customerEmail) {
        await sendAbandonedCartEmail(order.customerEmail, order.customerName, order.displayId);
        sentCount++;
      }
    }

    return NextResponse.json({ success: true, processed: abandonedOrders.length, emailsSent: sentCount });
  } catch (err) {
    console.error("Abandoned cart job error:", err);
    return NextResponse.json({ error: "Failed to process abandoned carts" }, { status: 500 });
  }
}
