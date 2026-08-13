"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  productId: string;
  variantId: string;
  name: string;
  size: string;
  unitPrice: number; // paise
  qty: number;
}

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  add: (item: CartItem) => void;
  updateQty: (variantId: string, delta: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
}

// Persisted to localStorage on the real deployed site (fine outside of an
// artifact sandbox — this file is not used in the claude.ai prototype).
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      add: (item) =>
        set((state) => {
          const existing = state.items.find((i) => i.variantId === item.variantId);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.variantId === item.variantId ? { ...i, qty: i.qty + item.qty } : i
              ),
            };
          }
          return { items: [...state.items, item] };
        }),
      updateQty: (variantId, delta) =>
        set((state) => ({
          items: state.items
            .map((i) => (i.variantId === variantId ? { ...i, qty: i.qty + delta } : i))
            .filter((i) => i.qty > 0),
        })),
      remove: (variantId) =>
        set((state) => ({ items: state.items.filter((i) => i.variantId !== variantId) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: "habitt-cart",
      partialize: (state) => ({ items: state.items }),
    }
  )
);
