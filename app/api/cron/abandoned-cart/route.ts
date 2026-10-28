import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAbandonedCartEmail } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return new NextResponse("cron not configured", { status: 500 });
    }

    const authHeader = request.headers.get("authorization");
    const expectedHeader = `Bearer ${cronSecret}`;
    if (!authHeader) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const authBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(expectedHeader);
    if (authBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(authBuffer, expectedBuffer)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const settings = await getSettings();
    const delayMs = (settings.abandonedCartDelayHours || 24) * 60 * 60 * 1000;
    const now = Date.now();
    const olderThan = new Date(now - delayMs);
    const youngerThan = new Date(now - 72 * 60 * 60 * 1000);

    const abandonedOrders = await prisma.order.findMany({
      where: {
        paymentMethod: "RAZORPAY",
        status: { in: ["PENDING", "FAILED"] },
        createdAt: {
          lte: olderThan,
          gte: youngerThan,
        },
        abandonedEmailSentAt: null,
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
        await prisma.order.update({
          where: { id: order.id },
          data: { abandonedEmailSentAt: new Date() },
        });
        sentCount++;
      }
    }

    return NextResponse.json({ success: true, processed: abandonedOrders.length, emailsSent: sentCount });
  } catch (err) {
    console.error("Abandoned cart job error:", err);
    return NextResponse.json({ error: "Failed to process abandoned carts" }, { status: 500 });
  }
}
