import crypto from "crypto";
import { NextResponse } from "next/server";
import { Prisma, Order, OrderItem, PaymentStatus, FulfilmentStatus, PaymentMethod, OrderDiscountKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { getSessionUser } from "@/lib/sessions";
import { reserveStock, InsufficientStockError } from "@/lib/stock";
import { failOrder } from "@/lib/orders/fail-order";
import { limit } from "@/lib/ratelimit";
import { calculateQuote } from "@/lib/pricing/quote";
import { debitWallet, getWalletBalance } from "@/lib/wallet/service";
import { getSettings } from "@/lib/settings";
import { z } from "zod";

class StoreCreditConflictError extends Error {
  constructor(message = "Store credit changed, please retry") {
    super(message);
    this.name = "StoreCreditConflictError";
  }
}

class OfferConflictError extends Error {
  code: string;
  constructor(code = "OFFER_LIMIT_REACHED", message = "Offer is no longer available") {
    super(message);
    this.name = "OfferConflictError";
    this.code = code;
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
      return NextResponse.json({ error: w.message, code: "MAX_QTY_EXCEEDED" }, { status: 400 });
    }
    if (w.type === "ITEM_UNAVAILABLE" || w.type === "STOCK_EXCEEDED") {
      return NextResponse.json({ error: w.message, code: w.code || "STOCK_EXCEEDED" }, { status: 409 });
    }
    if (w.type === "INVALID_COUPON") {
      const isLimit = w.code === "COUPON_LIMIT_REACHED" || w.code === "OFFER_LIMIT_REACHED";
      const status = isLimit ? 409 : 400;
      return NextResponse.json({ error: w.message, code: w.code || "INVALID_COUPON" }, { status });
    }
    if (w.type === "EMPTY_CART") {
      return NextResponse.json({ error: w.message, code: "EMPTY_CART" }, { status: 400 });
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
  const appliedCouponCode =
    quote.couponResult?.accepted && data.couponCode
      ? data.couponCode.trim().toUpperCase()
      : discountAmount > 0 && data.couponCode
      ? data.couponCode.trim().toUpperCase()
      : undefined;
  const total = quote.total;
  const orderItemsData = quote.items;

  // 3. Idempotency Check: look up the order by idempotencyKey
  const checkExistingOrder = async (existing: {
    userId: string;
    paymentStatus: PaymentStatus;
    fulfilmentStatus: FulfilmentStatus;
    total: number;
    storeCreditApplied?: number | null;
    razorpayOrderId?: string | null;
    displayId: string;
    paymentMethod: PaymentMethod;
    id: string;
  }) => {
    if (existing.userId !== userId) {
      return NextResponse.json({ error: "Idempotency key belongs to another user" }, { status: 409 });
    }
    if (existing.fulfilmentStatus === "CANCELLED" || existing.paymentStatus === "FAILED") {
      return NextResponse.json({ error: "This checkout expired", retry: true }, { status: 409 });
    }
    if (existing.paymentStatus === "PAID") {
      return NextResponse.json({ alreadyPaid: true, orderId: existing.id });
    }
    if (existing.paymentStatus === "PENDING" || existing.paymentStatus === "COD_PENDING") {
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

  // 4. Create Order inside Transaction with guarded offer limit checks, store credit debit, and strict stock reservation
  let createdOrder: (Order & { items: OrderItem[] }) | null = null;
  let payable = total;
  let storeCreditApplied = 0;
  let isZeroTotal = false;

  let retries = 5;
  while (retries > 0) {
    try {
      const displayId = generateDisplayId();

      createdOrder = await prisma.$transaction(async (tx) => {
        // 4a. Re-check usage limits per applied offer inside transaction (atomic update/check)
        const candidateOffers = new Map<string, { offerId: string; amountPaise: number }>();
        for (const applied of quote.appliedOffers) {
          if (applied.offerId) {
            const existing = candidateOffers.get(applied.offerId);
            candidateOffers.set(applied.offerId, {
              offerId: applied.offerId,
              amountPaise: (existing?.amountPaise || 0) + applied.amountPaise,
            });
          }
        }
        for (const g of quote.gifts) {
          if (g.offerId && !candidateOffers.has(g.offerId)) {
            candidateOffers.set(g.offerId, { offerId: g.offerId, amountPaise: 0 });
          }
        }

        for (const item of candidateOffers.values()) {
          const offer = await tx.offer.findUnique({
            where: { id: item.offerId },
          });

          if (!offer || !offer.active) {
            throw new OfferConflictError("OFFER_LIMIT_REACHED", "Offer is no longer available");
          }

          if (offer.endsAt && offer.endsAt < new Date()) {
            throw new OfferConflictError("OFFER_LIMIT_REACHED", "Offer has expired");
          }

          if (item.amountPaise > 0) {
            const count = await tx.$executeRaw`
              UPDATE "Offer"
              SET "timesUsed" = "timesUsed" + 1
              WHERE "id" = ${offer.id}
                AND "active" = true
                AND ("maxUsesTotal" IS NULL OR "timesUsed" < "maxUsesTotal")
            `;
            if (count === 0) {
              throw new OfferConflictError("OFFER_LIMIT_REACHED", "Offer total usage limit has been reached");
            }
          }

          if (offer.maxUsesPerCustomer !== null && userId) {
            await tx.$queryRaw`SELECT "id" FROM "Offer" WHERE "id" = ${offer.id} FOR UPDATE`;
            const customerUses = await tx.offerRedemption.count({
              where: {
                userId,
                offerId: offer.id,
                order: {
                  paymentStatus: { not: "FAILED" },
                  fulfilmentStatus: { not: "CANCELLED" },
                },
              },
            });
            if (customerUses >= offer.maxUsesPerCustomer) {
              throw new OfferConflictError(
                "OFFER_LIMIT_REACHED",
                offer.code ? "You have already used this coupon code." : "You have reached the usage limit for this offer"
              );
            }
          }
        }

        // 4b. Compute store credit cap inside transaction (debit happens after order row creation so orderId is linked)
        if (data.useStoreCredit) {
          const [available, siteSettings] = await Promise.all([
            getWalletBalance(tx, userId),
            getSettings(),
          ]);
          if (available > 0) {
            const maxPct = siteSettings.walletMaxPercentOfOrder ?? 100;
            const walletCap = Math.floor((total * maxPct) / 100);
            storeCreditApplied = Math.min(available, walletCap, total);
            payable = total - storeCreditApplied;
          }
        }

        isZeroTotal = payable === 0;
        const selectedPaymentMethod: PaymentMethod = isZeroTotal
          ? "STORE_CREDIT"
          : isCod
          ? "COD"
          : "RAZORPAY";
        const initialPaymentStatus: PaymentStatus = isZeroTotal
          ? "PAID"
          : isCod
          ? "COD_PENDING"
          : "PENDING";
        const initialFulfilmentStatus: FulfilmentStatus = isZeroTotal
          ? "PLACED"
          : isCod
          ? "PLACED"
          : "CREATED";

        // Prepare OrderItem data: normal lines with discountPaise + stock gifts
        const lineItemsToCreate: {
          productId: string;
          variantId: string;
          name: string;
          size: string;
          color: string;
          sku: string | null;
          unitPrice: number;
          qty: number;
          discountPaise: number;
          isGift: boolean;
        }[] = orderItemsData.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          name: i.name,
          size: i.size,
          color: i.color ?? "",
          sku: i.sku ?? null,
          unitPrice: i.unitPrice,
          qty: i.qty,
          discountPaise: i.discountPaise || 0,
          isGift: false,
        }));

        // Stock gifts: variant gifts become 0-rupee lines with isGift true
        const giftVariantItems: typeof lineItemsToCreate = [];
        for (const g of quote.gifts) {
          if (g.type === "VARIANT" && g.variantId) {
            const v = await tx.productVariant.findUnique({
              where: { id: g.variantId },
              include: { product: true },
            });
            if (v && v.stock >= g.qty) {
              giftVariantItems.push({
                productId: v.productId,
                variantId: v.id,
                name: v.product.name,
                size: v.size,
                color: v.color || "",
                sku: v.sku || null,
                unitPrice: 0,
                qty: g.qty,
                discountPaise: 0,
                isGift: true,
              });
            }
          }
        }

        const allItemsToCreate = [...lineItemsToCreate, ...giftVariantItems];

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
            codFee: quote.codFee || 0,
            total,
            storeCreditApplied,
            couponCode: appliedCouponCode,
            discountAmount: discountAmount || null,
            giftMessage: data.giftMessage?.trim() || null,
            paymentStatus: initialPaymentStatus,
            fulfilmentStatus: initialFulfilmentStatus,
            paymentMethod: selectedPaymentMethod,
            items: {
              create: allItemsToCreate,
            },
          },
          include: { items: true },
        });

        // Write OrderDiscount rows
        for (const applied of quote.appliedOffers) {
          let kind: OrderDiscountKind = applied.kind as OrderDiscountKind;
          if (appliedCouponCode && (applied.kind === "PERCENT_OFF" || applied.kind === "FLAT_OFF")) {
            kind = applied.kind === "PERCENT_OFF" ? "COUPON_PERCENT" : "COUPON_FLAT";
          }

          await tx.orderDiscount.create({
            data: {
              orderId: newOrder.id,
              offerId: applied.offerId,
              label: applied.label,
              kind,
              amountPaise: applied.amountPaise,
            },
          });
        }

        // Text gift OrderDiscount rows
        for (const g of quote.gifts) {
          if (g.type === "TEXT" && g.text) {
            await tx.orderDiscount.create({
              data: {
                orderId: newOrder.id,
                offerId: g.offerId,
                label: g.label,
                kind: "GIFT_TEXT",
                amountPaise: 0,
              },
            });
          } else if (g.type === "VARIANT" && g.variantId) {
            const giftItem = newOrder.items.find((item) => item.isGift && item.variantId === g.variantId);
            await tx.orderDiscount.create({
              data: {
                orderId: newOrder.id,
                offerId: g.offerId,
                label: g.label,
                kind: "GIFT_STOCK",
                amountPaise: 0,
                orderItemId: giftItem?.id || null,
              },
            });
          }
        }

        // Write OfferRedemption rows (unique offerId + orderId)
        const redeemedOfferMap = new Map<string, number>();
        for (const a of quote.appliedOffers) {
          redeemedOfferMap.set(a.offerId, (redeemedOfferMap.get(a.offerId) || 0) + a.amountPaise);
        }
        for (const g of quote.gifts) {
          if (!redeemedOfferMap.has(g.offerId)) {
            redeemedOfferMap.set(g.offerId, 0);
          }
        }

        for (const [offerId, amountPaise] of redeemedOfferMap.entries()) {
          await tx.offerRedemption.create({
            data: {
              offerId,
              orderId: newOrder.id,
              userId: userId || null,
              amountPaise,
            },
          });
        }

        // Debit wallet inside the same transaction
        if (storeCreditApplied > 0) {
          try {
            await debitWallet(
              {
                userId,
                amountPaise: storeCreditApplied,
                orderId: newOrder.id,
                reason: isZeroTotal
                  ? `Full payment for Order #${displayId}`
                  : `Partial store credit applied to Order #${displayId}`,
                idempotencyKey: `order:${newOrder.id}:wallet`,
              },
              tx
            );
          } catch (err) {
            if (err instanceof Error && err.message.includes("Insufficient wallet balance")) {
              throw new StoreCreditConflictError("Store credit changed, please retry");
            }
            throw err;
          }
        }

        // 4c. COD and zero-total store-credit orders: reserveStock strictly inside same transaction
        if (isCod || isZeroTotal) {
          await reserveStock(
            tx,
            allItemsToCreate.map((i) => ({ variantId: i.variantId, qty: i.qty })),
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
              paymentStatus: "PAID",
              fulfilmentStatus: "PLACED",
              note: `Paid in full using Store Credit (₹${(storeCreditApplied / 100).toFixed(2)})`,
            },
          });
        }

        return newOrder;
      });

      break; // Transaction succeeded
    } catch (err: unknown) {
      if (err instanceof StoreCreditConflictError) {
        return NextResponse.json({ error: err.message, code: "STORE_CREDIT_CONFLICT" }, { status: 409 });
      }

      if (err instanceof OfferConflictError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
      }

      if (err instanceof InsufficientStockError) {
        return NextResponse.json(
          { error: "One or more items in your cart is no longer available", code: "INSUFFICIENT_STOCK" },
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
