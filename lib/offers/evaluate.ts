/**
 * Pure offer evaluation engine.
 * No database imports, no Next.js imports.
 * Evaluates automatic offers, combos, tiers, gifts, and exclusive coupons against cart lines.
 */

export type OfferKind =
  | "PERCENT_OFF"
  | "FLAT_OFF"
  | "TIER"
  | "COMBO_ANY"
  | "COMBO_SLOTS"
  | "GIFT";

export type OfferAudience = "ALL" | "FIRST_ORDER" | "BIRTHDAY";

export interface CartLineInput {
  lineId: string;
  productId: string;
  variantId: string;
  categoryId?: string | null;
  collectionIds?: string[];
  unitPricePaise: number;
  qty: number;
  costPaise?: number | null;
}

export interface OfferTargetShape {
  categoryId?: string | null;
  productId?: string | null;
  collectionId?: string | null;
}

export interface OfferShape {
  id: string;
  name: string;
  kind: OfferKind;
  code?: string | null;
  active: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  minCartPaise: number;
  maxUsesTotal?: number | null;
  maxUsesPerCustomer?: number | null;
  priority: number;
  audience: OfferAudience;
  config: Record<string, unknown>;
  targets: OfferTargetShape[];
}

export interface AudienceContext {
  isFirstOrder: boolean;
  isBirthdayWindow: boolean;
  userId?: string | null;
}

export interface OfferUsageRecord {
  total: number;
  byCustomer: number;
}

export interface EvaluateSettings {
  discountCapPercent?: number | null;
}

export interface EvaluateOffersInput {
  lines: CartLineInput[];
  offers: OfferShape[];
  audienceContext: AudienceContext;
  usageCounts?: Record<string, OfferUsageRecord> | Map<string, OfferUsageRecord>;
  couponOffer?: OfferShape | null;
  settings?: EvaluateSettings;
  now?: Date;
}

export interface EvaluatedOfferDiscount {
  offerId: string;
  kind: OfferKind;
  label: string;
  amountPaise: number;
  lineIds: string[];
}

export interface EvaluatedGift {
  offerId: string;
  type: "VARIANT" | "TEXT";
  variantId?: string;
  text?: string;
  qty: number;
}

export interface CouponEvaluationResult {
  accepted: boolean;
  code: string;
  rejectionCode?:
    | "COUPON_INELIGIBLE"
    | "COUPON_EXPIRED"
    | "COUPON_LIMIT_REACHED"
    | "COUPON_NOT_BETTER"
    | "COUPON_NO_EFFECT";
  rejectionReason?: string;
  differencePaise?: number;
}

export interface OfferEvaluationWarning {
  code: string;
  message?: string;
  offerId?: string;
}

export interface OfferEvaluationResult {
  lines: { lineId: string; discountPaise: number }[];
  applied: EvaluatedOfferDiscount[];
  gifts: EvaluatedGift[];
  couponResult?: CouponEvaluationResult;
  warnings: OfferEvaluationWarning[];
  totalDiscountPaise: number;
}

/**
 * Checks if a cart line matches an offer's targets.
 * An offer with no targets matches the whole cart.
 * If targets exist, it OR-matches on category, product, or collection.
 */
function lineMatchesOffer(line: CartLineInput, targets: OfferTargetShape[]): boolean {
  if (!targets || targets.length === 0) {
    return true;
  }
  return targets.some((t) => {
    if (t.productId && t.productId === line.productId) return true;
    if (t.categoryId && line.categoryId && t.categoryId === line.categoryId) return true;
    if (t.collectionId && line.collectionIds && line.collectionIds.includes(t.collectionId)) return true;
    return false;
  });
}

/**
 * Checks general eligibility for an offer:
 * active, date range, audience, and usage limits.
 */
