import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOrderConfirmationEmail } from "@/lib/email";

interface VerifyBody {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function POST(req: Request) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (await req.json()) as VerifyBody;

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: razorpay_order_id },
    include: { items: true },
  });
  if (!order) return NextResponse.json({ verified: false, error: "Order not found" }, { status: 404 });

  // Idempotent: if the webhook already marked this PAID, don't double-decrement stock.
  if (order.status === "PAID") {
    return NextResponse.json({ verified: true, orderId: order.id, alreadyProcessed: true });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID", razorpayPaymentId: razorpay_payment_id, paidAt: new Date() },
      });

      for (const item of order.items) {
        const updated = await tx.productVariant.updateMany({
          where: { id: item.variantId, stock: { gte: item.qty } },
          data: { stock: { decrement: item.qty } },
        });

        if (updated.count === 0) {
          throw new Error(`Insufficient stock for variant ${item.variantId}`);
        }
      }
    });
  } catch (err) {
    return NextResponse.json(
      { verified: false, error: err instanceof Error ? err.message : "Stock reservation failed" },
      { status: 400 }
    );
  }

  // Trigger order confirmation email asynchronously
  sendOrderConfirmationEmail(order.id).catch((err) => {
    console.error("Failed to send order confirmation email:", err);
  });

  return NextResponse.json({ verified: true, orderId: order.id });
}
