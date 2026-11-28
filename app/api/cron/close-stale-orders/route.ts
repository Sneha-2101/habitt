import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { failOrder } from "@/lib/orders/fail-order";
import crypto from "crypto";
import { withCronRun } from "@/lib/cron/run-log";
import { recoverInterruptedRefunds } from "@/lib/refunds/recover-refunds";
import { safeErrorSummary } from "@/lib/log-redact";

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

    const result = await withCronRun("close-stale-orders", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const staleOrders = await prisma.order.findMany({
        where: {
          paymentMethod: "RAZORPAY",
          paymentStatus: "PENDING",
          fulfilmentStatus: "CREATED",
          createdAt: { lte: twoHoursAgo },
        },
        include: {
          items: true,
        },
      });

      let closedCount = 0;
      for (const order of staleOrders) {
        try {
          const res = await prisma.$transaction(async (tx) => {
            return await failOrder(tx, order, "Order timed out waiting for payment");
          });
          if (res.updated) {
            closedCount++;
          }
        } catch (orderErr) {
          console.error(`Failed to close stale order ${order.id}:`, safeErrorSummary(orderErr));
        }
      }

      const refundRecovery = await recoverInterruptedRefunds();

      return {
        closedCount,
        refundRecovery,
        itemsProcessed: closedCount + refundRecovery.checked,
      };
    });

    return NextResponse.json({
      success: true,
      closedCount: result.closedCount,
      refundRecovery: result.refundRecovery,
    });
  } catch (err: unknown) {
    console.error("Close stale orders cron error:", safeErrorSummary(err));
    return NextResponse.json({ error: "Failed to close stale orders" }, { status: 500 });
  }
}
