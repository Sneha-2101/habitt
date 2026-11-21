import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { isEligibleForCod } from "@/lib/actions/cod-eligibility";
import { calcShippingAndFees, ShippingNote } from "@/lib/pricing/shipping";
import { PaymentMethod } from "@prisma/client";
import {
  evaluateOffers,
  OfferKind,
  CouponEvaluationResult,
} from "@/lib/offers/evaluate";
import { loadOfferEvaluationData, enrichCartLines } from "@/lib/offers/load";

export interface QuoteItemInput {
  productId: string;
  variantId: string;
  qty: number;
}

export interface QuoteParams {
  userId?: string | null;
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
  color?: string;
  sku?: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  discountPaise: number;
}

export interface AppliedOfferSummary {
  offerId: string;
  kind: OfferKind;
  label: string;
  amountPaise: number;
  lineIds: string[];
}

export interface GiftSummary {
  offerId: string;
  label: string;
  qty: number;
  type: "VARIANT" | "TEXT";
  variantId?: string;
  text?: string;
}

export interface QuoteWarning {
  type:
    | "ITEM_UNAVAILABLE"
    | "STOCK_EXCEEDED"
    | "MAX_QTY_EXCEEDED"
    | "INVALID_COUPON"
    | "EMPTY_CART"
    | "CAP_APPLIED"
    | "COST_FLOOR_APPLIED"
    | "COUPON_NOT_BETTER"
    | "GIFT_OUT_OF_STOCK"
    | string;
  code?: string;
  message: string;
  productId?: string;
  variantId?: string;
  offerId?: string;
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
  appliedOffers: AppliedOfferSummary[];
  gifts: GiftSummary[];
  couponResult?: CouponEvaluationResult;
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
    warnings.push({ type: "EMPTY_CART", code: "EMPTY_CART", message: "Cart cannot be empty" });
    const codCheck = await isEligibleForCod(userId || "", 0);
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
      appliedOffers: [],
      gifts: [],
    };
  }

  // 1. Merge duplicate variantIds (sum qty; max 10 per variant)
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
        code: "MAX_QTY_EXCEEDED",
        message: "Maximum quantity per item is 10",
        productId: item.productId,
        variantId: item.variantId,
      });
    }
  }

  const mergedItems = Array.from(mergedMap.values());

  // (1) Sale prices & load active products
  const productIds = Array.from(new Set(mergedItems.map((i) => i.productId)));
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      status: "ACTIVE",
    },
    include: { variants: true },
  });

  let preDiscountSubtotal = 0;
  const validOrderItemsData: {
    lineId: string;
    productId: string;
    variantId: string;
    name: string;
    size: string;
    color?: string;
    sku?: string | null;
    unitPrice: number;
    qty: number;
    lineTotal: number;
  }[] = [];

  for (const item of mergedItems) {
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants.find((v) => v.id === item.variantId);

    if (!product || !variant) {
      warnings.push({
        type: "ITEM_UNAVAILABLE",
        code: "ITEM_UNAVAILABLE",
        message: "Item is no longer available",
        productId: item.productId,
        variantId: item.variantId,
      });
      continue;
    }

    if (variant.stock < item.qty) {
      warnings.push({
        type: "STOCK_EXCEEDED",
        code: "STOCK_EXCEEDED",
        message: `${product.name} (${variant.size}) is no longer available`,
        productId: item.productId,
        variantId: item.variantId,
      });
    }

    const lineTotal = product.price * item.qty;
    preDiscountSubtotal += lineTotal;

    validOrderItemsData.push({
      lineId: variant.id,
      productId: product.id,
      variantId: variant.id,
      name: product.name,
      size: variant.size,
      color: variant.color,
      sku: variant.sku,
      unitPrice: product.price,
      qty: item.qty,
      lineTotal,
    });
  }

  const settings = await getSettings();

  // (2), (3), (4): Offers Evaluation (Automatic offers, combos, tiers, gifts, exclusive coupon, global cap, cost floor)
  const now = new Date();
  const offerData = await loadOfferEvaluationData({
    userId,
    productIds,
    couponCode,
    now,
  });

  if (couponCode && couponCode.trim().length > 0 && !offerData.couponOffer) {
    warnings.push({
      type: "INVALID_COUPON",
      code: "INVALID_COUPON",
      message: "Invalid coupon code.",
    });
  }

  const enrichedLines = enrichCartLines(
    validOrderItemsData.map((item) => ({
      lineId: item.lineId,
      productId: item.productId,
      variantId: item.variantId,
      unitPricePaise: item.unitPrice,
      qty: item.qty,
    })),
    offerData.cartLineEnrichment
  );

  const discountCapPercent =
    "discountCapPercent" in settings
      ? ((settings as Record<string, unknown>).discountCapPercent as number | null)
      : null;

  const evalResult = evaluateOffers({
    lines: enrichedLines,
    offers: offerData.offers,
    audienceContext: offerData.audienceContext,
    usageCounts: offerData.usageCounts,
    couponOffer: offerData.couponOffer,
    settings: {
      discountCapPercent: discountCapPercent ?? null,
    },
    now,
  });

  // Transfer warnings from engine
  for (const w of evalResult.warnings) {
    if (w.code === "COUPON_NOT_BETTER") {
      warnings.push({
        type: "COUPON_NOT_BETTER",
        code: "COUPON_NOT_BETTER",
        message: w.message || "Automatic offers give a better discount than coupon",
        offerId: w.offerId,
      });
    } else if (w.code === "CAP_APPLIED") {
      warnings.push({
        type: "CAP_APPLIED",
        code: "CAP_APPLIED",
        message: w.message || "Global discount cap applied",
      });
    } else if (w.code === "COST_FLOOR_APPLIED") {
      warnings.push({
        type: "COST_FLOOR_APPLIED",
        code: "COST_FLOOR_APPLIED",
        message: "Cost floor applied to protect item price",
      });
    }
  }

  if (evalResult.couponResult && !evalResult.couponResult.accepted && evalResult.couponResult.rejectionCode !== "COUPON_NOT_BETTER") {
    warnings.push({
      type: "INVALID_COUPON",
      code: evalResult.couponResult.rejectionCode || "INVALID_COUPON",
      message: evalResult.couponResult.rejectionReason || "Invalid coupon",
    });
  }

  // Check gift stock (Rule 7: variant gift stock check)
  const finalGifts: GiftSummary[] = [];
  const variantGiftIds = evalResult.gifts
    .filter((g) => g.type === "VARIANT" && g.variantId)
    .map((g) => g.variantId as string);

  let giftVariants: { id: string; stock: number; size: string; color: string; product: { name: string } }[] = [];
  if (variantGiftIds.length > 0) {
    giftVariants = await prisma.productVariant.findMany({
      where: { id: { in: variantGiftIds } },
      select: {
        id: true,
        stock: true,
        size: true,
        color: true,
        product: { select: { name: true } },
      },
    });
  }

  for (const g of evalResult.gifts) {
    if (g.type === "VARIANT" && g.variantId) {
      const v = giftVariants.find((gv) => gv.id === g.variantId);
      if (!v || v.stock <= 0) {
        warnings.push({
          type: "GIFT_OUT_OF_STOCK",
          code: "GIFT_OUT_OF_STOCK",
          message: "Free gift is currently out of stock",
          offerId: g.offerId,
          variantId: g.variantId,
        });
      } else {
        const colorPart = v.color ? `, ${v.color}` : "";
        finalGifts.push({
          offerId: g.offerId,
          label: `${v.product.name} (${v.size}${colorPart})`,
          qty: g.qty,
          type: "VARIANT",
          variantId: g.variantId,
        });
      }
    } else if (g.type === "TEXT" && g.text) {
      finalGifts.push({
        offerId: g.offerId,
        label: g.text,
        qty: g.qty,
        type: "TEXT",
        text: g.text,
      });
    }
  }

  // Map per-line discountPaise
  const lineDiscountMap = new Map<string, number>();
  for (const l of evalResult.lines) {
    lineDiscountMap.set(l.lineId, l.discountPaise);
  }

  const finalOrderItems: QuoteItemDetail[] = validOrderItemsData.map((item) => ({
    ...item,
    discountPaise: lineDiscountMap.get(item.lineId) || 0,
  }));

  const totalDiscount = evalResult.totalDiscountPaise;
  const postDiscountSubtotal = Math.max(0, preDiscountSubtotal - totalDiscount);

  // (5) Shipping with free-shipping threshold on POST-discount subtotal
  // (6) Prepaid incentive = free shipping
  // (7) COD fee and COD eligibility
  let availableStoreCredit = 0;
  if (useStoreCredit && userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { storeCreditBalance: true },
    });
    availableStoreCredit = user?.storeCreditBalance || 0;
  }

  let effectiveMethod = paymentMethod;
  if (useStoreCredit && availableStoreCredit > 0 && availableStoreCredit >= postDiscountSubtotal) {
    effectiveMethod = "STORE_CREDIT";
  }

  const { shippingFee, codFee, shippingNote } = calcShippingAndFees({
    paymentMethod: effectiveMethod,
    subtotal: postDiscountSubtotal, // Post-discount subtotal as required by Rule 5
    settings,
  });

  const codCheck = await isEligibleForCod(userId || "", postDiscountSubtotal);
  const cod = {
    eligible: codCheck.eligible,
    reason: codCheck.message || codCheck.reason,
  };

  // (8) Store credit as last tender
  const orderTotalWithFees = Math.max(0, postDiscountSubtotal + shippingFee + codFee);
  let storeCreditApplied = 0;
  if (useStoreCredit && availableStoreCredit > 0) {
    storeCreditApplied = Math.min(availableStoreCredit, orderTotalWithFees);
  }

  // (9) Final total
  const payable = Math.max(0, orderTotalWithFees - storeCreditApplied);

  const appliedOffers: AppliedOfferSummary[] = evalResult.applied.map((a) => ({
    offerId: a.offerId,
    kind: a.kind,
    label: a.label,
    amountPaise: a.amountPaise,
    lineIds: a.lineIds,
  }));

  return {
    items: finalOrderItems,
    subtotal: preDiscountSubtotal,
    discount: totalDiscount,
    shippingFee,
    codFee,
    shippingNote,
    total: orderTotalWithFees,
    storeCreditApplied,
    payable,
    cod,
    warnings,
    appliedOffers,
    gifts: finalGifts,
    couponResult: evalResult.couponResult,
  };
}
