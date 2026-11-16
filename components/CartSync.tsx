"use client";

import { useEffect, useRef } from "react";
import { useCartStore } from "@/lib/cart-store";
import { syncCartAction, saveCartAction, loadCartAction } from "@/lib/actions/cart";

interface CartSyncProps {
  isSignedIn: boolean;
  userId?: string | null;
}

export function handleStaleCartOwner(userId: string | null | undefined): boolean {
  if (userId === null) {
    const store = useCartStore.getState();
    if (store.ownerId !== null) {
      store.clear();
      store.setOwner(null);
      return true;
    }
  }
  return false;
}

export default function CartSync({ isSignedIn, userId }: CartSyncProps) {
  const isSyncingRef = useRef(false);
  const hasSyncedRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (userId === null) {
      const store = useCartStore.getState();
      if (store.ownerId !== null) {
        store.clear();
        store.setOwner(null);
      }
      hasSyncedRef.current = false;
      return;
    }

    if (!isSignedIn || !userId) return;
    if (hasSyncedRef.current || isSyncingRef.current) return;

    isSyncingRef.current = true;

    async function initialSync() {
      try {
        const store = useCartStore.getState();
        const currentOwner = store.ownerId;

        if (currentOwner === userId) {
          // Same user returning: load server cart, replace local
          const result = await loadCartAction();
          useCartStore.setState({ items: result.items });
        } else if (currentOwner === null) {
          // Guest logging in: merge local guest cart with server cart
          const localItems = store.items;
          const result = await syncCartAction(localItems);
          useCartStore.setState({ items: result.items });
        } else {
          // Different user logged in: discard other user's local items and load server cart
          useCartStore.getState().clear();
          const result = await loadCartAction();
          useCartStore.setState({ items: result.items });
        }

        useCartStore.getState().setOwner(userId ?? null);
      } catch (err) {
        console.error("[CartSync] Initial sync error:", err);
      } finally {
        isSyncingRef.current = false;
        hasSyncedRef.current = true;
      }
    }

    initialSync();
  }, [isSignedIn, userId]);

  useEffect(() => {
    if (!isSignedIn) return;

    const unsubscribe = useCartStore.subscribe((state) => {
      if (!hasSyncedRef.current || isSyncingRef.current) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        try {
          await saveCartAction(state.items);
        } catch (err) {
          console.error("[CartSync] Debounced save error:", err);
        }
      }, 1000);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isSignedIn]);

  return null;
}
