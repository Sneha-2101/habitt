"use client";

import { useEffect } from "react";
import { recordRecentlyViewed } from "@/lib/recently-viewed";
import { trackPixelEvent } from "@/components/MetaPixel";

export default function RecordRecentlyViewed({
  product,
}: {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    category: string;
    imageUrl?: string;
  };
}) {
  useEffect(() => {
    recordRecentlyViewed(product);
    trackPixelEvent("ViewContent", {
      content_name: product.name,
      content_ids: [product.id],
      value: product.price / 100,
      currency: "INR",
    });
  }, [product]);

  return null;
}
