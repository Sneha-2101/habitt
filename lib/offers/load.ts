import { prisma } from "@/lib/prisma";
import type {
  OfferShape,
  AudienceContext,
  OfferUsageRecord,
  OfferKind,
  OfferAudience,
  CartLineInput,
} from "./evaluate";

export interface LoadedOfferData {
  offers: OfferShape[];
  couponOffer: OfferShape | null;
  audienceContext: AudienceContext;
  usageCounts: Map<string, OfferUsageRecord>;
  cartLineEnrichment: Map<
    string,
    {
      categoryId: string | null;
      collectionIds: string[];
      costPaise: number | null;
    }
  >;
}

/**
 * Server-only data loader for offer evaluation.
 * Loads active offers, targets, product categories, collection memberships,
 * cost prices (with explicit omit:{costPrice:false}), audience context, and usage counts.
 */
export async function loadOfferEvaluationData({
  userId,
  productIds,
  couponCode,
  now = new Date(),
}: {
  userId?: string | null;
  productIds: string[];
  couponCode?: string | null;
  now?: Date;
}): Promise<LoadedOfferData> {
  const normalizedCode = couponCode?.trim().toUpperCase() || null;

  // 1. Fetch active automatic offers (code is null) + specific coupon offer if entered
  const [automaticOffersRaw, couponOfferRaw] = await Promise.all([
    prisma.offer.findMany({
      where: {
        active: true,
        code: null,
      },
      include: {
        targets: true,
      },
      orderBy: [{ priority: "asc" }, { id: "asc" }],
    }),
    normalizedCode
      ? prisma.offer.findUnique({
          where: { code: normalizedCode },
          include: { targets: true },
        })
      : Promise.resolve(null),
  ]);

  const mapOfferShape = (raw: typeof automaticOffersRaw[number]): OfferShape => ({
    id: raw.id,
    name: raw.name,
    kind: raw.kind as OfferKind,
    code: raw.code,
    active: raw.active,
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    minCartPaise: raw.minCartPaise,
    maxUsesTotal: raw.maxUsesTotal,
    maxUsesPerCustomer: raw.maxUsesPerCustomer,
    priority: raw.priority,
    audience: raw.audience as OfferAudience,
    config: (raw.config as Record<string, unknown>) || {},
    targets: raw.targets.map((t) => ({
      categoryId: t.categoryId,
      productId: t.productId,
      collectionId: t.collectionId,
    })),
  });

  const offers: OfferShape[] = automaticOffersRaw.map(mapOfferShape);
  const couponOffer: OfferShape | null = couponOfferRaw ? mapOfferShape(couponOfferRaw) : null;

  // 2. Audience context
  let isFirstOrder = false;
  let isBirthdayWindow = false;

  if (userId) {
    const [priorOrderCount, userRecord] = await Promise.all([
      prisma.order.count({
        where: {
          userId,
          paymentStatus: { not: "FAILED" },
          fulfilmentStatus: { not: "CANCELLED" },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { dateOfBirth: true },
      }),
    ]);

    isFirstOrder = priorOrderCount === 0;

    if (userRecord?.dateOfBirth) {
      const dob = new Date(userRecord.dateOfBirth);
      const dobMonth = dob.getMonth();
      const dobDate = dob.getDate();

      // Birthday window: same month or within 30 days
      const currentYear = now.getFullYear();
      const thisYearBirthday = new Date(currentYear, dobMonth, dobDate);
      const diffMs = Math.abs(now.getTime() - thisYearBirthday.getTime());
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      isBirthdayWindow = diffDays <= 30;
    }
  }

  const audienceContext: AudienceContext = {
    isFirstOrder,
    isBirthdayWindow,
    userId,
  };

  // 3. Usage counts per offer
  const candidateOfferIds = offers.map((o) => o.id);
  if (couponOffer) candidateOfferIds.push(couponOffer.id);

  const usageCounts = new Map<string, OfferUsageRecord>();

  // Total usage from Offer.timesUsed
  for (const o of offers) {
    const raw = automaticOffersRaw.find((r) => r.id === o.id);
    usageCounts.set(o.id, {
      total: raw?.timesUsed || 0,
      byCustomer: 0,
    });
  }
  if (couponOffer && couponOfferRaw) {
    usageCounts.set(couponOffer.id, {
      total: couponOfferRaw.timesUsed || 0,
      byCustomer: 0,
    });
  }

  // Customer usage from OfferRedemption (excluding cancelled or failed orders)
  if (userId && candidateOfferIds.length > 0) {
    const redemptions = await prisma.offerRedemption.groupBy({
      by: ["offerId"],
      where: {
        userId,
        offerId: { in: candidateOfferIds },
        order: {
          paymentStatus: { not: "FAILED" },
          fulfilmentStatus: { not: "CANCELLED" },
        },
      },
      _count: { id: true },
    });

    for (const r of redemptions) {
      const existing = usageCounts.get(r.offerId) || { total: 0, byCustomer: 0 };
      existing.byCustomer = r._count.id;
      usageCounts.set(r.offerId, existing);
    }
  }

  // 4. Load product details with collections and costPrice (omitApi override)
  // Sensitive costPrice is read server-side only to enforce cost floor
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      collections: {
        select: { collectionId: true },
      },
    },
    omit: { costPrice: false },
  });

  const cartLineEnrichment = new Map<
    string,
    {
      categoryId: string | null;
      collectionIds: string[];
      costPaise: number | null;
    }
  >();

  for (const p of products) {
    cartLineEnrichment.set(p.id, {
      categoryId: p.categoryId,
      collectionIds: p.collections.map((c) => c.collectionId),
      costPaise: p.costPrice,
    });
  }

  return {
    offers,
    couponOffer,
    audienceContext,
    usageCounts,
    cartLineEnrichment,
  };
}

