"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/money";
import { redeemGiftCardAction } from "@/lib/actions/gift-cards";

export default function RedeemGiftCardForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creditedPaise, setCreditedPaise] = useState<number | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreditedPaise(null);

    startTransition(async () => {
      try {
        const res = await redeemGiftCardAction(code);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setCreditedPaise(res.amountPaise);
        setCode("");
        router.refresh();
      } catch {
        setError("This code isn't valid or can't be used.");
      }
    });
  }

  return (
    <div className="border border-stone bg-white p-6 space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
        Redeem a gift card
      </h2>
      <p className="text-xs text-stone-dark">
        Enter your gift card code to add its full value to your wallet. Redeemed credit never expires.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="GC-XXXX-XXXX-XXXX"
          required
          className="flex-1 min-w-[220px] px-3 py-2 border border-stone bg-paper text-sm font-mono uppercase"
        />
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-ink text-white text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Redeeming..." : "Redeem"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {creditedPaise !== null && (
        <p className="text-xs text-emerald-700" role="status">
          Added {formatINR(creditedPaise)} to your wallet.
        </p>
      )}
    </div>
  );
}
