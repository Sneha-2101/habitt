"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyReferralCodeAction } from "@/lib/actions/referral";

export default function ReferralCodeForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await applyReferralCodeAction(code);
      setMessage(res.message);
      setCode("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-stone bg-white p-6 space-y-3">
      <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
        Have a referral code?
      </h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter referral code"
          maxLength={16}
          className="flex-1 border border-stone bg-white px-3 py-2 text-sm text-ink uppercase"
          required
        />
        <button
          type="submit"
          disabled={isPending}
          className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider disabled:opacity-50"
        >
          {isPending ? "Applying..." : "Apply"}
        </button>
      </div>
      {message && <p className="text-xs text-stone-dark">{message}</p>}
    </form>
  );
}
