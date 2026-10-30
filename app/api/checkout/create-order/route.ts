import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma, Order, OrderItem, Size } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { getSessionUser } from "@/lib/sessions";
import { reserveStock, InsufficientStockError } from "@/lib/stock";
import { failOrder } from "@/lib/orders/fail-order";
import { limit } from "@/lib/ratelimit";
import { calculateQuote } from "@/lib/pricing/quote";
import { z } from "zod";

class StoreCreditConflictError extends Error {
  constructor(message = "Store credit changed, please retry") {
    super(message);
    this.name = "StoreCreditConflictError";
  }
}

class CouponConflictError extends Error {
  constructor(message = "Coupon no longer available") {
    super(message);
    this.name = "CouponConflictError";
  }
}

function generateDisplayId(): string {
  return "HB-" + crypto.randomInt(100000, 999999);
}

const phoneSchema = z.string().transform((val) => {
  let clean = val.replace(/\s+/g, "").replace(/-/g, "");
  if (clean.startsWith("+91")) clean = clean.substring(3);
  else if (clean.startsWith("91") && clean.length === 12) clean = clean.substring(2);
  else if (clean.startsWith("0") && clean.length === 11) clean = clean.substring(1);
  return clean;
}).pipe(z.string().regex(/^\d{10}$/, "Please enter a valid 10-digit mobile number"));

const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid("Invalid idempotency key"),
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
  customerName: z.string().trim().min(1, "Name is required"),
  customerPhone: phoneSchema,
  customerEmail: z.string().email("Invalid email address").optional(),
  shippingAddress: z.object({
    line1: z.string().trim().min(1, "Address line 1 is required"),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(1, "City is required"),
    state: z.string().trim().min(1, "State is required"),
    pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits"),
  }),
  giftMessage: z.string().max(200, "Gift message cannot exceed 200 characters").optional(),
  couponCode: z.string().trim().optional(),
  paymentMethod: z.enum(["RAZORPAY", "COD"]),
  useStoreCredit: z.boolean().default(false),
});

