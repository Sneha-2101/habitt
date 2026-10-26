import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { generateDisplayId } from "@/lib/money";
import { auth } from "@/lib/auth";
import { validateCoupon } from "@/lib/actions/coupons";
import { isEligibleForCod } from "@/lib/actions/cod-eligibility";
import { getSettings } from "@/lib/settings";

interface CartItemInput {
  productId: string;
  variantId: string;
  size: string;
  qty: number;
}

interface CreateOrderBody {
  orderId?: string;
  paymentMethod?: "RAZORPAY" | "COD";
  useStoreCredit?: boolean;
  items: CartItemInput[];
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  couponCode?: string;
  giftMessage?: string;
  shippingAddress: { line1: string; line2?: string; city: string; state: string; pincode: string };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required to check out" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const body = (await req.json()) as CreateOrderBody;

  if (!userId) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 401 });
  }

  if (!body.items?.length) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  // Fetch current user details for store credit verification
  const currentUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeCreditBalance: true },
  });

  const availableCredit = currentUser?.storeCreditBalance || 0;

  // Re-price every item from the database. Never trust amounts sent by the client.
  const products = await prisma.product.findMany({
    where: { id: { in: body.items.map((i) => i.productId) } },
    include: { variants: true },
  });

  let subtotal = 0;
  const orderItemsData = body.items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants.find((v) => v.id === item.variantId);
    if (!product || !variant) throw new Error(`Product/variant not found: ${item.productId}`);
    if (variant.stock < item.qty) throw new Error(`Insufficient stock for ${product.name} (${item.size})`);

    subtotal += product.price * item.qty;
    return {
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      size: variant.size,
      unitPrice: product.price,
      qty: item.qty,
    };
  });

  const settings = await getSettings();

  const isCod = body.paymentMethod === "COD";

  // Re-verify COD eligibility server-side if client requested COD
  if (isCod) {
    const eligibility = await isEligibleForCod(userId, subtotal);
    if (!eligibility.eligible) {
      return NextResponse.json({ error: eligibility.message || "COD is not available for this order" }, { status: 400 });
    }
  }

  const shippingFee = subtotal >= settings.freeShippingThreshold ? 0 : settings.shippingFee;
  const codSurcharge = (isCod && settings.codFeeEnabled) ? settings.codFee : 0;

  let discountAmount = 0;
  let appliedCouponCode: string | undefined = undefined;

  if (body.couponCode?.trim()) {
    try {
      const res = await validateCoupon(body.couponCode, subtotal);
      if (res.valid) {
        discountAmount = res.discountAmount;
        appliedCouponCode = res.code;
        await prisma.coupon.update({
          where: { code: res.code },
          data: { timesUsed: { increment: 1 } },
        });
      }
    } catch (err) {
      console.warn("Coupon application skipped:", err);
    }
  }

  const total = Math.max(0, subtotal - discountAmount + shippingFee + codSurcharge);
  const giftMessage = body.giftMessage?.trim() || undefined;

  // Calculate store credit application
  let storeCreditApplied = 0;
  if (body.useStoreCredit && availableCredit > 0) {
    storeCreditApplied = Math.min(availableCredit, total);
  }

  const payable = total - storeCreditApplied;
  const isZeroTotal = payable === 0;

  let order;
  const displayId = generateDisplayId();
  const selectedPaymentMethod = isZeroTotal ? "STORE_CREDIT" : isCod ? "COD" : "RAZORPAY";
  const initialOrderStatus = isZeroTotal ? "PAID" : "PENDING";

  order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        displayId,
        userId,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail,
        shippingAddress: body.shippingAddress,
        subtotal,
        shippingFee,
        total,
        storeCreditApplied,
        couponCode: appliedCouponCode,
        discountAmount: discountAmount || null,
        giftMessage,
        status: initialOrderStatus,
        paymentMethod: selectedPaymentMethod,
        items: { create: orderItemsData },
      },
    });

    // Debit store credit if applied
    if (storeCreditApplied > 0) {
      await tx.user.update({
        where: { id: userId },
        data: { storeCreditBalance: { decrement: storeCreditApplied } },
      });

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

    // Decrement stock immediately for COD or zero-total paid with store credit
    if (isCod || isZeroTotal) {
      for (const item of orderItemsData) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.qty } },
        });
      }
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

  // Zero-total order paid completely with store credit
  if (isZeroTotal) {
    const { sendOrderConfirmationEmail } = await import("@/lib/email");
    sendOrderConfirmationEmail(order.id).catch(console.error);

    return NextResponse.json({
      orderId: order.id,
      isStoreCredit: true,
      payableAmount: 0,
      currency: "INR",
    });
  }

  // If COD, skip Razorpay API calls
  if (isCod) {
    return NextResponse.json({
      orderId: order.id,
      isCod: true,
      amount: payable,
      currency: "INR",
    });
  }

  const razorpay = getRazorpay();
  const rzpOrder = await razorpay.orders.create({
    amount: payable,
    currency: "INR",
    receipt: order.displayId,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { razorpayOrderId: rzpOrder.id },
  });

  return NextResponse.json({
    orderId: order.id,
    razorpayOrderId: rzpOrder.id,
    amount: payable,
    currency: "INR",
  });
}
