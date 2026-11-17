"use client";

import { useEffect, useRef } from "react";
import { useCartStore } from "@/lib/cart-store";
import { syncCartAction, saveCartAction, loadCartAction } from "@/lib/actions/cart";
import { decideCartSync, CartSyncDecision, DecideCartSyncInput } from "@/lib/cart/merge";

export { decideCartSync };
export type { CartSyncDecision, DecideCartSyncInput };

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

export default function CartSync({ isSignedIn, userId = null }: CartSyncProps) {
  const isSyncingRef = useRef(false);
  const prevUserIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const ownerId = useCartStore((state) => state.ownerId);

  useEffect(() => {
    const status = isSignedIn && userId ? "authenticated" : "unauthenticated";
    const decision = decideCartSync({
      status,
      userId,
      ownerId,
      prevUserId: prevUserIdRef.current,
    });

    if (decision === "wait" || decision === "noop") {
      return;
    }

    if (decision === "clear") {
      useCartStore.getState().clear();
      useCartStore.getState().setOwner(null);
      prevUserIdRef.current = null;
      return;
    }

    if (decision === "load") {
      isSyncingRef.current = true;
      prevUserIdRef.current = userId;
      loadCartAction()
        .then((result) => {
          useCartStore.setState({ items: result.items });
          useCartStore.getState().setOwner(userId);
        })
        .catch((err) => {
          console.error("[CartSync] Load cart error:", err);
        })
        .finally(() => {
          isSyncingRef.current = false;
        });
      return;
    }

    if (decision === "merge") {
      isSyncingRef.current = true;
      prevUserIdRef.current = userId;
      const localItems = useCartStore.getState().items;
      syncCartAction(localItems)
        .then((result) => {
          useCartStore.setState({ items: result.items });
          useCartStore.getState().setOwner(userId);
        })
        .catch((err) => {
          console.error("[CartSync] Merge cart error:", err);
        })
        .finally(() => {
          isSyncingRef.current = false;
        });
      return;
    }

    if (decision === "switch-load") {
      isSyncingRef.current = true;
      prevUserIdRef.current = userId;
      useCartStore.getState().clear();
      useCartStore.getState().setOwner(userId);
      loadCartAction()
        .then((result) => {
          useCartStore.setState({ items: result.items });
        })
        .catch((err) => {
          console.error("[CartSync] Switch-load cart error:", err);
        })
        .finally(() => {
          isSyncingRef.current = false;
        });
      return;
    }
  }, [isSignedIn, userId, ownerId]);

  useEffect(() => {
    if (!isSignedIn || !userId) return;

    const unsubscribe = useCartStore.subscribe((state) => {
      if (isSyncingRef.current) return;
      if (state.ownerId !== userId) return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(async () => {
        if (isSyncingRef.current) return;
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
  }, [isSignedIn, userId]);

  return null;
}
