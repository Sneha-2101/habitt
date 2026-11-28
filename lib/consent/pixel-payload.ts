import { formatFeedVariantId, type FeedVariantIdInput } from "@/lib/seo/feed-id";

export function buildViewContentPayload(input: {
  contentId: string;
  productName: string;
  priceRupees: number;
}) {
  return {
    content_ids: [input.contentId],
    content_name: input.productName,
    content_type: "product" as const,
    value: input.priceRupees,
    currency: "INR" as const,
  };
}

export function buildAddToCartPayload(input: {
  variant: FeedVariantIdInput;
  priceRupees: number;
}) {
  return {
    content_ids: [formatFeedVariantId(input.variant)],
    content_type: "product" as const,
    value: input.priceRupees,
    currency: "INR" as const,
  };
}

export function buildInitiateCheckoutPayload(input: {
  items: ReadonlyArray<FeedVariantIdInput & { qty: number }>;
  subtotalRupees: number;
}) {
  return {
    content_ids: input.items.map((item) => formatFeedVariantId(item)),
    content_type: "product" as const,
    value: input.subtotalRupees,
    currency: "INR" as const,
    num_items: input.items.reduce((acc, item) => acc + item.qty, 0),
  };
}

export function buildPurchasePayload(input: {
  orderId: string;
  totalRupees: number;
  items?: ReadonlyArray<FeedVariantIdInput>;
}) {
  const contentIds = input.items?.map((item) => formatFeedVariantId(item)) ?? [];
  return {
    ...(contentIds.length > 0 ? { content_ids: contentIds, content_type: "product" as const } : {}),
    value: input.totalRupees,
    currency: "INR" as const,
    order_id: input.orderId,
  };
}
