import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/sessions";
import { formatINR } from "@/lib/money";
import { getWalletSummary } from "@/lib/wallet/service";
import type { WalletEntryType } from "@prisma/client";

export const dynamic = "force-dynamic";

function formatEntryLabel(type: WalletEntryType, reason: string): string {
  switch (type) {
    case "CREDIT":
      return "Credit added";
    case "DEBIT": {
      const match = reason.match(/Order #(HB-\d+)/i);
      return match ? `Used on order #${match[1]}` : "Used on order";
    }
    case "RESTORE":
      return "Restored";
    case "EXPIRE":
      return "Expired";
    case "ADJUST":
      return "Adjustment";
    default:
      return "Wallet activity";
  }
}

export default async function AccountWalletPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login?redirect=/account/wallet");

  const summary = await getWalletSummary(sessionUser.id);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-ink">My Wallet</h1>
          <p className="text-xs text-stone-dark mt-1">
            Available store credit, expiry schedule, and recent activity.
          </p>
        </div>
        <Link href="/account" className="text-xs underline text-stone-dark hover:text-ink">
          &larr; Back to Account
        </Link>
      </div>

      <div className="border border-stone bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <span className="text-xs uppercase tracking-wider text-stone-dark">
            Available Balance
          </span>
          <span className="font-mono text-3xl font-semibold text-ink">
            {formatINR(summary.balancePaise)}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-stone/60 text-xs">
          <div>
            <span className="text-stone-dark block">Refund Credit (No Expiry)</span>
            <strong className="text-sm text-ink">{formatINR(summary.byKind.REFUND)}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Promo Credit (Expiring)</span>
            <strong className="text-sm text-ink">{formatINR(summary.byKind.PROMO)}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Adjustments</span>
            <strong className="text-sm text-ink">{formatINR(summary.byKind.ADJUST)}</strong>
          </div>
        </div>
      </div>

      <div className="border border-stone bg-white p-6 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
          Active Credit Lots ({summary.activeLots.length})
        </h2>
        {summary.activeLots.length === 0 ? (
          <p className="text-xs text-stone-dark">You have no active wallet credits.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-stone text-stone-dark">
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Remaining</th>
                  <th className="py-2">Expires</th>
                </tr>
              </thead>
              <tbody>
                {summary.activeLots.map((lot) => (
                  <tr key={lot.id} className="border-b border-stone/40">
                    <td className="py-2 pr-3 font-medium">
                      {lot.kind === "PROMO"
                        ? "Promo Credit"
                        : lot.kind === "REFUND"
                        ? "Refund Credit"
                        : "Adjustment"}
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatINR(lot.remainingPaise)}</td>
                    <td className="py-2">
                      {lot.expiresAt ? lot.expiresAt.toISOString().slice(0, 10) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border border-stone bg-white p-6 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
          Recent Activity ({summary.recentEntries.length})
        </h2>
        {summary.recentEntries.length === 0 ? (
          <p className="text-xs text-stone-dark">No wallet activity yet.</p>
        ) : (
          <div className="divide-y divide-stone/40">
            {summary.recentEntries.map((entry) => (
              <div key={entry.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-medium text-ink">
                    {formatEntryLabel(entry.type, entry.reason)}
                  </div>
                  <div className="text-[11px] text-stone-dark font-mono">
                    {entry.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className={entry.amountPaise > 0 ? "text-emerald-700" : "text-ink"}>
                    {entry.amountPaise > 0 ? "+" : ""}
                    {formatINR(entry.amountPaise)}
                  </div>
                  <div className="text-[11px] text-stone-dark">
                    Bal: {formatINR(entry.balanceAfterPaise)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
