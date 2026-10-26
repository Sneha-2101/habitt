"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/lib/cart-store";
import { formatINR } from "@/lib/money";

export default function CartDrawer({
  isOpen: propsIsOpen,
  onClose: propsOnClose,
}: {
  isOpen?: boolean;
  onClose?: () => void;
} = {}) {
  const { items, updateQty, remove, isOpen: storeIsOpen, close: storeClose } = useCartStore();
  const isOpen = propsIsOpen ?? storeIsOpen;
  const onClose = propsOnClose ?? storeClose;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);

  return (
    <div
      className="fixed inset-0 bg-ink/40 z-50 flex justify-end transition-opacity"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] bg-paper h-full flex flex-col p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center pb-4 border-b border-stone">
          <h3 className="font-display text-xl font-medium">Your Bag</h3>
          <button
            onClick={onClose}
            className="p-1 hover:opacity-75 transition-opacity"
            aria-label="Close cart"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-stone-dark text-[13.5px]">Your bag is empty. Time to fix that.</p>
              <Link
                href="/shop"
                onClick={onClose}
                className="inline-block mt-4 px-6 py-2.5 bg-ink text-paper text-[12px] tracking-[0.06em] uppercase hover:opacity-90 transition-opacity"
              >
                Continue Shopping
              </Link>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.variantId}
                className="flex gap-3 mb-4 pb-4 border-b border-stone"
              >
                <div className="w-16 h-20 bg-card border border-stone/50 flex-shrink-0 flex items-center justify-center text-[10px] font-mono text-stone-dark">
                  {item.size}
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start">
                      <h4 className="text-[13.5px] font-medium leading-tight">{item.name}</h4>
                      <button
                        onClick={() => remove(item.variantId)}
                        className="text-stone-dark hover:text-clay transition-colors p-1"
                        aria-label="Remove item"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                    <div className="text-[11.5px] text-stone-dark mt-0.5">Size {item.size}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2 border border-stone px-2 py-0.5">
                      <button
                        onClick={() => updateQty(item.variantId, -1)}
                        className="hover:opacity-60 transition-opacity"
                        aria-label="Decrease quantity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      <span className="text-[12px] font-mono w-4 text-center">{item.qty}</span>
                      <button
                        onClick={() => updateQty(item.variantId, 1)}
                        className="hover:opacity-60 transition-opacity"
                        aria-label="Increase quantity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    </div>
                    <div className="font-mono text-[12.5px]">
                      {formatINR(item.unitPrice * item.qty)}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-stone pt-4 mt-auto">
            <div className="flex justify-between items-center text-sm mb-4">
              <span>Subtotal</span>
              <span className="font-mono text-[15px] font-medium">{formatINR(subtotal)}</span>
            </div>
            <Link
              href="/checkout"
              onClick={onClose}
              className="w-full py-3.5 bg-ink text-paper text-[13px] tracking-[0.06em] flex items-center justify-center gap-2 uppercase hover:opacity-90 transition-opacity"
            >
              Checkout
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
