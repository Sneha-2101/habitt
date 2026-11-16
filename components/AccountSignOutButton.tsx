"use client";

import { useCartStore } from "@/lib/cart-store";

export default function AccountSignOutButton({
  signOutAction,
}: {
  signOutAction: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={async () => {
        useCartStore.getState().clear();
        useCartStore.getState().setOwner(null);
        await signOutAction();
      }}
      className="text-[12.5px] font-medium text-clay hover:underline"
    >
      Sign out
    </button>
  );
}