function isOfferEligible(
  offer: OfferShape,
  audienceContext: AudienceContext,
  usageMap: Map<string, OfferUsageRecord>,
  now: Date
): { eligible: boolean; rejectionCode?: "COUPON_INELIGIBLE" | "COUPON_EXPIRED" | "COUPON_LIMIT_REACHED"; reason?: string } {
  if (!offer.active) {
    return { eligible: false, rejectionCode: "COUPON_INELIGIBLE", reason: "Offer is not active" };
  }

  const starts = offer.startsAt ? new Date(offer.startsAt) : null;
  const ends = offer.endsAt ? new Date(offer.endsAt) : null;

  if (starts && now < starts) {
    return { eligible: false, rejectionCode: "COUPON_INELIGIBLE", reason: "Offer has not started yet" };
  }
  if (ends && now > ends) {
    return { eligible: false, rejectionCode: "COUPON_EXPIRED", reason: "Offer has expired" };
  }

  // Usage limits
  const usage = usageMap.get(offer.id) || { total: 0, byCustomer: 0 };
  if (offer.maxUsesTotal !== null && offer.maxUsesTotal !== undefined && usage.total >= offer.maxUsesTotal) {
    return { eligible: false, rejectionCode: "COUPON_LIMIT_REACHED", reason: "Offer total usage limit reached" };
  }
  if (
    offer.maxUsesPerCustomer !== null &&
    offer.maxUsesPerCustomer !== undefined &&
    usage.byCustomer >= offer.maxUsesPerCustomer
  ) {
    return {
      eligible: false,
      rejectionCode: "COUPON_LIMIT_REACHED",
      reason: offer.code ? "You have already used this coupon code." : "Offer customer usage limit reached",
    };
  }

  // Audience
  if (offer.audience === "FIRST_ORDER" && !audienceContext.isFirstOrder) {
    return { eligible: false, rejectionCode: "COUPON_INELIGIBLE", reason: "Offer is valid for first order only" };
  }
  if (offer.audience === "BIRTHDAY" && !audienceContext.isBirthdayWindow) {
    return { eligible: false, rejectionCode: "COUPON_INELIGIBLE", reason: "Offer is valid during birthday window only" };
  }

  return { eligible: true };
}

/**
 * Deterministic largest remainder distribution.
 * Distributes totalAmount across targets proportionally to weights.
 * Guarantees sum(distributed) === totalAmount.
 */
function distributeLargestRemainder(totalAmount: number, weights: number[]): number[] {
  if (weights.length === 0 || totalAmount <= 0) {
    return weights.map(() => 0);
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0) {
    return weights.map(() => 0);
  }

  const rawShares = weights.map((w) => (w * totalAmount) / weightSum);
  const intShares = rawShares.map((r) => Math.floor(r));
  const allocated = intShares.reduce((sum, s) => sum + s, 0);
  const remainder = totalAmount - allocated;

  const remainders = rawShares.map((r, i) => ({
    index: i,
    remainder: r - intShares[i],
    weight: weights[i],
  }));

  // Sort by remainder descending, break ties by weight descending, then by index ascending
  remainders.sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) return b.remainder - a.remainder;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.index - b.index;
  });

  for (let i = 0; i < remainder; i++) {
    intShares[remainders[i].index]++;
  }

  return intShares;
}

/**
 * Inner evaluator for a list of candidate offers (automatic or single coupon)
 * against the provided cart lines.
 */
