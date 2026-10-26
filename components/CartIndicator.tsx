"use client";

import { useCartStore } from "@/lib/cart-store";

export default function CartIndicator() {
  const count = useCartStore((s) => s.items.reduce((sum, i) => sum + i.qty, 0));
  if (count === 0) return null;
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-moss align-super ml-0.5"
      aria-label={`${count} items in bag`}
    />
  );
}
