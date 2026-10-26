"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleWishlist } from "@/lib/actions/wishlist";

export default function WishlistButton({
  productId,
  initialSaved = false,
  className = "",
}: {
  productId: string;
  initialSaved?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleToggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;

    setLoading(true);
    const optimistic = !saved;
    setSaved(optimistic);

    try {
      const res = await toggleWishlist(productId);
      setSaved(res.saved);
    } catch (err) {
      setSaved(!optimistic);
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Unauthorized") || msg.includes("sign in")) {
        router.push(`/login?redirect=/wantlist`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleToggle}
      aria-label={saved ? "Remove from Wantlist" : "Add to Wantlist"}
      title={saved ? "Remove from Wantlist" : "Add to Wantlist"}
      className={`p-2 rounded-full bg-white/90 hover:bg-white border border-stone/30 shadow-sm transition-all duration-200 hover:scale-105 ${className}`}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={saved ? "#CA3232" : "none"}
        stroke={saved ? "#CA3232" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
