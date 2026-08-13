import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", razorpayPaymentId: razorpay_payment_id, paidAt: new Date() },
    });

    for (const item of order.items) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { decrement: item.qty } },
      });
    }
  });

  // TODO: send order confirmation email via Resend here.

  return NextResponse.json({ verified: true, orderId: order.id });
}
