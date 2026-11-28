"use client";

import { useEffect } from "react";
import { trackPixelEvent } from "@/components/MetaPixel";
import { buildViewContentPayload } from "@/lib/consent/pixel-payload";

export default function TrackViewContentPixel({
  contentId,
  productName,
  priceRupees,
}: {
  contentId: string;
  productName: string;
  priceRupees: number;
}) {
  useEffect(() => {
    trackPixelEvent(
      "ViewContent",
      buildViewContentPayload({ contentId, productName, priceRupees })
    );
  }, [contentId, productName, priceRupees]);

  return null;
}
