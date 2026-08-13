"use client";

import React, { useState } from "react";
import { Size } from "@prisma/client";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";

interface Variant {
  id: string;
  size: Size;
  stock: number;
}

export default function AddToBagPanel({
  productId,
  productName,
  price,
  variants,
}: {
  productId: string;
  productName: string;
  price: number;
  variants: Variant[];
}) {
  const [selectedSize, setSelectedSize] = useState<Size>(
    variants.find((v) => v.stock > 0)?.size || "M"
  );
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);

  const activeVariant = variants.find((v) => v.size === selectedSize);
  const stock = activeVariant?.stock || 0;
  const isOutOfStock = stock <= 0;

  const handleAddToBag = () => {
    if (!activeVariant || isOutOfStock) return;

    add({
      productId,
      variantId: activeVariant.id,
      name: productName,
      size: selectedSize,
      unitPrice: price,
      qty: 1,
    });

    open();
  };

  return (
    <>
      <div className="mt-6">
        <div className="text-[11px] tracking-[0.08em] text-stone-dark mb-2">SIZE</div>
        <div className="flex gap-2 flex-wrap">
          {(["S", "M", "L", "XL", "XXL"] as Size[]).map((size) => {
            const v = variants.find((variant) => variant.size === size);
            const variantStock = v?.stock || 0;
            const disabled = variantStock <= 0;
            const isSelected = selectedSize === size;

            return (
              <button
                key={size}
                disabled={disabled}
                onClick={() => setSelectedSize(size)}
                className={`w-11 h-11 border text-[13px] font-mono transition-colors ${
                  isSelected
                    ? "border-ink bg-ink text-paper"
                    : disabled
                    ? "border-stone/50 bg-stone/20 text-stone-dark cursor-not-allowed line-through"
                    : "border-stone bg-transparent text-ink hover:border-ink"
                }`}
              >
                {size}
              </button>
            );
          })}
        </div>
      </div>

      <button
        disabled={isOutOfStock}
        onClick={handleAddToBag}
        className={`mt-7 w-full py-3.5 text-[13px] tracking-[0.06em] uppercase transition-opacity ${
          isOutOfStock
            ? "bg-stone text-stone-dark cursor-not-allowed"
            : "bg-ink text-paper hover:opacity-90"
        }`}
      >
        {isOutOfStock ? "OUT OF STOCK" : "ADD TO BAG"}
      </button>

      <div className="mt-3 text-[11.5px] text-stone-dark flex items-center justify-between">
        <span>{stock > 0 ? `${stock} in stock` : "Unavailable"}</span>
        <span>Free shipping over {formatINR(299900)}</span>
      </div>
    </>
  );
}