function evaluateOfferCandidateSet(
  lines: CartLineInput[],
  offers: OfferShape[],
  audienceContext: AudienceContext,
  usageMap: Map<string, OfferUsageRecord>,
  now: Date
): {
  applied: EvaluatedOfferDiscount[];
  gifts: EvaluatedGift[];
  warnings: OfferEvaluationWarning[];
  lineDiscounts: Map<string, number>;
  totalDiscount: number;
} {
  const applied: EvaluatedOfferDiscount[] = [];
  const gifts: EvaluatedGift[] = [];
  const warnings: OfferEvaluationWarning[] = [];
  const lineDiscounts = new Map<string, number>();

  for (const l of lines) {
    lineDiscounts.set(l.lineId, 0);
  }

  // Track unconsumed / available quantity per line
  // A unit consumed by a COMBO or GIFT trigger gets no other automatic offer.
  const availableQty = new Map<string, number>();
  for (const l of lines) {
    availableQty.set(l.lineId, l.qty);
  }

  // Sort candidate offers: ascending priority (lower number = higher priority), break ties by id
  const sortedOffers = [...offers].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  for (const offer of sortedOffers) {
    const eligibility = isOfferEligible(offer, audienceContext, usageMap, now);
    if (!eligibility.eligible) continue;

    // Filter matching lines
    const matchingLines = lines.filter((l) => lineMatchesOffer(l, offer.targets));
    if (matchingLines.length === 0) continue;

    // Check minCartPaise against eligible line subtotal after sale prices
    const eligibleSubtotal = matchingLines.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);
    if (eligibleSubtotal < offer.minCartPaise) {
      continue;
    }

    const cfg = offer.config || {};

    if (offer.kind === "PERCENT_OFF") {
      const percent = typeof cfg.percent === "number" ? cfg.percent : 0;
      if (percent <= 0 || percent > 100) continue;

      let offerDiscount = 0;
      const touchedLineIds: string[] = [];

      for (const line of matchingLines) {
        const avail = availableQty.get(line.lineId) || 0;
        if (avail <= 0) continue;

        const currentDisc = lineDiscounts.get(line.lineId) || 0;
        const lineTotal = line.unitPricePaise * line.qty;
        const remainingLineValue = Math.max(0, lineTotal - currentDisc);
        if (remainingLineValue <= 0) continue;

        // Discount calculated on available units
        const baseAmount = line.unitPricePaise * avail;
        const lineD = Math.min(remainingLineValue, Math.round((baseAmount * percent) / 100));

        if (lineD > 0) {
          lineDiscounts.set(line.lineId, currentDisc + lineD);
          offerDiscount += lineD;
          touchedLineIds.push(line.lineId);
        }
      }

      if (offerDiscount > 0) {
        applied.push({
          offerId: offer.id,
          kind: "PERCENT_OFF",
          label: offer.name || `${percent}% Off`,
          amountPaise: offerDiscount,
          lineIds: touchedLineIds,
        });
      }
    } else if (offer.kind === "FLAT_OFF") {
      const amountPaise = typeof cfg.amountPaise === "number" ? cfg.amountPaise : 0;
      if (amountPaise <= 0) continue;

      // Available eligible subtotal
      const availableSubtotals = matchingLines.map((l) => {
        const avail = availableQty.get(l.lineId) || 0;
        const curDisc = lineDiscounts.get(l.lineId) || 0;
        const lineTotal = l.unitPricePaise * l.qty;
        return Math.min(l.unitPricePaise * avail, Math.max(0, lineTotal - curDisc));
      });

      const totalAvailSubtotal = availableSubtotals.reduce((sum, v) => sum + v, 0);
      if (totalAvailSubtotal <= 0) continue;

      const flatDiscountToApply = Math.min(amountPaise, totalAvailSubtotal);
      const distributed = distributeLargestRemainder(flatDiscountToApply, availableSubtotals);

      let offerDiscount = 0;
      const touchedLineIds: string[] = [];

      matchingLines.forEach((line, idx) => {
        const d = distributed[idx];
        if (d > 0) {
          const curDisc = lineDiscounts.get(line.lineId) || 0;
          lineDiscounts.set(line.lineId, curDisc + d);
          offerDiscount += d;
          touchedLineIds.push(line.lineId);
        }
      });

      if (offerDiscount > 0) {
        applied.push({
          offerId: offer.id,
          kind: "FLAT_OFF",
          label: offer.name || `Flat ₹${(amountPaise / 100).toFixed(0)} Off`,
          amountPaise: offerDiscount,
          lineIds: touchedLineIds,
        });
      }
    } else if (offer.kind === "TIER") {
      const tiers = Array.isArray(cfg.tiers)
        ? (cfg.tiers as { minQty: number; type: "PERCENT" | "FLAT_PER_UNIT"; value: number }[])
        : [];
      if (tiers.length === 0) continue;

      const totalAvailQty = matchingLines.reduce((sum, l) => sum + (availableQty.get(l.lineId) || 0), 0);
      let matchedTier: { minQty: number; type: "PERCENT" | "FLAT_PER_UNIT"; value: number } | null = null;

      for (const t of tiers) {
        if (totalAvailQty >= t.minQty) {
          if (!matchedTier || t.minQty > matchedTier.minQty) {
            matchedTier = t;
          }
        }
      }

      if (!matchedTier) continue;

      let offerDiscount = 0;
      const touchedLineIds: string[] = [];

      for (const line of matchingLines) {
        const avail = availableQty.get(line.lineId) || 0;
        if (avail <= 0) continue;

        const currentDisc = lineDiscounts.get(line.lineId) || 0;
        const lineTotal = line.unitPricePaise * line.qty;
        const remainingLineValue = Math.max(0, lineTotal - currentDisc);
        if (remainingLineValue <= 0) continue;

        let lineD = 0;
        if (matchedTier.type === "PERCENT") {
          const base = line.unitPricePaise * avail;
          lineD = Math.min(remainingLineValue, Math.round((base * matchedTier.value) / 100));
        } else {
          // FLAT_PER_UNIT: matchedTier.value is in paise
          const base = matchedTier.value * avail;
          lineD = Math.min(remainingLineValue, Math.min(line.unitPricePaise * avail, base));
        }

        if (lineD > 0) {
          lineDiscounts.set(line.lineId, currentDisc + lineD);
          offerDiscount += lineD;
          touchedLineIds.push(line.lineId);
        }
      }

      if (offerDiscount > 0) {
        applied.push({
          offerId: offer.id,
          kind: "TIER",
          label: offer.name || `Tier Discount (Buy ${matchedTier.minQty}+)`,
          amountPaise: offerDiscount,
          lineIds: touchedLineIds,
        });
      }
    } else if (offer.kind === "COMBO_ANY") {
      const groupQty = typeof cfg.quantity === "number" ? cfg.quantity : 0;
      const fixedPricePaise = typeof cfg.fixedPricePaise === "number" ? cfg.fixedPricePaise : 0;
      const repeatable = cfg.repeatable !== false;

      if (groupQty < 2 || fixedPricePaise <= 0) continue;

      // Expand available matching units into individual items
      interface UnitSlot {
        lineId: string;
        unitPrice: number;
      }

      const availableUnits: UnitSlot[] = [];
      for (const line of matchingLines) {
        const avail = availableQty.get(line.lineId) || 0;
        for (let u = 0; u < avail; u++) {
          availableUnits.push({ lineId: line.lineId, unitPrice: line.unitPricePaise });
        }
      }

      // Assignment rule: MOST-EXPENSIVE FIRST maximizes customer savings
      availableUnits.sort((a, b) => b.unitPrice - a.unitPrice);

      const maxGroups = repeatable ? Math.floor(availableUnits.length / groupQty) : Math.min(1, Math.floor(availableUnits.length / groupQty));
      let totalComboDiscount = 0;
      const touchedLines = new Set<string>();

      for (let g = 0; g < maxGroups; g++) {
        const groupItems = availableUnits.slice(g * groupQty, (g + 1) * groupQty);
        const groupRegularTotal = groupItems.reduce((sum, item) => sum + item.unitPrice, 0);

        if (groupRegularTotal > fixedPricePaise) {
          const discount = groupRegularTotal - fixedPricePaise;
          totalComboDiscount += discount;

          // Consume units
          for (const item of groupItems) {
            touchedLines.add(item.lineId);
            availableQty.set(item.lineId, (availableQty.get(item.lineId) || 0) - 1);
          }

          // Distribute discount over group items proportionally
          const itemPrices = groupItems.map((i) => i.unitPrice);
          const distributed = distributeLargestRemainder(discount, itemPrices);
          groupItems.forEach((item, idx) => {
            const curDisc = lineDiscounts.get(item.lineId) || 0;
            lineDiscounts.set(item.lineId, curDisc + distributed[idx]);
          });
        }
      }

      if (totalComboDiscount > 0) {
        applied.push({
          offerId: offer.id,
          kind: "COMBO_ANY",
          label: offer.name || `Combo (Any ${groupQty} for ₹${(fixedPricePaise / 100).toFixed(0)})`,
          amountPaise: totalComboDiscount,
          lineIds: Array.from(touchedLines),
        });
      }
    } else if (offer.kind === "COMBO_SLOTS") {
      const slots = Array.isArray(cfg.slots)
        ? (cfg.slots as { label: string; quantity: number; selector: { type: "category" | "product" | "collection"; id: string } }[])
        : [];
      const fixedPricePaise = typeof cfg.fixedPricePaise === "number" ? cfg.fixedPricePaise : 0;
      const repeatable = cfg.repeatable !== false;

      if (slots.length < 2 || fixedPricePaise <= 0) continue;

      let bundlesFormed = 0;
      let totalSlotsDiscount = 0;
      const touchedLines = new Set<string>();

      // Keep forming bundles as long as each slot can be satisfied
      while (true) {
        if (!repeatable && bundlesFormed >= 1) break;

        // Try to pick units for each slot
        let canFormBundle = true;
        const bundlePicks: { lineId: string; unitPrice: number }[] = [];
        const tempAvailable = new Map(availableQty);

        for (const slot of slots) {
          const matchingSlotLines = lines.filter((l) => {
            if (slot.selector.type === "product") return l.productId === slot.selector.id;
            if (slot.selector.type === "category") return l.categoryId === slot.selector.id;
            if (slot.selector.type === "collection") return l.collectionIds?.includes(slot.selector.id);
            return false;
          });

          // Expand available units for this slot sorted by price descending
          const slotUnits: { lineId: string; unitPrice: number }[] = [];
          for (const l of matchingSlotLines) {
            const avail = tempAvailable.get(l.lineId) || 0;
            for (let u = 0; u < avail; u++) {
              slotUnits.push({ lineId: l.lineId, unitPrice: l.unitPricePaise });
            }
          }
          slotUnits.sort((a, b) => b.unitPrice - a.unitPrice);

          if (slotUnits.length < slot.quantity) {
            canFormBundle = false;
            break;
          }

          const chosen = slotUnits.slice(0, slot.quantity);
          for (const c of chosen) {
            bundlePicks.push(c);
            tempAvailable.set(c.lineId, (tempAvailable.get(c.lineId) || 0) - 1);
          }
        }

        if (!canFormBundle) break;

        const bundleRegularTotal = bundlePicks.reduce((sum, p) => sum + p.unitPrice, 0);
        if (bundleRegularTotal > fixedPricePaise) {
          const discount = bundleRegularTotal - fixedPricePaise;
          totalSlotsDiscount += discount;
          bundlesFormed++;

          // Commit consumed units
          for (const [lId, qty] of tempAvailable.entries()) {
            availableQty.set(lId, qty);
          }

          for (const p of bundlePicks) {
            touchedLines.add(p.lineId);
          }

          // Distribute discount across bundle picks
          const pickPrices = bundlePicks.map((p) => p.unitPrice);
          const distributed = distributeLargestRemainder(discount, pickPrices);
          bundlePicks.forEach((p, idx) => {
            const cur = lineDiscounts.get(p.lineId) || 0;
            lineDiscounts.set(p.lineId, cur + distributed[idx]);
          });
        } else {
          // If no saving, stop attempting further bundles
          break;
        }
      }

      if (totalSlotsDiscount > 0) {
        applied.push({
          offerId: offer.id,
          kind: "COMBO_SLOTS",
          label: offer.name || `Bundle Combo for ₹${(fixedPricePaise / 100).toFixed(0)}`,
          amountPaise: totalSlotsDiscount,
          lineIds: Array.from(touchedLines),
        });
      }
    } else if (offer.kind === "GIFT") {
      const buyQty = typeof cfg.buyQty === "number" ? cfg.buyQty : 0;
      const giftQty = typeof cfg.giftQty === "number" ? cfg.giftQty : 1;
      const gift = cfg.gift as { type: "VARIANT"; variantId: string } | { type: "TEXT"; text: string } | undefined;

      if (!gift || giftQty < 1) continue;

      let qualifyingSets = 0;
      if (buyQty > 0) {
        const availInMatching = matchingLines.reduce((sum, l) => sum + (availableQty.get(l.lineId) || 0), 0);
        qualifyingSets = Math.floor(availInMatching / buyQty);
      } else {
        // buyQty 0 => triggered by minCartPaise only (already validated above)
        qualifyingSets = 1;
      }

      if (qualifyingSets > 0) {
        // Consume buyQty trigger units from availableQty
        if (buyQty > 0) {
          let unitsToConsume = qualifyingSets * buyQty;
          for (const line of matchingLines) {
            const avail = availableQty.get(line.lineId) || 0;
            const take = Math.min(avail, unitsToConsume);
            if (take > 0) {
              availableQty.set(line.lineId, avail - take);
              unitsToConsume -= take;
              if (unitsToConsume <= 0) break;
            }
          }
        }

        const grantedQty = giftQty * qualifyingSets;
        if (gift.type === "VARIANT") {
          gifts.push({
            offerId: offer.id,
            type: "VARIANT",
            variantId: gift.variantId,
            qty: grantedQty,
          });
        } else {
          gifts.push({
            offerId: offer.id,
            type: "TEXT",
            text: gift.text,
            qty: grantedQty,
          });
          applied.push({
            offerId: offer.id,
            kind: "GIFT",
            label: `Free Gift: ${gift.text}`,
            amountPaise: 0,
            lineIds: [],
          });
        }
      }
    }
  }

  const totalDiscount = Array.from(lineDiscounts.values()).reduce((sum, v) => sum + v, 0);

  return {
    applied,
    gifts,
    warnings,
    lineDiscounts,
    totalDiscount,
  };
}

