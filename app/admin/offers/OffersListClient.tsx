"use client";

import { useState } from "react";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { describeOffer } from "@/lib/offers/schema";
import { setOfferActive, deleteOffer } from "@/lib/actions/offers";

interface OfferRow {
  id: string;
  name: string;
  kind: string;
  code: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  minCartPaise: number;
  timesUsed: number;
  priority: number;
  audience: string;
  config: Prisma.JsonValue;
  legacyCouponId: string | null;
  createdAt: Date;
  _count: {
    redemptions: number;
  };
}

export default function OffersListClient({
  offers: initialOffers,
}: {
  offers: OfferRow[];
}) {
  const [offers, setOffers] = useState(initialOffers);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggleActive = async (id: string, current: boolean) => {
    setError(null);
    setLoadingId(id);
    try {
      await setOfferActive(id, !current);
      setOffers((prev) =>
        prev.map((o) => (o.id === id ? { ...o, active: !current } : o))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to toggle offer status");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this offer?")) return;
    setError(null);
    setLoadingId(id);
    try {
      await deleteOffer(id);
      setOffers((prev) => prev.filter((o) => o.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete offer");
    } finally {
      setLoadingId(null);
    }
  };

  const formatSchedule = (startsAt: Date | null, endsAt: Date | null) => {
    if (!startsAt && !endsAt) return "Always active";
    const startStr = startsAt ? new Date(startsAt).toLocaleDateString() : "Now";
    const endStr = endsAt ? new Date(endsAt).toLocaleDateString() : "No end";
    return `${startStr} – ${endStr}`;
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      <div className="bg-card border border-stone overflow-hidden">
        <table className="w-full text-left text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-stone bg-paper text-[11px] tracking-wider uppercase text-stone-dark">
              <th className="py-3 px-4">Offer / Summary</th>
              <th className="py-3 px-4 w-32">Type / Code</th>
              <th className="py-3 px-4 w-28">Status</th>
              <th className="py-3 px-4 w-40">Schedule</th>
              <th className="py-3 px-4 w-24 text-center">Used</th>
              <th className="py-3 px-4 w-20 text-center">Priority</th>
              <th className="py-3 px-4 text-right w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone">
            {offers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 px-4 text-center text-stone-dark">
                  No offers configured yet. Click &quot;Create Offer&quot; above to set up promotions or coupon codes.
                </td>
              </tr>
            ) : (
              offers.map((offer) => {
                const isBusy = loadingId === offer.id;
                const summary = describeOffer({
                  kind: offer.kind,
                  config: offer.config as Record<string, unknown> | null,
                  minCartPaise: offer.minCartPaise,
                  code: offer.code,
                });

                return (
                  <tr key={offer.id} className="hover:bg-paper/50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-ink">{offer.name}</div>
                      <div className="text-xs text-stone-dark mt-0.5">{summary}</div>
                    </td>
                    <td className="py-3 px-4">
                      {offer.code ? (
                        <span className="font-mono text-xs px-2 py-0.5 bg-paper border border-stone text-ink font-semibold">
                          {offer.code}
                        </span>
                      ) : (
                        <span className="text-[11px] text-stone-dark uppercase tracking-wider">
                          Automatic
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(offer.id, offer.active)}
                        disabled={isBusy}
                        className={`text-xs px-2 py-0.5 font-medium tracking-wide ${
                          offer.active
                            ? "bg-green-100 text-green-800 border border-green-200"
                            : "bg-stone-100 text-stone-500 border border-stone-200"
                        }`}
                      >
                        {offer.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-xs text-stone-dark">
                      {formatSchedule(offer.startsAt, offer.endsAt)}
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-stone-dark font-mono">
                      {offer.timesUsed}
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-stone-dark font-mono">
                      {offer.priority}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      <Link
                        href={`/admin/offers/${offer.id}`}
                        className="text-xs text-ink hover:underline font-medium"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(offer.id)}
                        disabled={isBusy}
                        className="text-xs text-red-600 hover:text-red-800 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
