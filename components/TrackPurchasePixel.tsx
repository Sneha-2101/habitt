"use client";

import { useEffect } from "react";
import { trackPurchaseOnce } from "@/components/MetaPixel";
import type { FeedVariantIdInput } from "@/lib/seo/feed-id";

export default function TrackPurchasePixel({
  orderId,
  totalRupees,
  items,
}: {
  orderId: string;
  totalRupees: number;
  items?: ReadonlyArray<FeedVariantIdInput>;
}) {
  useEffect(() => {
    trackPurchaseOnce(orderId, totalRupees, items);
  }, [orderId, totalRupees, items]);

  return null;
}