/**
 * Helper to enrich cart items with category, collection and cost data for evaluateOffers.
 */
export function enrichCartLines(
  rawLines: {
    lineId: string;
    productId: string;
    variantId: string;
    unitPricePaise: number;
    qty: number;
  }[],
  enrichment: Map<
    string,
    {
      categoryId: string | null;
      collectionIds: string[];
      costPaise: number | null;
    }
  >
): CartLineInput[] {
  return rawLines.map((line) => {
    const enriched = enrichment.get(line.productId);
    return {
      ...line,
      categoryId: enriched?.categoryId ?? null,
      collectionIds: enriched?.collectionIds ?? [],
      costPaise: enriched?.costPaise ?? null,
    };
  });
}

export interface OfferBadgesLookup {
  allCartBadge: string | null;
  productTargetMap: Map<string, string>;
  categoryTargetMap: Map<string, string>;
  collectionTargetMap: Map<string, string>;
}

/**
 * Loads active automatic offers for badge display on storefront catalog pages.
 * Single batched query per page with explicit select only.
 */
export async function getActiveAutomaticOfferBadges(): Promise<OfferBadgesLookup> {
  const offers = await prisma.offer.findMany({
    where: { active: true, code: null },
    select: {
      id: true,
      name: true,
      kind: true,
      priority: true,
      targets: {
        select: {
          productId: true,
          categoryId: true,
          collectionId: true,
        },
      },
    },
    orderBy: { priority: "asc" },
  });

  const productTargetMap = new Map<string, string>();
  const categoryTargetMap = new Map<string, string>();
  const collectionTargetMap = new Map<string, string>();
  let allCartBadge: string | null = null;

  for (const o of offers) {
    const badgeLabel = o.name || "Special Offer";
    if (o.targets.length === 0 && !allCartBadge) {
      allCartBadge = badgeLabel;
    }
    for (const t of o.targets) {
      if (t.productId && !productTargetMap.has(t.productId)) {
        productTargetMap.set(t.productId, badgeLabel);
      }
      if (t.categoryId && !categoryTargetMap.has(t.categoryId)) {
        categoryTargetMap.set(t.categoryId, badgeLabel);
      }
      if (t.collectionId && !collectionTargetMap.has(t.collectionId)) {
        collectionTargetMap.set(t.collectionId, badgeLabel);
      }
    }
  }

  return { allCartBadge, productTargetMap, categoryTargetMap, collectionTargetMap };
}

export function resolveOfferBadge(
  productId: string,
  categoryId: string | null | undefined,
  collectionIds: string[] | undefined,
  badges: OfferBadgesLookup
): string | null {
  if (badges.productTargetMap.has(productId)) {
    return badges.productTargetMap.get(productId)!;
  }
  if (categoryId && badges.categoryTargetMap.has(categoryId)) {
    return badges.categoryTargetMap.get(categoryId)!;
  }
  if (collectionIds) {
    for (const cId of collectionIds) {
      if (badges.collectionTargetMap.has(cId)) {
        return badges.collectionTargetMap.get(cId)!;
      }
    }
  }
  return badges.allCartBadge || null;
}

