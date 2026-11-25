"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRewardSettingsAction } from "@/lib/actions/wallet-admin";

export default function RewardSettingsForm({
  initialSettings,
}: {
  initialSettings: {
    promoCreditExpiryDays: number;
    walletMaxPercentOfOrder: number;
    maxAdminAdjustPaise: number;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [promoCreditExpiryDays, setPromoCreditExpiryDays] = useState(
    String(initialSettings.promoCreditExpiryDays)
  );
  const [walletMaxPercentOfOrder, setWalletMaxPercentOfOrder] = useState(
    String(initialSettings.walletMaxPercentOfOrder)
  );
  const [maxAdminAdjustPaise, setMaxAdminAdjustPaise] = useState(
    String(initialSettings.maxAdminAdjustPaise)
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        await updateRewardSettingsAction({
          promoCreditExpiryDays: Number(promoCreditExpiryDays),
          walletMaxPercentOfOrder: Number(walletMaxPercentOfOrder),
          maxAdminAdjustPaise: Number(maxAdminAdjustPaise),
        });
        setSuccess("Reward settings updated.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save reward settings.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-stone bg-white p-5 space-y-4">
      <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
        Wallet &amp; Reward Settings (OWNER)
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
            Promo Expiry (days, 1-3650)
          </label>
          <input
            type="number"
            min={1}
            max={3650}
            step={1}
            value={promoCreditExpiryDays}
            onChange={(e) => setPromoCreditExpiryDays(e.target.value)}
            className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
            required
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
            Max % of Order (0-100)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={walletMaxPercentOfOrder}
            onChange={(e) => setWalletMaxPercentOfOrder(e.target.value)}
            className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
            required
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
            Max Admin Adjust (paise, 1-5000000)
          </label>
          <input
            type="number"
            min={1}
            max={5000000}
            step={1}
            value={maxAdminAdjustPaise}
            onChange={(e) => setMaxAdminAdjustPaise(e.target.value)}
            className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
            required
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save Reward Settings"}
      </button>
    </form>
  );
}
