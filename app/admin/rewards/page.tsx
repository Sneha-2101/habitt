import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, requireRole, UnauthorizedError } from "@/lib/guards";
import { formatINR } from "@/lib/money";
import { getWalletSummary } from "@/lib/wallet/service";
import { maskIdentifier } from "@/lib/mask";
import WalletAdjustForm from "./WalletAdjustForm";
import RewardSettingsForm from "./RewardSettingsForm";
import LoyaltyReferralSettingsForm from "./LoyaltyReferralSettingsForm";

export const dynamic = "force-dynamic";

export default async function AdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; userId?: string }>;
}) {
  let actor;
  try {
    actor = await requireRole("OWNER");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/staff/login");
    }
    if (err instanceof ForbiddenError) {
      redirect("/admin");
    }
    throw err;
  }
  const isOwner = actor.role === "OWNER";

  const sp = await searchParams;
  const q = sp.q?.trim() || "";
  const selectedUserId = sp.userId?.trim() || "";

  const settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: {
      promoCreditExpiryDays: true,
      walletMaxPercentOfOrder: true,
      maxAdminAdjustPaise: true,
      loyaltyEnabled: true,
      loyaltyModel: true,
      loyaltyPercentBps: true,
      referralEnabled: true,
      referrerRewardPaise: true,
      refereeRewardPaise: true,
      referralMonthlyCapPerReferrer: true,
      referralMinOrderPaise: true,
      referralValidityDays: true,
    },
  });

  const rewardSettings = {
    promoCreditExpiryDays: settings?.promoCreditExpiryDays ?? 180,
    walletMaxPercentOfOrder: settings?.walletMaxPercentOfOrder ?? 100,
    maxAdminAdjustPaise: settings?.maxAdminAdjustPaise ?? 500000,
  };

  const loyaltyReferralSettings = {
    loyaltyEnabled: settings?.loyaltyEnabled ?? false,
    loyaltyModel: "FLAT_PERCENT" as const,
    loyaltyPercentBps: settings?.loyaltyPercentBps ?? 200,
    referralEnabled: settings?.referralEnabled ?? false,
    referrerRewardPaise: settings?.referrerRewardPaise ?? 0,
    refereeRewardPaise: settings?.refereeRewardPaise ?? 0,
    referralMonthlyCapPerReferrer: settings?.referralMonthlyCapPerReferrer ?? 10,
    referralMinOrderPaise: settings?.referralMinOrderPaise ?? 0,
    referralValidityDays: settings?.referralValidityDays ?? 90,
  };

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    promoOutstandingAgg,
    promoExpiring30Agg,
    creditedBySource,
    recentReferrals,
  ] = await Promise.all([
    prisma.walletLot.aggregate({
      where: {
        kind: "PROMO",
        remainingPaise: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { remainingPaise: true },
    }),
    prisma.walletLot.aggregate({
      where: {
        kind: "PROMO",
        remainingPaise: { gt: 0 },
        expiresAt: { gt: now, lte: in30Days },
      },
      _sum: { remainingPaise: true },
    }),
    prisma.walletLot.groupBy({
      by: ["sourceType"],
      where: {
        sourceType: { in: ["LOYALTY", "REFERRAL_FRIEND", "REFERRAL_REFERRER"] },
      },
      _sum: { originalPaise: true },
    }),
    prisma.referral.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        referrer: { select: { name: true, email: true, phone: true } },
        referee: { select: { name: true, email: true, phone: true } },
      },
    }),
  ]);

  const sourceTotals = {
    LOYALTY: 0,
    REFERRAL_FRIEND: 0,
    REFERRAL_REFERRER: 0,
  };
  for (const row of creditedBySource) {
    if (row.sourceType === "LOYALTY") sourceTotals.LOYALTY = row._sum.originalPaise ?? 0;
    if (row.sourceType === "REFERRAL_FRIEND") sourceTotals.REFERRAL_FRIEND = row._sum.originalPaise ?? 0;
    if (row.sourceType === "REFERRAL_REFERRER") sourceTotals.REFERRAL_REFERRER = row._sum.originalPaise ?? 0;
  }

  const customers = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { id: q },
          ],
        }
      : undefined,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const activeCustomer = selectedUserId
    ? await prisma.user.findUnique({
        where: { id: selectedUserId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      })
    : customers[0] || null;

  const summary = activeCustomer
    ? await getWalletSummary(activeCustomer.id)
    : null;

  return (
    <div className="max-w-6xl mx-auto px-7 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-ink">Rewards &amp; Wallet</h1>
          <p className="text-xs text-stone-dark mt-1">
            Customer spendable store credit is now the wallet balance.
          </p>
        </div>
        <div className="text-xs text-stone-dark">
          Promo expiry: <strong>{rewardSettings.promoCreditExpiryDays}d</strong> | Max order
          cap: <strong>{rewardSettings.walletMaxPercentOfOrder}%</strong> | Max adjust:{" "}
          <strong>{formatINR(rewardSettings.maxAdminAdjustPaise)}</strong>
        </div>
      </div>

      <RewardSettingsForm initialSettings={rewardSettings} />
      <LoyaltyReferralSettingsForm initialSettings={loyaltyReferralSettings} />

      <div className="border border-stone bg-white p-5 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
          Liability &amp; Credited Totals
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs">
          <div>
            <span className="text-stone-dark block">Outstanding Promo</span>
            <strong className="text-sm text-ink">
              {formatINR(promoOutstandingAgg._sum.remainingPaise ?? 0)}
            </strong>
          </div>
          <div>
            <span className="text-stone-dark block">Expiring (&le;30d)</span>
            <strong className="text-sm text-ink">
              {formatINR(promoExpiring30Agg._sum.remainingPaise ?? 0)}
            </strong>
          </div>
          <div>
            <span className="text-stone-dark block">Credited: Loyalty</span>
            <strong className="text-sm text-ink">{formatINR(sourceTotals.LOYALTY)}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Credited: Friend</span>
            <strong className="text-sm text-ink">{formatINR(sourceTotals.REFERRAL_FRIEND)}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Credited: Referrer</span>
            <strong className="text-sm text-ink">{formatINR(sourceTotals.REFERRAL_REFERRER)}</strong>
          </div>
        </div>
      </div>

      <div className="border border-stone bg-white p-5 space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
          Referrals (Recent {recentReferrals.length})
        </h2>
        {recentReferrals.length === 0 ? (
          <p className="text-xs text-stone-dark">No referrals recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-stone text-stone-dark">
                  <th className="py-1.5 pr-3">Date</th>
                  <th className="py-1.5 pr-3">Referrer</th>
                  <th className="py-1.5 pr-3">Friend</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {recentReferrals.map((ref) => {
                  const refRaw = ref.referrer.email || ref.referrer.phone || ref.referrer.name;
                  const friRaw = ref.referee.email || ref.referee.phone || ref.referee.name;
                  const refLabel = isOwner ? refRaw : maskIdentifier(refRaw || "Customer");
                  const friLabel = isOwner ? friRaw : maskIdentifier(friRaw || "Customer");
                  return (
                    <tr key={ref.id} className="border-b border-stone/40">
                      <td className="py-1.5 pr-3 font-mono">
                        {ref.createdAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="py-1.5 pr-3">{refLabel}</td>
                      <td className="py-1.5 pr-3">{friLabel}</td>
                      <td className="py-1.5 pr-3 font-medium">{ref.status}</td>
                      <td className="py-1.5 text-stone-dark">{ref.rejectionReason || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search customer by name, email, phone, or ID..."
          className="flex-1 border border-stone bg-white px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          className="bg-ink text-white px-4 py-2 text-xs uppercase tracking-wider"
        >
          Search
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-stone bg-white p-4 space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
            Customers ({customers.length})
          </h2>
          <div className="divide-y divide-stone/50 max-h-[420px] overflow-y-auto">
            {customers.map((c) => {
              const isSelected = activeCustomer?.id === c.id;
              return (
                <Link
                  key={c.id}
                  href={`/admin/rewards?${new URLSearchParams({
                    ...(q ? { q } : {}),
                    userId: c.id,
                  }).toString()}`}
                  className={`block py-2 px-2 text-xs hover:bg-paper ${
                    isSelected ? "bg-paper font-semibold" : ""
                  }`}
                >
                  <div className="text-ink">{c.name || c.email || c.phone || c.id}</div>
                  <div className="text-stone-dark">{c.email || c.phone || "No contact"}</div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {activeCustomer && summary ? (
            <>
              <div className="border border-stone bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-display text-ink">
                      {activeCustomer.name || activeCustomer.email || activeCustomer.id}
                    </h2>
                    <p className="text-xs text-stone-dark">
                      {activeCustomer.email || "—"} &middot; {activeCustomer.phone || "—"} &middot;{" "}
                      ID: {activeCustomer.id}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <div className="text-xs uppercase tracking-wider text-stone-dark">
                      Wallet Balance
                    </div>
                    <div className="text-2xl font-display text-ink">
                      {formatINR(summary.balancePaise)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-stone/50 text-xs">
                  <div>
                    <span className="text-stone-dark">Refund lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.REFUND)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-dark">Promo lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.PROMO)}</strong>
                  </div>
                  <div>
                    <span className="text-stone-dark">Adjust lots:</span>{" "}
                    <strong>{formatINR(summary.byKind.ADJUST)}</strong>
                  </div>
                </div>
              </div>

              <WalletAdjustForm
                userId={activeCustomer.id}
                maxAdminAdjustPaise={rewardSettings.maxAdminAdjustPaise}
              />

              <div className="border border-stone bg-white p-5 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
                  Active Wallet Lots ({summary.activeLots.length})
                </h3>
                {summary.activeLots.length === 0 ? (
                  <p className="text-xs text-stone-dark">No active wallet lots.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone text-stone-dark">
                          <th className="py-1.5 pr-3">Kind</th>
                          <th className="py-1.5 pr-3">Original</th>
                          <th className="py-1.5 pr-3">Remaining</th>
                          <th className="py-1.5 pr-3">Expires</th>
                          <th className="py-1.5">Source / Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.activeLots.map((lot) => (
                          <tr key={lot.id} className="border-b border-stone/40">
                            <td className="py-1.5 pr-3 font-medium">{lot.kind}</td>
                            <td className="py-1.5 pr-3">{formatINR(lot.originalPaise)}</td>
                            <td className="py-1.5 pr-3">{formatINR(lot.remainingPaise)}</td>
                            <td className="py-1.5 pr-3">
                              {lot.expiresAt ? lot.expiresAt.toISOString().slice(0, 10) : "Never"}
                            </td>
                            <td className="py-1.5 text-stone-dark">
                              {lot.sourceType || "—"} {lot.note ? `(${lot.note})` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="border border-stone bg-white p-5 space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-stone-dark font-semibold">
                  Recent Wallet Ledger ({summary.recentEntries.length})
                </h3>
                {summary.recentEntries.length === 0 ? (
                  <p className="text-xs text-stone-dark">No ledger entries yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-stone text-stone-dark">
                          <th className="py-1.5 pr-3">Date</th>
                          <th className="py-1.5 pr-3">Type</th>
                          <th className="py-1.5 pr-3">Amount</th>
                          <th className="py-1.5 pr-3">Balance After</th>
                          <th className="py-1.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentEntries.map((entry) => (
                          <tr key={entry.id} className="border-b border-stone/40">
                            <td className="py-1.5 pr-3">
                              {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                            </td>
                            <td className="py-1.5 pr-3 font-medium">{entry.type}</td>
                            <td className="py-1.5 pr-3">
                              {entry.amountPaise > 0 ? "+" : ""}
                              {formatINR(entry.amountPaise)}
                            </td>
                            <td className="py-1.5 pr-3">{formatINR(entry.balanceAfterPaise)}</td>
                            <td className="py-1.5 text-stone-dark">{entry.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="border border-stone bg-white p-6 text-sm text-stone-dark">
              No matching customer found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
