export interface FeedVariantIdInput {
  productId: string;
  variantId: string;
  sku?: string | null;
}

/**
 * Canonical item identifier shared between the Google Shopping feed
 * and Meta Pixel content_ids so catalog matching never drifts.
 */
export function formatFeedVariantId(input: FeedVariantIdInput): string {
  const trimmedSku = input.sku?.trim();
  return trimmedSku || `${input.productId}-${input.variantId}`;
}
