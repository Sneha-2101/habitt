import Razorpay from "razorpay";

// Server-only. Never import this file from a Client Component —
// RAZORPAY_KEY_SECRET must never reach the browser.
export function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}
