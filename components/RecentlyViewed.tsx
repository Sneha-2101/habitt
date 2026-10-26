"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import { getRecentlyViewed, RecentlyViewedItem } from "@/lib/recently-viewed";
import { ProductSwatchImage } from "./ProductSwatchImage";

export default function RecentlyViewed() {
  const [items, setItems] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setItems(getRecentlyViewed());
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="px-4 sm:px-7 py-10 border-t border-stone/50 bg-paper/30">
      <h2 className="font-display text-lg text-ink font-medium mb-4">Recently Viewed</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/product/${item.slug}`}
            className="block bg-white rounded-xl p-2 border border-stone/30 shadow-sm hover:shadow-md transition-all group"
          >
            <ProductSwatchImage url={item.imageUrl} category={item.category} />
            <div className="p-2">
              <div className="text-xs font-medium truncate group-hover:opacity-75">{item.name}</div>
              <div className="font-mono text-[11.5px] mt-1 text-ink">{formatINR(item.price)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
