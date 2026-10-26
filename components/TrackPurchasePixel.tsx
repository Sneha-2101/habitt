"use client";

import { useEffect } from "react";
import { trackPixelEvent } from "@/components/MetaPixel";

export default function TrackPurchasePixel({
  orderId,
  totalRupees,
}: {
  orderId: string;
  totalRupees: number;
}) {
  useEffect(() => {
    trackPixelEvent("Purchase", {
      value: totalRupees,
      currency: "INR",
      order_id: orderId,
    });
  }, [orderId, totalRupees]);

  return null;
}