export async function POST(req: Request) {
  const sessionUser = await getSessionUser();
  const userId = sessionUser?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sign in required to check out" }, { status: 401 });
  }

  // Rate limit: createOrder (10 per minute per user)
  const rl = await limit("createOrder", userId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment.", retryAfterSec: rl.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parseResult = createOrderSchema.safeParse(bodyJson);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.errors.map((e) => e.message).join(", ");
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }

  const data = parseResult.data;

  // 1. Calculate quote via shared lib/pricing/quote.ts
  const quote = await calculateQuote({
    userId,
    items: data.items,
    paymentMethod: data.paymentMethod,
    couponCode: data.couponCode,
    useStoreCredit: data.useStoreCredit,
  });

  // Check structured warnings from quote engine
  for (const w of quote.warnings) {
    if (w.type === "MAX_QTY_EXCEEDED") {
      return NextResponse.json({ error: w.message }, { status: 400 });
    }
    if (w.type === "ITEM_UNAVAILABLE" || w.type === "STOCK_EXCEEDED") {
      return NextResponse.json({ error: w.message }, { status: 409 });
    }
    if (w.type === "INVALID_COUPON") {
      const status = w.message.includes("already used") ? 409 : 400;
      return NextResponse.json({ error: w.message }, { status });
    }
    if (w.type === "EMPTY_CART") {
      return NextResponse.json({ error: w.message }, { status: 400 });
    }
  }

  const isCod = data.paymentMethod === "COD";
  if (isCod && !quote.cod.eligible) {
    return NextResponse.json(
      { error: quote.cod.reason || "COD is not available for this order" },
      { status: 400 }
    );
  }

  const subtotal = quote.subtotal;
  const shippingFee = quote.shippingFee;
  const discountAmount = quote.discount;
  const appliedCouponCode = discountAmount > 0 ? (data.couponCode?.trim().toUpperCase() || undefined) : undefined;
  const total = quote.total;
  const orderItemsData = quote.items;

  // 3. Idempotency Check: look up the order by idempotencyKey
  const checkExistingOrder = async (existing: {
    userId: string;
    status: string;
    total: number;
    storeCreditApplied?: number | null;
    razorpayOrderId?: string | null;
    displayId: string;
    paymentMethod: string;
    id: string;
  }) => {
    if (existing.userId !== userId) {
      return NextResponse.json({ error: "Idempotency key belongs to another user" }, { status: 409 });
    }
    if (existing.status === "PAID") {
      return NextResponse.json({ alreadyPaid: true, orderId: existing.id });
    }
    if (existing.status === "PENDING") {
      const existingPayable = Math.max(0, existing.total - (existing.storeCreditApplied || 0));
      // Same payable amount with existing razorpayOrderId -> return the same Razorpay order
      if (existingPayable === (total - (existing.storeCreditApplied || 0)) && existing.razorpayOrderId) {
        return NextResponse.json({
          orderId: existing.id,
          razorpayOrderId: existing.razorpayOrderId,
          amount: existingPayable,
          currency: "INR",
        });
      }
      // Different payable amount: create new Razorpay order and store it
      if (existing.paymentMethod === "RAZORPAY") {
        const razorpay = getRazorpay();
        const payableAmount = Math.max(0, total - (existing.storeCreditApplied || 0));
        const newRzpOrder = await razorpay.orders.create({
          amount: payableAmount,
          currency: "INR",
          receipt: existing.displayId,
        });
        await prisma.order.update({
          where: { id: existing.id },
          data: { razorpayOrderId: newRzpOrder.id },
        });
        return NextResponse.json({
          orderId: existing.id,
          razorpayOrderId: newRzpOrder.id,
          amount: payableAmount,
          currency: "INR",
        });
      }
    }
    if (existing.status === "FAILED" || existing.status === "CANCELLED") {
      return NextResponse.json({ error: "This checkout expired", retry: true }, { status: 409 });
    }
    return null;
  };

  const existingOrder = await prisma.order.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
    include: { items: true },
  });

  if (existingOrder) {
    const res = await checkExistingOrder(existingOrder);
    if (res) return res;
  }

  // 4. Create Order inside Transaction with guarded coupon increment, store credit debit, and strict stock reservation
  let createdOrder: (Order & { items: OrderItem[] }) | null = null;
  let payable = total;
  let storeCreditApplied = 0;
  let isZeroTotal = false;

  let retries = 5;
  while (retries > 0) {
    try {
      const displayId = generateDisplayId();

      createdOrder = await prisma.$transaction(async (tx) => {
        // 4a. Check coupon user reuse inside transaction
        if (appliedCouponCode) {
          const priorUserOrder = await tx.order.findFirst({
            where: {
              userId,
              couponCode: appliedCouponCode,
              status: { notIn: ["CANCELLED", "FAILED"] },
            },
          });
          if (priorUserOrder) {
            throw new CouponConflictError("You have already used this coupon code.");
          }

          const coupon = await tx.coupon.findUnique({
            where: { code: appliedCouponCode },
          });

          if (!coupon) {
            throw new CouponConflictError("Coupon no longer available");
          }

          if (coupon.expiresAt && coupon.expiresAt < new Date()) {
            throw new CouponConflictError("Coupon has expired");
          }

          if (coupon.usageLimit !== null) {
            const inc = await tx.coupon.updateMany({
              where: {
                id: coupon.id,
                timesUsed: { lt: coupon.usageLimit },
              },
              data: { timesUsed: { increment: 1 } },
            });
            if (inc.count === 0) {
              throw new CouponConflictError("Coupon usage limit has been reached");
            }
          } else {
            await tx.coupon.update({
              where: { id: coupon.id },
              data: { timesUsed: { increment: 1 } },
            });
          }
        }

        // 4b. Store credit debit inside transaction (never read outside)
        if (data.useStoreCredit) {
          const userRecord = await tx.user.findUnique({
            where: { id: userId },
            select: { storeCreditBalance: true },
          });
          const available = userRecord?.storeCreditBalance || 0;
          if (available > 0) {
            storeCreditApplied = Math.min(available, total);
            payable = total - storeCreditApplied;

            const debit = await tx.user.updateMany({
              where: {
                id: userId,
                storeCreditBalance: { gte: storeCreditApplied },
              },
              data: {
                storeCreditBalance: { decrement: storeCreditApplied },
              },
            });

            if (debit.count === 0) {
              throw new StoreCreditConflictError("Store credit changed, please retry");
            }
          }
        }

        isZeroTotal = payable === 0;
        const selectedPaymentMethod = isZeroTotal ? "STORE_CREDIT" : isCod ? "COD" : "RAZORPAY";
        const initialStatus = isZeroTotal ? "PAID" : "PENDING";

        // Create Order
        const newOrder = await tx.order.create({
          data: {
            displayId,
            idempotencyKey: data.idempotencyKey,
            userId,
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            customerEmail: data.customerEmail,
            shippingAddress: data.shippingAddress,
            subtotal,
            shippingFee,
            total,
            storeCreditApplied,
            couponCode: appliedCouponCode,
            discountAmount: discountAmount || null,
            giftMessage: data.giftMessage?.trim() || null,
            status: initialStatus,
            paymentMethod: selectedPaymentMethod,
            items: {
              create: orderItemsData.map((i) => ({
                productId: i.productId,
                variantId: i.variantId,
                name: i.name,
                size: i.size as Size,
                unitPrice: i.unitPrice,
                qty: i.qty,
              })),
            },
          },
          include: { items: true },
        });

        // Record store credit transaction if applied
        if (storeCreditApplied > 0) {
          await tx.storeCreditTransaction.create({
            data: {
              userId,
              amount: -storeCreditApplied,
              reason: isZeroTotal
                ? `Full payment for Order #${displayId}`
                : `Partial store credit applied to Order #${displayId}`,
              relatedOrderId: newOrder.id,
            },
          });
        }

        // 4c. COD and zero-total store-credit orders: reserveStock strictly inside same transaction
        if (isCod || isZeroTotal) {
          await reserveStock(
            tx,
            orderItemsData.map((i) => ({ variantId: i.variantId, qty: i.qty })),
            isCod ? "COD_PLACED" : "STORE_CREDIT_PLACED",
            { refType: "Order", refId: newOrder.id }
          );

          await tx.order.update({
            where: { id: newOrder.id },
            data: { stockDeducted: true },
          });
        }

        if (isZeroTotal) {
          await tx.orderStatusEvent.create({
            data: {
              orderId: newOrder.id,
              status: "PAID",
              note: `Paid in full using Store Credit (₹${(storeCreditApplied / 100).toFixed(2)})`,
            },
          });
        }

        return newOrder;
      });

      break; // Transaction succeeded
    } catch (err: unknown) {
      if (err instanceof StoreCreditConflictError || err instanceof CouponConflictError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }

      if (err instanceof InsufficientStockError) {
        return NextResponse.json(
          { error: "One or more items in your cart is no longer available" },
          { status: 409 }
        );
      }

      // Handle unique constraint conflict (P2002)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta as { target?: unknown })?.target;
        // If conflict is on idempotencyKey, re-read and answer
        if (Array.isArray(target) && target.includes("idempotencyKey")) {
          const reRead = await prisma.order.findUnique({
            where: { idempotencyKey: data.idempotencyKey },
            include: { items: true },
          });
          if (reRead) {
            const res = await checkExistingOrder(reRead);
            if (res) return res;
          }
        }
        // If conflict is on displayId, decrement retry and loop
        retries--;
        if (retries === 0) {
          return NextResponse.json({ error: "Failed to generate order ID, please try again" }, { status: 500 });
        }
        continue;
      }

      console.error("Order creation transaction error:", err);
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
  }

  if (!createdOrder) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  // 5. Zero-total order paid completely with store credit
  if (isZeroTotal) {
    const { sendOrderConfirmationEmail } = await import("@/lib/email");
    sendOrderConfirmationEmail(createdOrder.id).catch(console.error);

    return NextResponse.json({
      orderId: createdOrder.id,
      isStoreCredit: true,
      payableAmount: 0,
      currency: "INR",
    });
  }

  // 6. COD Order response
  if (isCod) {
    return NextResponse.json({
      orderId: createdOrder.id,
      isCod: true,
      amount: payable,
      currency: "INR",
    });
  }

  // 7. Razorpay Order: create after DB transaction commits
  try {
    const razorpay = getRazorpay();
    const rzpOrder = await razorpay.orders.create({
      amount: payable,
      currency: "INR",
      receipt: createdOrder.displayId,
    });

    await prisma.order.update({
      where: { id: createdOrder.id },
      data: { razorpayOrderId: rzpOrder.id },
    });

    return NextResponse.json({
      orderId: createdOrder.id,
      razorpayOrderId: rzpOrder.id,
      amount: payable,
      currency: "INR",
    });
  } catch (rzpErr) {
    console.error("Razorpay order creation failed:", rzpErr);
    await prisma.$transaction(async (tx) => {
      await failOrder(tx, createdOrder, "Payment provider unavailable during checkout");
    });
    return NextResponse.json(
      { error: "Payment provider unavailable, please try again" },
      { status: 502 }
    );
  }
}
