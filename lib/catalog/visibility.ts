import type { Prisma } from "@prisma/client";

export interface ProductVisibilityFields {
  status: string;
  publishAt?: Date | null;
}

/**
 * Pure visibility check:
 * A product is visible if status === "ACTIVE" AND (publishAt is null OR publishAt <= now).
 */
export function isProductVisible(
  product: ProductVisibilityFields | null | undefined,
  now: Date = new Date()
): boolean {
  if (!product) return false;
  if (product.status !== "ACTIVE") return false;
  if (!product.publishAt) return true;
  return product.publishAt.getTime() <= now.getTime();
}

/**
 * Pure purchasability check:
 * Uses the exact same visibility requirement.
 */
export function isProductPurchasable(
  product: ProductVisibilityFields | null | undefined,
  now: Date = new Date()
): boolean {
  return isProductVisible(product, now);
}

/**
 * Returns Prisma where condition fragment for storefront product queries.
 */
export function storefrontProductWhere(now: Date = new Date()): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE",
    OR: [
      { publishAt: null },
      { publishAt: { lte: now } },
    ],
  };
}