/**
 * Main pure offer evaluator.
 */
export function evaluateOffers(input: EvaluateOffersInput): OfferEvaluationResult {
  const {
    lines,
    offers,
    audienceContext,
    usageCounts = {},
    couponOffer = null,
    settings = {},
    now = new Date(),
  } = input;

  const usageMap = new Map<string, OfferUsageRecord>();
  if (usageCounts instanceof Map) {
    for (const [k, v] of usageCounts.entries()) {
      usageMap.set(k, v);
    }
  } else if (usageCounts && typeof usageCounts === "object") {
    for (const [k, v] of Object.entries(usageCounts)) {
      usageMap.set(k, v);
    }
  }

  const warnings: OfferEvaluationWarning[] = [];
  const preDiscountSubtotal = lines.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);

  // Check for dangling targets across offers
  for (const o of offers) {
    for (const t of o.targets || []) {
      if (!t.categoryId && !t.productId && !t.collectionId) {
        warnings.push({ code: "DANGLING_TARGET", offerId: o.id });
      }
    }
  }

  // 1. Evaluate automatic offers (code is null or empty)
  const automaticOffers = offers.filter((o) => !o.code || o.code.trim().length === 0);
  const automaticEval = evaluateOfferCandidateSet(lines, automaticOffers, audienceContext, usageMap, now);

  // 2. Evaluate exclusive coupon if provided
  let finalApplied: EvaluatedOfferDiscount[] = automaticEval.applied;
  let finalGifts: EvaluatedGift[] = automaticEval.gifts;
  let finalLineDiscounts = new Map<string, number>(automaticEval.lineDiscounts);
  let finalTotalDiscount = automaticEval.totalDiscount;
  let couponResult: CouponEvaluationResult | undefined = undefined;

  warnings.push(...automaticEval.warnings);

  if (couponOffer && couponOffer.code) {
    const couponEligibility = isOfferEligible(couponOffer, audienceContext, usageMap, now);
    if (!couponEligibility.eligible) {
      couponResult = {
        accepted: false,
        code: couponOffer.code,
        rejectionCode: couponEligibility.rejectionCode || "COUPON_INELIGIBLE",
        rejectionReason: couponEligibility.reason || "Coupon is ineligible",
      };
    } else {
      // Check minCartPaise for coupon
      const matchingLines = lines.filter((l) => lineMatchesOffer(l, couponOffer.targets));
      const couponEligibleSubtotal = matchingLines.reduce((sum, l) => sum + l.unitPricePaise * l.qty, 0);

      if (couponEligibleSubtotal < couponOffer.minCartPaise) {
        couponResult = {
          accepted: false,
          code: couponOffer.code,
          rejectionCode: "COUPON_INELIGIBLE",
          rejectionReason: `Cart minimum of ₹${(couponOffer.minCartPaise / 100).toFixed(0)} not met for coupon`,
        };
      } else {
        // Evaluate coupon exclusively against clean cart lines
        const couponEval = evaluateOfferCandidateSet(lines, [couponOffer], audienceContext, usageMap, now);

        if (couponEval.totalDiscount <= 0 && couponEval.gifts.length === 0) {
          couponResult = {
            accepted: false,
            code: couponOffer.code,
            rejectionCode: "COUPON_NO_EFFECT",
            rejectionReason: "Coupon provides no discount",
          };
        } else {
          // Compare automatic vs coupon
          if (automaticEval.totalDiscount >= couponEval.totalDiscount) {
            // Automatic wins
            const diff = automaticEval.totalDiscount - couponEval.totalDiscount;
            couponResult = {
              accepted: false,
              code: couponOffer.code,
              rejectionCode: "COUPON_NOT_BETTER",
              rejectionReason: `Automatic offers save more than coupon`,
              differencePaise: diff,
            };
            warnings.push({
              code: "COUPON_NOT_BETTER",
              message: `Automatic offers save ₹${(diff / 100).toFixed(2)} more than coupon ${couponOffer.code}`,
              offerId: couponOffer.id,
            });
          } else {
            // Coupon wins: exclusive!
            couponResult = {
              accepted: true,
              code: couponOffer.code,
            };
            finalApplied = couponEval.applied;
            finalGifts = couponEval.gifts;
            finalLineDiscounts = new Map(couponEval.lineDiscounts);
            finalTotalDiscount = couponEval.totalDiscount;
            warnings.push(...couponEval.warnings);
          }
        }
      }
    }
  }

  // 3. Global Cap Enforcement
  if (settings.discountCapPercent !== null && settings.discountCapPercent !== undefined && settings.discountCapPercent > 0) {
    const maxAllowedDiscount = Math.floor((preDiscountSubtotal * settings.discountCapPercent) / 100);
    if (finalTotalDiscount > maxAllowedDiscount) {
      warnings.push({
        code: "CAP_APPLIED",
        message: `Total discount capped at ${settings.discountCapPercent}% of subtotal`,
      });

      // Scale down applied offers
      const appliedAmounts = finalApplied.map((a) => a.amountPaise);
      const scaledApplied = distributeLargestRemainder(maxAllowedDiscount, appliedAmounts);
      finalApplied.forEach((a, idx) => {
        a.amountPaise = scaledApplied[idx];
      });

      // Scale down per-line discounts
      const lineIds = lines.map((l) => l.lineId);
      const currentLineAmounts = lineIds.map((id) => finalLineDiscounts.get(id) || 0);
      const scaledLineDiscounts = distributeLargestRemainder(maxAllowedDiscount, currentLineAmounts);
      lineIds.forEach((id, idx) => {
        finalLineDiscounts.set(id, scaledLineDiscounts[idx]);
      });

      finalTotalDiscount = maxAllowedDiscount;
    }
  }

  // 4. Cost Floor Enforcement (Per Line)
  // Ensure line price >= line.qty * costPaise
  // Warning MUST NOT include cost price!
  let costFloorTriggered = false;
  for (const line of lines) {
    if (line.costPaise !== undefined && line.costPaise !== null) {
      const minLinePrice = line.costPaise * line.qty;
      const lineTotal = line.unitPricePaise * line.qty;
      const maxDiscount = Math.max(0, lineTotal - minLinePrice);
      const currentDisc = finalLineDiscounts.get(line.lineId) || 0;

      if (currentDisc > maxDiscount) {
        costFloorTriggered = true;
        const reduction = currentDisc - maxDiscount;
        finalLineDiscounts.set(line.lineId, maxDiscount);
        finalTotalDiscount = Math.max(0, finalTotalDiscount - reduction);

        // Also reduce from applied offers proportionally
        if (finalTotalDiscount > 0) {
          const appliedAmounts = finalApplied.map((a) => a.amountPaise);
          const scaledApplied = distributeLargestRemainder(finalTotalDiscount, appliedAmounts);
          finalApplied.forEach((a, idx) => {
            a.amountPaise = scaledApplied[idx];
          });
        } else {
          finalApplied.forEach((a) => {
            a.amountPaise = 0;
          });
        }
      }
    }
  }

  if (costFloorTriggered) {
    warnings.push({
      code: "COST_FLOOR_APPLIED",
      message: "Cost floor applied to protect item price",
    });
  }

  // 5. Final Per-Line Allocation Invariant: sum(lines) === finalTotalDiscount
  const outputLines = lines.map((l) => {
    let d = finalLineDiscounts.get(l.lineId) || 0;
    d = Math.max(0, Math.min(d, l.unitPricePaise * l.qty));
    return {
      lineId: l.lineId,
      discountPaise: d,
    };
  });

  const sumLineDiscounts = outputLines.reduce((sum, l) => sum + l.discountPaise, 0);
  if (sumLineDiscounts !== finalTotalDiscount && outputLines.length > 0) {
    const weights = outputLines.map((l) => l.discountPaise > 0 ? l.discountPaise : 1);
    const reallocated = distributeLargestRemainder(finalTotalDiscount, weights);
    outputLines.forEach((l, idx) => {
      l.discountPaise = reallocated[idx];
    });
  }

  return {
    lines: outputLines,
    applied: finalApplied.filter((a) => a.amountPaise > 0 || a.kind === "GIFT"),
    gifts: finalGifts,
    couponResult,
    warnings,
    totalDiscountPaise: finalTotalDiscount,
  };
}
