"use client";

import { useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import { savingsPaise } from "@/lib/catalog/pricing-display";
import { CareTag } from "@/components/CareTag";
import { useCartStore } from "@/lib/cart-store";

interface QuickViewModalProps {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    compareAtPrice?: number | null;
    category: string | { name: string };
    images?: Array<{ url: string }>;
    variants?: Array<{ id: string; size: string; stock: number; color?: string; colorHex?: string | null }>;
  };
  onClose: () => void;
}

export default function QuickViewModal({ product, onClose }: QuickViewModalProps) {
  const { add: addCartItem, open: openCart } = useCartStore();
  const variants = product.variants || [];
  const hasColors = variants.some((v) => Boolean(v.color && v.color.trim() !== ""));
  const [selectedSize, setSelectedSize] = useState<string>(variants.find((v) => v.stock > 0)?.size || variants[0]?.size || "M");
  const [added, setAdded] = useState(false);
  const savings = savingsPaise(product.price, product.compareAtPrice);

  const selectedVariant = variants.find((v) => v.size === selectedSize);
  const isOutOfStock = !selectedVariant || selectedVariant.stock <= 0;

  function handleAddToCart() {
    if (!selectedVariant || isOutOfStock) return;

    addCartItem({
      productId: product.id,
      variantId: selectedVariant.id,
      name: product.name,
      size: selectedVariant.size,
      unitPrice: product.price,
      qty: 1,
    });

    setAdded(true);
    setTimeout(() => {
      onClose();
      openCart();
    }, 400);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-stone p-6 rounded-2xl max-w-lg w-full relative shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-dark hover:text-ink text-sm p-1"
        >
          ✕
        </button>

        <div className="flex flex-col sm:flex-row gap-5">
          {product.images?.[0]?.url && (
            <div className="w-full sm:w-1/2 aspect-[4/5] rounded-xl overflow-hidden bg-paper border border-stone/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.images[0].url} alt={product.name} className="w-full h-full object-cover" />
            </div>
          )}

          <div className="w-full sm:w-1/2 flex flex-col justify-between space-y-4">
            <div>
              <span className="text-[11px] font-mono uppercase text-stone-dark tracking-wider">
                {typeof product.category === "string" ? product.category.toUpperCase() : product.category?.name?.toUpperCase()}
              </span>
              <h3 className="font-display text-xl text-ink font-medium mt-0.5">{product.name}</h3>
              <div className="flex items-center gap-2 mt-2 font-mono">
                <span className="text-base font-semibold text-ink">{formatINR(product.price)}</span>
                {savings !== null && product.compareAtPrice && (
                  <>
                    <span className="line-through text-stone-dark text-sm">
                      {formatINR(product.compareAtPrice)}
                    </span>
                    <CareTag>SAVE {formatINR(savings)}</CareTag>
                  </>
                )}
              </div>
            </div>

            {hasColors ? (
              <Link
                href={`/product/${product.slug}`}
                className="w-full py-3 bg-ink text-paper text-xs font-medium uppercase tracking-[0.06em] hover:bg-opacity-90 transition-all rounded-sm text-center block"
              >
                Choose color & size
              </Link>
            ) : (
              <>
                {/* Size Selector */}
                {variants.length > 0 && (
                  <div>
                    <label className="block text-[12px] font-medium text-stone-dark mb-1.5">Select Size</label>
                    <div className="flex gap-2 flex-wrap">
                      {variants.map((v) => {
                        const isOOS = v.stock <= 0;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={isOOS}
                            onClick={() => setSelectedSize(v.size)}
                            className={`px-3 py-1.5 text-xs font-mono border rounded transition-all ${
                              selectedSize === v.size
                                ? "border-ink bg-ink text-paper font-bold"
                                : isOOS
                                ? "border-stone/40 bg-stone/10 text-stone-dark line-through cursor-not-allowed"
                                : "border-stone bg-white text-ink hover:border-ink"
                            }`}
                          >
                            {v.size}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={isOutOfStock}
                  onClick={handleAddToCart}
                  className="w-full py-3 bg-ink text-paper text-xs font-medium uppercase tracking-[0.06em] hover:bg-opacity-90 disabled:opacity-50 transition-all rounded-sm"
                >
                  {added ? "ADDED TO BAG ✓" : isOutOfStock ? "OUT OF STOCK" : "ADD TO BAG"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
