import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendOrderConfirmationEmail } from "@/lib/email";

// Configure this URL in the Razorpay dashboard (Settings → Webhooks) for the
// "payment.captured" event. This exists as a second, server-to-server
// confirmation path independent of the browser — see AppFlow.md step 6.
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!signature) return new Response("missing signature", { status: 400 });

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(rawBody)
    .digest("hex");

  if (signature !== expected) return new Response("invalid signature", { status: 400 });

  const event = JSON.parse(rawBody);

  if (event.event === "payment.captured") {
    const razorpayOrderId = event.payload.payment.entity.order_id as string;
    const razorpayPaymentId = event.payload.payment.entity.id as string;

    const order = await prisma.order.findUnique({
      where: { razorpayOrderId },
      include: { items: true },
    });

    // Idempotent: skip if /api/checkout/verify already processed this order.
    if (order && order.status !== "PAID") {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "PAID", razorpayPaymentId, paidAt: new Date() },
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

        // Send order confirmation email asynchronously
        sendOrderConfirmationEmail(order.id).catch((err) => {
          console.error("Failed to send webhook order confirmation email:", err);
        });
      } catch (err) {
        console.error("Webhook processing failed due to insufficient stock:", err);
        return new Response("Insufficient stock", { status: 400 });
      }
    }
  }

  return new Response("ok", { status: 200 });
}
