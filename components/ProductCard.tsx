"use client";

import Link from "next/link";
import { formatINR } from "@/lib/money";
import { CareTag } from "@/components/CareTag";
import { ProductSwatchImage } from "@/components/ProductSwatchImage";
import WishlistButton from "@/components/WishlistButton";
import { useState } from "react";
import QuickViewModal from "@/components/QuickViewModal";

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    category: string;
    images?: Array<{ url: string }>;
    variants?: Array<{ id: string; size: string; stock: number }>;
    reviews?: Array<{ rating: number }>;
  };
  initialSaved?: boolean;
  lowStockThreshold?: number;
}

export default function ProductCard({ product, initialSaved = false, lowStockThreshold = 3 }: ProductCardProps) {
  const [showQuickView, setShowQuickView] = useState(false);

  // Single visual signal determination:
  // Low stock signal (stock <= lowStockThreshold) vs Star rating signal
  const lowStockVariants = product.variants?.filter((v) => v.stock > 0 && v.stock <= lowStockThreshold) || [];
  const lowestStock = lowStockVariants.length > 0
    ? Math.min(...lowStockVariants.map((v) => v.stock))
    : null;

  const reviewCount = product.reviews?.length || 0;
  const avgRating = reviewCount > 0
    ? product.reviews!.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : 0;

  return (
    <>
      <div className="relative group">
        <Link
          href={`/product/${product.slug}`}
          className="block bg-white rounded-2xl p-2 border border-stone/30 shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.1)] transition-all duration-300"
        >
          <div className="relative">
            <ProductSwatchImage url={product.images?.[0]?.url} category={product.category} />
            
            {/* Quick-view hover overlay trigger (Desktop only) */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowQuickView(true);
              }}
              className="hidden md:flex absolute bottom-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 bg-white/90 backdrop-blur-sm text-ink text-[11px] font-medium tracking-[0.04em] rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity items-center gap-1.5 hover:bg-white"
            >
              <span>👁</span> Quick View
            </button>
          </div>

          <div className="p-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm font-medium group-hover:opacity-75 transition-opacity">
                  {product.name}
                </div>
                <div className="text-[12px] text-stone-dark mt-0.5">
                  {product.category[0] + product.category.slice(1).toLowerCase()}
                </div>
              </div>
              <CareTag>{product.category}</CareTag>
            </div>

            <div className="flex items-center justify-between mt-3 font-mono text-[13px]">
              <span>{formatINR(product.price)}</span>

              {/* SINGLE VISUAL SIGNAL: Low Stock OR Star Rating (Never both) */}
              {lowestStock !== null ? (
                <span className="text-[10.5px] bg-amber-50 text-amber-800 border border-amber-200/80 px-1.5 py-0.5 rounded font-sans font-medium">
                  Only {lowestStock} left
                </span>
              ) : reviewCount > 0 ? (
                <span className="text-[11px] text-stone-dark font-sans flex items-center gap-1">
                  <span className="text-amber-500">★</span>
                  <span className="font-semibold text-ink">{avgRating.toFixed(1)}</span>
                  <span className="text-stone-dark">({reviewCount})</span>
                </span>
              ) : null}
            </div>
          </div>
        </Link>

        <div className="absolute top-4 right-4 z-10">
          <WishlistButton productId={product.id} initialSaved={initialSaved} />
        </div>
      </div>

      {showQuickView && (
        <QuickViewModal
          product={product}
          onClose={() => setShowQuickView(false)}
        />
      )}
    </>
  );
}
