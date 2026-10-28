import crypto from "crypto";

export function verifySignature(orderId: string, paymentId: string): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    throw new Error("RAZORPAY_KEY_SECRET is not set in environment");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

export function webhookSignature(rawBody: string, customSecret?: string): string {
  const secret = customSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not set in environment");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
}
