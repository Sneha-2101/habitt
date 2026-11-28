"use client";

import { useEffect } from "react";
import { recordRecentlyViewed } from "@/lib/recently-viewed";
import { trackPixelEvent } from "@/components/MetaPixel";
import { buildViewContentPayload } from "@/lib/consent/pixel-payload";

export default function RecordRecentlyViewed({
  product,
}: {
  product: {
    id: string;
    feedContentId?: string;
    name: string;
    slug: string;
    price: number;
    category: string;
    imageUrl?: string;
  };
}) {
  useEffect(() => {
    recordRecentlyViewed(product);
    trackPixelEvent(
      "ViewContent",
      buildViewContentPayload({
        contentId: product.feedContentId || product.id,
        productName: product.name,
        priceRupees: product.price / 100,
      })
    );
  }, [product]);

  return null;
}
