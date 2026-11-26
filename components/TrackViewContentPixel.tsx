"use client";

import { useEffect } from "react";
import { trackPixelEvent } from "@/components/MetaPixel";

export default function TrackViewContentPixel({
  productId,
  productName,
  priceRupees,
}: {
  productId: string;
  productName: string;
  priceRupees: number;
}) {
  useEffect(() => {
    trackPixelEvent("ViewContent", {
      content_ids: [productId],
      content_name: productName,
      content_type: "product",
      value: priceRupees,
      currency: "INR",
    });
  }, [productId, productName, priceRupees]);

  return null;
}
