import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { limit, RateLimitUnavailableError } from "@/lib/ratelimit";
import { calculateQuote } from "@/lib/pricing/quote";

const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product ID required"),
        variantId: z.string().min(1, "Variant ID required"),
        qty: z.number().int("Quantity must be an integer").min(1, "Minimum quantity is 1").max(10, "Maximum quantity is 10"),
      })
    )
    .min(1, "Cart cannot be empty")
    .max(20, "Cannot purchase more than 20 distinct items at once"),
  customerName: z.string().trim().optional(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional().or(z.literal("")),
  paymentMethod: z.enum(["RAZORPAY", "COD"]).default("RAZORPAY"),
  couponCode: z.string().optional().nullable(),
  useStoreCredit: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const rl = await limit("checkoutQuote", userId);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }
  } catch (err) {
    if (err instanceof RateLimitUnavailableError) {
      return NextResponse.json(
        { error: "Checkout service temporarily unavailable. Please retry." },
        { status: 503 }
      );
    }
    throw err;
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parseResult = quoteSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors.map((e) => e.message).join(", ");
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }

  const data = parseResult.data;

  const quote = await calculateQuote({
    userId,
    items: data.items,
    paymentMethod: data.paymentMethod,
    couponCode: data.couponCode,
    useStoreCredit: data.useStoreCredit,
  });

  return NextResponse.json(quote);
}

