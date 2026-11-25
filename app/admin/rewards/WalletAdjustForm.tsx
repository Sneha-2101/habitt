"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustCustomerWalletAction } from "@/lib/actions/wallet-admin";

export default function WalletAdjustForm({
  userId,
  maxAdminAdjustPaise,
}: {
  userId: string;
  maxAdminAdjustPaise: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deltaPaise, setDeltaPaise] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsedDelta = Number(deltaPaise);
    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setError("Enter a non-zero integer amount in paise (e.g. 5000 for Rs 50, or -2500).");
      return;
    }

    startTransition(async () => {
      try {
        const res = await adjustCustomerWalletAction({
          userId,
          deltaPaise: parsedDelta,
          reason,
          note: note.trim() || undefined,
        });
        setSuccess(`Wallet adjusted. New wallet balance: ${res.balancePaise} paise.`);
        setDeltaPaise("");
        setReason("");
        setNote("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to adjust wallet.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border border-stone bg-white p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
            Delta (paise, max &plusmn;{maxAdminAdjustPaise})
          </label>
          <input
            type="number"
            step={1}
            value={deltaPaise}
            onChange={(e) => setDeltaPaise(e.target.value)}
            placeholder="e.g. 10000 or -5000"
            className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
            required
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
            Reason (required)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Goodwill / correction reason"
            className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
            required
            minLength={3}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
          Internal Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional reference"
          className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
        />
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Apply Wallet Adjustment (OWNER)"}
      </button>
    </form>
  );
}
