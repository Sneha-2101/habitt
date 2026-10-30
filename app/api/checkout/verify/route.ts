import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/sessions";
import { markOrderPaid } from "@/lib/orders/mark-paid";

interface VerifyBody {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = (await req.json()) as VerifyBody;

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return NextResponse.json({ error: "Payment gateway not configured" }, { status: 500 });
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(razorpay_signature || "");

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return NextResponse.json({ verified: false, error: "Invalid signature" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { razorpayOrderId: razorpay_order_id },
  });

  if (!order || order.userId !== userId) {
    return NextResponse.json({ verified: false, error: "Order not found" }, { status: 404 });
  }

  await prisma.$transaction(
    async (tx) => {
      await markOrderPaid(tx, order.id, razorpay_payment_id);
    },
    { maxWait: 15000, timeout: 20000 }
  );

  return NextResponse.json({ verified: true, orderId: order.id });
}
