import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/sessions";
import { formatINR } from "@/lib/money";
import { getOrCreateReferralCode } from "@/lib/rewards/service";
import ReferralCodeForm from "./ReferralCodeForm";

export const dynamic = "force-dynamic";

export default async function AccountReferralsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login?redirect=/account/referrals");

  const settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: {
      referralEnabled: true,
      referrerRewardPaise: true,
      refereeRewardPaise: true,
      referralMinOrderPaise: true,
    },
  });

  if (!settings?.referralEnabled) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl text-ink">Referrals</h1>
          <Link href="/account" className="text-xs underline text-stone-dark hover:text-ink">
            &larr; Back to Account
          </Link>
        </div>
        <div className="border border-stone bg-white p-6 text-sm text-stone-dark">
          Referrals are not available right now.
        </div>
      </div>
    );
  }

  const [refCode, givenReferrals, orderCount, receivedReferral, earnedLots] =
    await Promise.all([
      getOrCreateReferralCode(sessionUser.id),
      prisma.referral.findMany({
        where: { referrerId: sessionUser.id },
        select: { status: true },
      }),
      prisma.order.count({ where: { userId: sessionUser.id } }),
      prisma.referral.findUnique({
        where: { refereeId: sessionUser.id },
        select: { id: true },
      }),
      prisma.walletLot.aggregate({
        where: {
          userId: sessionUser.id,
          sourceType: "REFERRAL_REFERRER",
        },
        _sum: { originalPaise: true },
      }),
    ]);

  const invitedCount = givenReferrals.length;
  const rewardedCount = givenReferrals.filter((r) => r.status === "REWARDED").length;
  const pendingCount = givenReferrals.filter(
    (r) => r.status === "PENDING_VERIFICATION" || r.status === "PENDING_FIRST_ORDER"
  ).length;
  const earnedTotalPaise = earnedLots._sum.originalPaise ?? 0;
  const canEnterCode = orderCount === 0 && receivedReferral === null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-ink">Refer &amp; Earn</h1>
          <p className="text-xs text-stone-dark mt-1">
            Share your code with friends. When they verify their account, they get{" "}
            <strong>{formatINR(settings.refereeRewardPaise)}</strong> in wallet credit, and you
            earn <strong>{formatINR(settings.referrerRewardPaise)}</strong> after their first
            order
            {settings.referralMinOrderPaise > 0
              ? ` (minimum ${formatINR(settings.referralMinOrderPaise)})`
              : ""}{" "}
            is delivered and completes the return window.
          </p>
        </div>
        <Link href="/account" className="text-xs underline text-stone-dark hover:text-ink">
          &larr; Back to Account
        </Link>
      </div>

      <div className="border border-stone bg-white p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-stone-dark block">
              Your Referral Code
            </span>
            <span className="font-mono text-2xl font-semibold text-ink tracking-widest">
              {refCode.code}
            </span>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-stone-dark block">
              Share Link
            </span>
            <code className="text-xs bg-paper border border-stone px-2 py-1 inline-block mt-1">
              /r/{refCode.code}
            </code>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-stone/60 text-xs">
          <div>
            <span className="text-stone-dark block">Invited</span>
            <strong className="text-base text-ink">{invitedCount}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Pending</span>
            <strong className="text-base text-ink">{pendingCount}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Rewarded</span>
            <strong className="text-base text-ink">{rewardedCount}</strong>
          </div>
          <div>
            <span className="text-stone-dark block">Total Earned</span>
            <strong className="text-base text-ink">{formatINR(earnedTotalPaise)}</strong>
          </div>
        </div>
      </div>

      {canEnterCode && <ReferralCodeForm />}
    </div>
  );
}
