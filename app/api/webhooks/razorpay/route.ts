import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { markOrderPaid } from "@/lib/orders/mark-paid";
import { safeErrorSummary } from "@/lib/log-redact";

export async function POST(req: Request) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("RAZORPAY_WEBHOOK_SECRET is missing");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!signature) {
    return new Response("missing signature", { status: 400 });
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return new Response("invalid signature", { status: 400 });
  }

  let event: {
    id?: string;
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          order_id?: string;
          id?: string;
          error_description?: string;
        };
      };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const eventId = req.headers.get("x-razorpay-event-id") || event?.id;

  try {
    await prisma.$transaction(
      async (tx) => {
        // Deduplicate webhook events via ProcessedWebhook
      if (eventId) {
        await tx.processedWebhook.create({
          data: {
            id: eventId,
            provider: "RAZORPAY",
          },
        });
      }

      if (event.event === "payment.captured") {
        const razorpayOrderId = event.payload?.payment?.entity?.order_id as string | undefined;
        const razorpayPaymentId = event.payload?.payment?.entity?.id as string | undefined;

        if (razorpayOrderId && razorpayPaymentId) {
          const order = await tx.order.findUnique({
            where: { razorpayOrderId },
          });

          if (order) {
            await markOrderPaid(tx, order.id, razorpayPaymentId);
          }
        }
      } else if (event.event === "payment.failed") {
        const razorpayOrderId = event.payload?.payment?.entity?.order_id as string | undefined;
        const errorDesc = event.payload?.payment?.entity?.error_description || "Payment failed at gateway";

        if (razorpayOrderId) {
          const order = await tx.order.findUnique({
            where: { razorpayOrderId },
          });

          if (order) {
            // Note only: customers can retry on the same Razorpay order; do not change status
            await tx.orderStatusEvent.create({
              data: {
                orderId: order.id,
                paymentStatus: order.paymentStatus,
                fulfilmentStatus: order.fulfilmentStatus,
                note: `Payment attempt failed: ${errorDesc}`,
              },
            });
          }
        }
      }
    },
    { maxWait: 15000, timeout: 20000 }
  );
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Event already processed
      return new Response("Duplicate webhook event", { status: 200 });
    }
    console.error("Razorpay webhook processing error:", safeErrorSummary(err));
    return new Response("Processing error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
