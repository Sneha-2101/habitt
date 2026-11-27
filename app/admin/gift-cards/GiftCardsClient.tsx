"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatINR } from "@/lib/money";
import {
  issueGiftCardsAction,
  voidGiftCardAction,
  type GiftCardListItem,
  type IssuedGiftCardResult,
} from "@/lib/actions/gift-cards";

function getStateBadgeClass(state: GiftCardListItem["state"]): string {
  switch (state) {
    case "ISSUED":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "REDEEMED":
      return "bg-stone/30 text-ink border-stone";
    case "VOID":
      return "bg-red-50 text-red-800 border-red-200";
    case "EXPIRED":
      return "bg-amber-50 text-amber-800 border-amber-200";
  }
}

export default function GiftCardsClient({
  initialCards,
  outstandingLiabilityPaise,
  maxAdminAdjustPaise,
  defaultRedeemByIst,
}: {
  initialCards: GiftCardListItem[];
  outstandingLiabilityPaise: number;
  maxAdminAdjustPaise: number;
  defaultRedeemByIst: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const maxRupees = Math.max(1, Math.floor(maxAdminAdjustPaise / 100));
  const [amountRupees, setAmountRupees] = useState("500");
  const [redeemBy, setRedeemBy] = useState(defaultRedeemByIst);
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuedCodes, setIssuedCodes] = useState<IssuedGiftCardResult[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedAmount = Number(amountRupees);
    const parsedQty = Number(quantity);

    startTransition(async () => {
      try {
        const res = await issueGiftCardsAction({
          amountRupees: parsedAmount,
          redeemBy,
          quantity: parsedQty,
          note: note.trim() || null,
        });
        setIssuedCodes(res.cards);
        setNote("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to issue gift cards.");
      }
    });
  }

  function handleVoid(card: GiftCardListItem) {
    if (
      !window.confirm(
        `Void gift card ****${card.last4} (${formatINR(card.amountPaise)})? This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await voidGiftCardAction(card.id);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to void gift card.");
      }
    });
  }

  async function handleCopy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  return (
    <div className="space-y-6">
      <div className="border border-stone bg-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-stone-dark block">
            Outstanding Gift Card Liability
          </span>
          <span className="font-mono text-2xl font-semibold text-ink">
            {formatINR(outstandingLiabilityPaise)}
          </span>
        </div>
        <p className="text-xs text-stone-dark">
          Sum of unredeemed, non-expired issued gift cards.
        </p>
      </div>

      <form onSubmit={handleIssue} className="border border-stone bg-card p-5 space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
          Issue Gift Cards
        </h2>

        {error && (
          <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-stone-dark mb-1">
              Amount (₹, max ₹{maxRupees})
            </label>
            <input
              type="number"
              min={1}
              max={maxRupees}
              step={1}
              required
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              className="w-full px-3 py-2 border border-stone bg-white text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-stone-dark mb-1">
              Redeem By (IST EOD)
            </label>
            <input
              type="date"
              required
              value={redeemBy}
              onChange={(e) => setRedeemBy(e.target.value)}
              className="w-full px-3 py-2 border border-stone bg-white text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-stone-dark mb-1">
              Quantity (1–20)
            </label>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full px-3 py-2 border border-stone bg-white text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-stone-dark mb-1">
              Note (optional, max 200)
            </label>
            <input
              type="text"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VIP / PR / Campaign"
              className="w-full px-3 py-2 border border-stone bg-white text-sm"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 bg-ink text-white text-xs uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Issuing..." : "Issue Gift Cards"}
        </button>
      </form>

      {issuedCodes.length > 0 && (
        <div className="border border-amber-400 bg-amber-50/70 p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xs uppercase tracking-wider font-semibold text-amber-900">
                One-Time Gift Card Codes ({issuedCodes.length})
              </h2>
              <p className="text-xs text-amber-800 mt-0.5">
                Copy these codes now. Only a one-way hash is stored, so they cannot be shown again after you leave or refresh.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                handleCopy(issuedCodes.map((c) => c.code).join("\n"), "all")
              }
              className="px-3 py-1.5 border border-amber-700 text-amber-900 text-xs hover:bg-amber-100"
            >
              {copiedId === "all" ? "Copied all" : "Copy all"}
            </button>
          </div>

          <div className="divide-y divide-amber-200 bg-white border border-amber-200">
            {issuedCodes.map((c) => (
              <div
                key={c.id}
                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-ink select-all">
                    {c.code}
                  </span>
                  <span className="font-mono text-stone-dark">
                    {formatINR(c.amountPaise)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(c.code, c.id)}
                  className="px-2.5 py-1 border border-stone text-ink hover:bg-paper"
                >
                  {copiedId === c.id ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-stone bg-card overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-stone bg-paper text-stone-dark uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Redeem By</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone/60">
            {initialCards.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-stone-dark">
                  No gift cards issued yet.
                </td>
              </tr>
            ) : (
              initialCards.map((card) => (
                <tr key={card.id}>
                  <td className="px-4 py-3 font-mono font-medium text-ink">
                    ****{card.last4}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">
                    {formatINR(card.amountPaise)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 border text-[10px] font-semibold uppercase tracking-wider ${getStateBadgeClass(card.state)}`}
                    >
                      {card.state}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-stone-dark">
                    {new Date(card.redeemBy).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="px-4 py-3 text-stone-dark max-w-xs truncate">
                    {card.note || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-stone-dark">
                    {new Date(card.createdAt).toLocaleDateString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {card.state === "ISSUED" ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleVoid(card)}
                        className="px-2.5 py-1 border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Void
                      </button>
                    ) : (
                      <span className="text-stone-dark">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
