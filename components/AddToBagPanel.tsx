"use client";

import React, { useState } from "react";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";
import SizeGuideModal from "@/components/SizeGuideModal";
import { requestStockNotification } from "@/lib/actions/notifications";
import { sortSizes } from "@/lib/catalog/categories";
import { groupVariants, pickDefaultVariant } from "@/lib/catalog/variants";
import { useProductColor } from "@/components/ProductColorContext";
import { buildAddToCartPayload } from "@/lib/consent/pixel-payload";

interface Variant {
  id: string;
  sku?: string | null;
  size: string;
  color?: string;
  colorHex?: string | null;
  stock: number;
}

export default function AddToBagPanel({
  productId,
  productName,
  price,
  category,
  categorySizes = [],
  variants,
  sizeChartUrl,
  freeShippingThreshold = 299900,
  freeShippingOnPrepaid = true,
}: {
  productId: string;
  productName: string;
  price: number;
  category: string;
  categorySizes?: string[];
  variants: Variant[];
  sizeChartUrl?: string | null;
  freeShippingThreshold?: number;
  freeShippingOnPrepaid?: boolean;
}) {
  const grouped = groupVariants(
    variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color || "",
      colorHex: v.colorHex || null,
      stock: v.stock,
    })),
    categorySizes
  );

  const defaultSelection = pickDefaultVariant(grouped);
  const variantSizes = variants.map((v) => v.size);
  const orderedSizes = sortSizes(variantSizes, categorySizes);

  const [selectedColor, setSelectedColor] = useState<string>(
    grouped.hasColors
      ? defaultSelection?.color || grouped.colors[0]?.color || ""
      : ""
  );

  const [selectedSize, setSelectedSize] = useState<string>(
    grouped.hasColors
      ? defaultSelection?.size || grouped.colors[0]?.sizes[0]?.size || "M"
      : variants.find((v) => v.stock > 0)?.size || orderedSizes[0] || "M"
  );

  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyMsg, setNotifyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmittingNotify, setIsSubmittingNotify] = useState(false);

  const colorCtx = useProductColor();
  const add = useCartStore((s) => s.add);
  const open = useCartStore((s) => s.open);

  const activeColorGroup = grouped.hasColors
    ? grouped.colors.find((c) => c.color === selectedColor) || grouped.colors[0]
    : null;

  const activeVariant = grouped.hasColors
    ? variants.find(
        (v) => (v.color || "") === (activeColorGroup?.color || "") && v.size === selectedSize
      )
    : variants.find((v) => v.size === selectedSize);

  const stock = activeVariant?.stock || 0;
  const isOutOfStock = stock <= 0;

  const handleSelectColor = (colorName: string) => {
    setSelectedColor(colorName);
    colorCtx?.setSelectedColor(colorName);
    setNotifyMsg(null);
    const colorGroup = grouped.colors.find((c) => c.color === colorName);
    if (colorGroup) {
      const hasSameSize = colorGroup.sizes.some((s) => s.size === selectedSize);
      if (!hasSameSize) {
        const firstInStock = colorGroup.sizes.find((s) => s.stock > 0);
        setSelectedSize(firstInStock?.size || colorGroup.sizes[0]?.size || selectedSize);
      }
    }
  };

  const handleAddToBag = () => {
    if (!activeVariant || isOutOfStock) return;

    add({
      productId,
      variantId: activeVariant.id,
      sku: activeVariant.sku ?? null,
      name: productName,
      size: selectedSize,
      color: activeVariant.color || undefined,
      unitPrice: price,
      qty: 1,
    });

    import("@/components/MetaPixel").then(({ trackPixelEvent }) => {
      trackPixelEvent(
        "AddToCart",
        buildAddToCartPayload({
          variant: {
            productId,
            variantId: activeVariant.id,
            sku: activeVariant.sku ?? null,
          },
          priceRupees: price / 100,
        })
      );
    });

    open();
  };

  async function handleNotifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeVariant) return;
    setNotifyMsg(null);
    setIsSubmittingNotify(true);

    try {
      await requestStockNotification(notifyEmail, productId, activeVariant.id);
      setNotifyMsg({ type: "success", text: `We'll email you when size ${selectedSize} is back in stock!` });
      setNotifyEmail("");
    } catch (err) {
      setNotifyMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to save request." });
    } finally {
      setIsSubmittingNotify(false);
    }
  }

  const shippingNote = freeShippingOnPrepaid
    ? "Free shipping on prepaid orders"
    : `Free shipping over ${formatINR(freeShippingThreshold)}`;

  return (
    <>
      {/* COLOR SWATCHES (ONLY WHEN hasColors IS TRUE) */}
      {grouped.hasColors && (
        <div className="mt-6">
          <div className="flex items-center gap-2 text-[11px] tracking-[0.08em] text-stone-dark mb-2">
            <span>COLOR:</span>
            <span className="text-ink font-medium tracking-normal">{selectedColor}</span>
          </div>
          <div className="flex gap-2.5 flex-wrap items-center">
            {grouped.colors.map((c) => {
              const isSelected = selectedColor === c.color;
              const isSoldOut = !c.inStock;

              return (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => handleSelectColor(c.color)}
                  aria-label={`Select color ${c.color}${isSoldOut ? " (sold out)" : ""}`}
                  title={`${c.color}${isSoldOut ? " - Out of stock" : ""}`}
                  className={`relative w-8 h-8 border border-stone/70 transition-all ${
                    isSelected ? "outline outline-2 outline-ink outline-offset-2" : "hover:border-ink"
                  }`}
                  style={{
                    backgroundColor: c.colorHex || "#e5e5e5",
                  }}
                >
                  {isSoldOut && (
                    <svg
                      className="absolute inset-0 w-full h-full text-stone-dark/80 pointer-events-none"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SIZES */}
      <div className="mt-6">
        <div className="flex items-center justify-between text-[11px] tracking-[0.08em] text-stone-dark mb-2">
          <span>SIZE</span>
          <button
            type="button"
            onClick={() => setShowSizeGuide(true)}
            className="underline font-sans text-stone-dark hover:text-ink text-[12px] font-medium"
          >
            Size guide
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {grouped.hasColors ? (
            activeColorGroup?.sizes.map((s) => {
              const disabled = s.stock <= 0;
              const isSelected = selectedSize === s.size;

              return (
                <button
                  key={s.size}
                  type="button"
                  onClick={() => {
                    setSelectedSize(s.size);
                    setNotifyMsg(null);
                  }}
                  className={`w-11 h-11 border text-[13px] font-mono transition-colors ${
                    isSelected
                      ? "border-ink bg-ink text-paper"
                      : disabled
                      ? "border-stone/50 bg-stone/20 text-stone-dark cursor-pointer line-through"
                      : "border-stone bg-transparent text-ink hover:border-ink"
                  }`}
                >
                  {s.size}
                </button>
              );
            })
          ) : (
            orderedSizes.map((size) => {
              const v = variants.find((variant) => variant.size === size);
              const variantStock = v?.stock || 0;
              const disabled = variantStock <= 0;
              const isSelected = selectedSize === size;

              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setSelectedSize(size);
                    setNotifyMsg(null);
                  }}
                  className={`w-11 h-11 border text-[13px] font-mono transition-colors ${
                    isSelected
                      ? "border-ink bg-ink text-paper"
                      : disabled
                      ? "border-stone/50 bg-stone/20 text-stone-dark cursor-pointer line-through"
                      : "border-stone bg-transparent text-ink hover:border-ink"
                  }`}
                >
                  {size}
                </button>
              );
            })
          )}
        </div>
      </div>

      {isOutOfStock ? (
        <div className="mt-6 p-4 border border-stone bg-paper/60 rounded-sm space-y-2">
          <p className="text-xs font-semibold text-ink">
            Size {selectedSize} is currently out of stock.
          </p>
          <p className="text-[12px] text-stone-dark">
            Enter your email to be notified when size {selectedSize} becomes available.
          </p>
          <form onSubmit={handleNotifySubmit} className="flex gap-2 pt-1">
            <input
              type="email"
              required
              placeholder="Your email address..."
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              className="flex-1 px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={isSubmittingNotify}
              className="px-4 py-2 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] rounded-sm disabled:opacity-50"
            >
              {isSubmittingNotify ? "..." : "NOTIFY ME"}
            </button>
          </form>
          {notifyMsg && (
            <p className={`text-xs font-medium ${notifyMsg.type === "success" ? "text-moss" : "text-clay"}`}>
              {notifyMsg.text}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={handleAddToBag}
          className="mt-7 w-full py-3.5 bg-ink text-paper hover:opacity-90 text-[13px] tracking-[0.06em] uppercase transition-opacity rounded-sm font-medium"
        >
          ADD TO BAG
        </button>
      )}

      <div className="mt-3 text-[11.5px] text-stone-dark flex items-center justify-between">
        <span>{stock > 0 ? `${stock} in stock` : `Size ${selectedSize} unavailable`}</span>
        <span>{shippingNote}</span>
      </div>

      {showSizeGuide && (
        <SizeGuideModal
          category={category}
          sizeChartUrl={sizeChartUrl}
          onClose={() => setShowSizeGuide(false)}
        />
      )}
    </>
  );
}
