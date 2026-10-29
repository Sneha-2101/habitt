import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isEligibleForCod } from "@/lib/actions/cod-eligibility";
import { calcShippingAndFees, ShippingNote } from "@/lib/pricing/shipping";
import { validateCoupon } from "@/lib/actions/coupons";
import { PaymentMethod } from "@prisma/client";

export interface QuoteItemInput {
  productId: string;
  variantId: string;
  qty: number;
}

export interface QuoteParams {
  userId: string;
  items: QuoteItemInput[];
  paymentMethod?: PaymentMethod | "RAZORPAY" | "COD";
  couponCode?: string | null;
  useStoreCredit?: boolean;
}

export interface QuoteItemDetail {
  productId: string;
  variantId: string;
  name: string;
  size: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

export interface QuoteWarning {
  type: "ITEM_UNAVAILABLE" | "STOCK_EXCEEDED" | "MAX_QTY_EXCEEDED" | "INVALID_COUPON" | "EMPTY_CART";
  message: string;
  productId?: string;
  variantId?: string;
}

export interface QuoteResult {
  items: QuoteItemDetail[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  codFee: number;
  shippingNote: ShippingNote;
  total: number;
  storeCreditApplied: number;
  payable: number;
  cod: {
    eligible: boolean;
    reason?: string;
  };
  warnings: QuoteWarning[];
}

export async function calculateQuote({
  userId,
  items,
  paymentMethod = "RAZORPAY",
  couponCode,
  useStoreCredit = false,
}: QuoteParams): Promise<QuoteResult> {
  const warnings: QuoteWarning[] = [];

  if (!items || items.length === 0) {
    warnings.push({ type: "EMPTY_CART", message: "Cart cannot be empty" });
    const codCheck = await isEligibleForCod(userId, 0);
    return {
      items: [],
      subtotal: 0,
      discount: 0,
      shippingFee: 0,
      codFee: 0,
      shippingNote: "NONE",
      total: 0,
      storeCreditApplied: 0,
      payable: 0,
      cod: {
        eligible: codCheck.eligible,
        reason: codCheck.message || codCheck.reason,
      },
      warnings,
    };
  }

  // 1. Merge duplicate variantIds (sum qty; merged qty must still be <= 10)
  const mergedMap = new Map<string, { productId: string; variantId: string; qty: number }>();
  for (const item of items) {
    if (!item.variantId || !item.productId || typeof item.qty !== "number" || item.qty <= 0) continue;
    const existing = mergedMap.get(item.variantId);
    if (existing) {
      existing.qty += item.qty;
    } else {
      mergedMap.set(item.variantId, { ...item });
    }
  }

  for (const item of mergedMap.values()) {
    if (item.qty > 10) {
      warnings.push({
        type: "MAX_QTY_EXCEEDED",
        message: "Maximum quantity per item is 10",
        productId: item.productId,
        variantId: item.variantId,
      });
    }
  }

  const mergedItems = Array.from(mergedMap.values());

  // 2. Load products with status "ACTIVE" only
  const productIds = Array.from(new Set(mergedItems.map((i) => i.productId)));
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      status: "ACTIVE",
    },
    include: { variants: true },
  });

  let subtotal = 0;
  const orderItemsData: QuoteItemDetail[] = [];

  for (const item of mergedItems) {
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants.find((v) => v.id === item.variantId);

    if (!product || !variant) {
      warnings.push({
        type: "ITEM_UNAVAILABLE",
        message: "Item is no longer available",
        productId: item.productId,
        variantId: item.variantId,
      });
      continue;
    }

    if (variant.stock < item.qty) {
      warnings.push({
        type: "STOCK_EXCEEDED",
        message: `${product.name} (${variant.size}) is no longer available`,
        productId: item.productId,
        variantId: item.variantId,
      });
    }

    const lineTotal = product.price * item.qty;
    subtotal += lineTotal;
    orderItemsData.push({
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      size: variant.size,
      unitPrice: product.price,
      qty: item.qty,
      lineTotal,
    });
  }

  // 3. Coupon discount validation (validate only, never increment usage)
  let discount = 0;
  if (couponCode && couponCode.trim().length > 0) {
    try {
      const couponRes = await validateCoupon(couponCode, subtotal);
      if (couponRes.valid) {
        if (userId) {
          const priorOrder = await prisma.order.findFirst({
            where: {
              userId,
              couponCode: couponRes.code,
              status: { notIn: ["CANCELLED", "FAILED"] },
            },
          });
          if (priorOrder) {
            warnings.push({
              type: "INVALID_COUPON",
              message: "You have already used this coupon code.",
            });
          } else {
            discount = couponRes.discountAmount;
          }
        } else {
          discount = couponRes.discountAmount;
        }
      } else {
        warnings.push({
          type: "INVALID_COUPON",
          message: "Invalid coupon",
        });
      }
    } catch (couponErr: unknown) {
      warnings.push({
        type: "INVALID_COUPON",
        message: couponErr instanceof Error ? couponErr.message : "Invalid coupon",
      });
    }
  }

  // 4. Settings & COD eligibility
  const settings = await getSettings();
  const codCheck = await isEligibleForCod(userId, subtotal);
  const cod = {
    eligible: codCheck.eligible,
    reason: codCheck.message || codCheck.reason,
  };

  // 5. Store credit balance lookup (read-only)
  let availableStoreCredit = 0;
  if (useStoreCredit && userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { storeCreditBalance: true },
    });
    availableStoreCredit = user?.storeCreditBalance || 0;
  }

  // 6. Fees and shipping calculation
  let effectiveMethod = paymentMethod;
  // If user selected COD but store credit covers entire subtotal - discount, effective method is STORE_CREDIT
  if (useStoreCredit && availableStoreCredit > 0 && availableStoreCredit >= (subtotal - discount)) {
    effectiveMethod = "STORE_CREDIT";
  }

  const { shippingFee, codFee, shippingNote } = calcShippingAndFees({
    paymentMethod: effectiveMethod,
    subtotal,
    settings,
  });

  const total = Math.max(0, subtotal - discount + shippingFee + codFee);
  let storeCreditApplied = 0;

  if (useStoreCredit && availableStoreCredit > 0) {
    storeCreditApplied = Math.min(availableStoreCredit, total);
  }

  const payable = Math.max(0, total - storeCreditApplied);

  return {
    items: orderItemsData,
    subtotal,
    discount,
    shippingFee,
    codFee,
    shippingNote,
    total,
    storeCreditApplied,
    payable,
    cod,
    warnings,
  };
}
