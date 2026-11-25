"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLoyaltyReferralSettingsAction } from "@/lib/actions/wallet-admin";

export default function LoyaltyReferralSettingsForm({
  initialSettings,
}: {
  initialSettings: {
    loyaltyEnabled: boolean;
    loyaltyModel: "FLAT_PERCENT";
    loyaltyPercentBps: number;
    referralEnabled: boolean;
    referrerRewardPaise: number;
    refereeRewardPaise: number;
    referralMonthlyCapPerReferrer: number;
    referralMinOrderPaise: number;
    referralValidityDays: number;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(initialSettings.loyaltyEnabled);
  const [loyaltyPercentBps, setLoyaltyPercentBps] = useState(String(initialSettings.loyaltyPercentBps));
  const [referralEnabled, setReferralEnabled] = useState(initialSettings.referralEnabled);
  const [referrerRewardPaise, setReferrerRewardPaise] = useState(String(initialSettings.referrerRewardPaise));
  const [refereeRewardPaise, setRefereeRewardPaise] = useState(String(initialSettings.refereeRewardPaise));
  const [referralMonthlyCapPerReferrer, setReferralMonthlyCapPerReferrer] = useState(
    String(initialSettings.referralMonthlyCapPerReferrer)
  );
  const [referralMinOrderPaise, setReferralMinOrderPaise] = useState(
    String(initialSettings.referralMinOrderPaise)
  );
  const [referralValidityDays, setReferralValidityDays] = useState(
    String(initialSettings.referralValidityDays)
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        await updateLoyaltyReferralSettingsAction({
          loyaltyEnabled,
          loyaltyModel: "FLAT_PERCENT",
          loyaltyPercentBps: Number(loyaltyPercentBps),
          referralEnabled,
          referrerRewardPaise: Number(referrerRewardPaise),
          refereeRewardPaise: Number(refereeRewardPaise),
          referralMonthlyCapPerReferrer: Number(referralMonthlyCapPerReferrer),
          referralMinOrderPaise: Number(referralMinOrderPaise),
          referralValidityDays: Number(referralValidityDays),
        });
        setSuccess("Loyalty & Referral settings saved.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save settings.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="border border-stone bg-white p-5 space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
              Loyalty
            </h2>
            <p className="text-xs text-stone-dark">
              Credits a flat percentage of non-wallet net goods after the return window closes.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={loyaltyEnabled}
              onChange={(e) => setLoyaltyEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Earn Rate (bps, 200 = 2%, 0-5000)
            </label>
            <input
              type="number"
              min={0}
              max={5000}
              step={1}
              value={loyaltyPercentBps}
              onChange={(e) => setLoyaltyPercentBps(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>
        </div>
      </div>

      <div className="border-t border-stone/60 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
              Referrals
            </h2>
            <p className="text-xs text-stone-dark">
              Friend gets promo credit once email and phone are verified; referrer earns after friend&apos;s first order passes the return window.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={referralEnabled}
              onChange={(e) => setReferralEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Referrer Reward (paise, 0-1000000)
            </label>
            <input
              type="number"
              min={0}
              max={1000000}
              step={1}
              value={referrerRewardPaise}
              onChange={(e) => setReferrerRewardPaise(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Friend Reward (paise, 0-1000000)
            </label>
            <input
              type="number"
              min={0}
              max={1000000}
              step={1}
              value={refereeRewardPaise}
              onChange={(e) => setRefereeRewardPaise(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Monthly Cap / Referrer (0-1000)
            </label>
            <input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={referralMonthlyCapPerReferrer}
              onChange={(e) => setReferralMonthlyCapPerReferrer(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Min First Order Goods (paise)
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={referralMinOrderPaise}
              onChange={(e) => setReferralMinOrderPaise(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stone-dark mb-1">
              Validity (days, 1-3650)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={referralValidityDays}
              onChange={(e) => setReferralValidityDays(e.target.value)}
              className="w-full border border-stone px-3 py-2 text-sm text-ink bg-white"
              required
            />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {success && <p className="text-xs text-emerald-700">{success}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save Loyalty & Referral Settings"}
      </button>
    </form>
  );
}
