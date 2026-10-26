"use client";

import React, { useState } from "react";
import { Size } from "@prisma/client";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";
import SizeGuideModal from "@/components/SizeGuideModal";
import { requestStockNotification } from "@/lib/actions/notifications";

interface Variant {
  id: string;
  size: Size;
  stock: number;
}

export default function AddToBagPanel({
  productId,
  productName,
  price,
  category,
  variants,
}: {
  productId: string;
  productName: string;
  price: number;
  category: string;
  variants: Variant[];
}) {
  const [selectedSize, setSelectedSize] = useState<Size>(
    variants.find((v) => v.stock > 0)?.size || variants[0]?.size || "M"
  );
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyMsg, setNotifyMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isSubmittingNotify, setIsSubmittingNotify] = useState(false);

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

  return (
    <>
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
          {(["S", "M", "L", "XL", "XXL"] as Size[]).map((size) => {
            const v = variants.find((variant) => variant.size === size);
            const variantStock = v?.stock || 0;
            const disabled = variantStock <= 0;
            const isSelected = selectedSize === size;

            return (
              <button
                key={size}
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
          })}
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
        <span>Free shipping over {formatINR(299900)}</span>
      </div>

      {showSizeGuide && (
        <SizeGuideModal category={category} onClose={() => setShowSizeGuide(false)} />
      )}
    </>
  );
}
