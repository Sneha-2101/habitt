"use client";

import { useEffect } from "react";
import { trackPurchaseOnce } from "@/components/MetaPixel";

export default function TrackPurchasePixel({
  orderId,
  totalRupees,
}: {
  orderId: string;
  totalRupees: number;
}) {
  useEffect(() => {
    trackPurchaseOnce(orderId, totalRupees);
  }, [orderId, totalRupees]);

  return null;
}
