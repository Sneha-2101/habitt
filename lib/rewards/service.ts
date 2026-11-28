import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { creditWalletLot } from "@/lib/wallet/service";
import { computeExpiresAt } from "@/lib/wallet/allocate";
import { computeLoyaltyEarn } from "@/lib/rewards/loyalty";
import {
  evaluateRefereeEligibility,
  evaluateReferrerRelease,
  generateReferralCode,
  normalizeEmail,
  normalizePhone,
} from "@/lib/rewards/referral";
import { safeErrorSummary } from "@/lib/log-redact";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstMonthStart(now: Date): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istStart = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1, 0, 0, 0, 0);
  return new Date(istStart - IST_OFFSET_MS);
}

export function computeOrderGoodsNetPaise(order: {
  total: number;
  shippingFee: number;
  codFee: number;
}): number {
  return Math.max(0, order.total - order.shippingFee - order.codFee);
}

export function computeRefundedGoodsPaise(order: {
  items: Array<{ id: string; unitPrice: number; qty: number; discountPaise: number; isGift: boolean }>;
  returnRequests: Array<{
    status: string;
    items: Array<{ orderItemId: string; qty: number }>;
  }>;
}): number {
  const itemMap = new Map(order.items.map((i) => [i.id, i]));
  let total = 0;
  for (const ret of order.returnRequests) {
    if (ret.status !== "REFUNDED") continue;
    for (const ri of ret.items) {
      const oi = itemMap.get(ri.orderItemId);
      if (!oi || oi.isGift || oi.qty <= 0) continue;
      const netLine = Math.max(0, oi.unitPrice * oi.qty - oi.discountPaise);
      total += Math.round((netLine / oi.qty) * ri.qty);
    }
  }
  return total;
}

export async function getOrCreateReferralCode(userId: string) {
  const existing = await prisma.referralCode.findUnique({ where: { userId } });
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      return await prisma.referralCode.create({
        data: { userId, code },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const byUser = await prisma.referralCode.findUnique({ where: { userId } });
        if (byUser) return byUser;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to generate unique referral code.");
}

export async function attachReferral(
  userId: string,
  rawCode: string,
  now: Date = new Date()
): Promise<void> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return;

  const [refCode, settings, referee] = await Promise.all([
    prisma.referralCode.findUnique({
      where: { code },
      include: {
        user: {
          select: { id: true, status: true, email: true, phone: true },
        },
      },
    }),
    prisma.siteSettings.findUnique({ where: { id: "default" } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
        orders: { select: { id: true }, take: 1 },
        referralReceived: { select: { id: true } },
      },
    }),
  ]);

  if (!refCode || !settings || !settings.referralEnabled || !referee) {
    return;
  }

  const normEmail = normalizeEmail(referee.email);
  const normPhone = normalizePhone(referee.phone);
  const claimOr: Prisma.ReferralClaimWhereInput[] = [];
  if (normEmail) claimOr.push({ normalizedEmail: normEmail });
  if (normPhone) claimOr.push({ normalizedPhone: normPhone });

  const existingClaims =
    claimOr.length > 0
      ? await prisma.referralClaim.findMany({
          where: { OR: claimOr },
          select: { normalizedEmail: true, normalizedPhone: true },
        })
      : [];

  const elig = evaluateRefereeEligibility({
    referrer: refCode.user,
    referee: {
      id: referee.id,
      email: referee.email,
      phone: referee.phone,
      emailVerifiedAt: referee.emailVerifiedAt,
      phoneVerifiedAt: referee.phoneVerifiedAt,
      createdAt: referee.createdAt,
      hasExistingOrders: referee.orders.length > 0,
      hasExistingReferral: referee.referralReceived !== null,
    },
    existingClaims,
    settings: { referralEnabled: settings.referralEnabled },
    now,
  });

  if (!elig.ok && elig.reason !== "NOT_VERIFIED") {
    return;
  }

  const expiresAt = new Date(
    now.getTime() + settings.referralValidityDays * 24 * 60 * 60 * 1000
  );

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.referral.create({
        data: {
          referrerId: refCode.user.id,
          refereeId: referee.id,
          codeUsed: refCode.code,
          status: "PENDING_VERIFICATION",
          expiresAt,
        },
      });
      if (elig.ok) {
        await grantRefereeCredit(tx, created.id, now);
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    throw err;
  }
}

export async function grantRefereeCredit(
  tx: Prisma.TransactionClient,
  referralId: string,
  now: Date = new Date()
): Promise<boolean> {
  const [referral, settings] = await Promise.all([
    tx.referral.findUnique({
      where: { id: referralId },
      include: {
        referee: {
          select: {
            id: true,
            email: true,
            phone: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
          },
        },
      },
    }),
    tx.siteSettings.findUnique({ where: { id: "default" } }),
  ]);

  if (!referral || !settings || !settings.referralEnabled) return false;
  if (referral.status !== "PENDING_VERIFICATION" || referral.refereeLotId) return false;
  if (settings.refereeRewardPaise <= 0) return false;

  const { referee } = referral;
  if (!referee.emailVerifiedAt || !referee.phoneVerifiedAt) return false;

  const normEmail = normalizeEmail(referee.email);
  if (!normEmail) return false;
  const normPhone = normalizePhone(referee.phone);

  // Check duplicate identity claim before insert to avoid aborting the transaction on P2002
  const claimOr: Prisma.ReferralClaimWhereInput[] = [{ normalizedEmail: normEmail }];
  if (normPhone) claimOr.push({ normalizedPhone: normPhone });
  const existingClaim = await tx.referralClaim.findFirst({
    where: { OR: claimOr },
  });
  if (existingClaim) {
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        status: "REJECTED",
        rejectionReason: "DUPLICATE_IDENTITY",
      },
    });
    return false;
  }

  await tx.referralClaim.create({
    data: {
      refereeId: referee.id,
      normalizedEmail: normEmail,
      normalizedPhone: normPhone,
    },
  });

  const expiresAt = computeExpiresAt(
    "REFERRAL_FRIEND",
    "PROMO",
    now,
    settings.promoCreditExpiryDays
  );

  const credit = await creditWalletLot(
    {
      userId: referee.id,
      kind: "PROMO",
      amountPaise: settings.refereeRewardPaise,
      expiresAt,
      sourceType: "REFERRAL_FRIEND",
      sourceId: referral.id,
      reason: "Referral welcome credit",
      idempotencyKey: `referral-friend:${referral.id}`,
      now,
    },
    tx
  );

  await tx.referral.update({
    where: { id: referral.id },
    data: {
      status: "PENDING_FIRST_ORDER",
      refereeLotId: credit.lot?.id ?? null,
    },
  });

  return true;
}

export async function maybeGrantRefereeCredit(
  userId: string,
  now: Date = new Date()
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        referralReceived: { select: { id: true, status: true } },
      },
    });
    if (
      !user ||
      !user.emailVerifiedAt ||
      !user.phoneVerifiedAt ||
      user.referralReceived?.status !== "PENDING_VERIFICATION"
    ) {
      return;
    }
    const referralId = user.referralReceived.id;
    await prisma.$transaction((tx) => grantRefereeCredit(tx, referralId, now));
  } catch (err) {
    console.error("[maybeGrantRefereeCredit] suppressed error:", safeErrorSummary(err));
  }
}

export async function sweepPendingRefereeCredits(now: Date = new Date()) {
  const candidates = await prisma.referral.findMany({
    where: {
      status: "PENDING_VERIFICATION",
      expiresAt: { gt: now },
      referee: {
        emailVerifiedAt: { not: null },
        phoneVerifiedAt: { not: null },
      },
    },
    select: { id: true },
  });

  let grantedCount = 0;
  let errorCount = 0;
  for (const c of candidates) {
    try {
      const granted = await prisma.$transaction((tx) =>
        grantRefereeCredit(tx, c.id, now)
      );
      if (granted) grantedCount += 1;
    } catch (err) {
      errorCount += 1;
      console.error(
        `[sweepPendingRefereeCredits] failed referral=${c.id}:`,
        safeErrorSummary(err)
      );
    }
  }
  return { grantedCount, errorCount };
}

export async function expireStaleReferrals(now: Date = new Date()) {
  const res = await prisma.referral.updateMany({
    where: {
      status: { in: ["PENDING_VERIFICATION", "PENDING_FIRST_ORDER"] },
      expiresAt: { lte: now },
    },
    data: {
      status: "EXPIRED",
    },
  });
  return { expiredCount: res.count };
}

export async function releaseLoyaltyAccruals(now: Date = new Date()) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  if (!settings || !settings.loyaltyEnabled || !settings.loyaltyEnabledAt) {
    return { creditedCount: 0, skippedCount: 0, errorCount: 0 };
  }

  const cutoff = new Date(
    now.getTime() - settings.returnWindowDays * 24 * 60 * 60 * 1000
  );

  const orders = await prisma.order.findMany({
    where: {
      fulfilmentStatus: "DELIVERED",
      deliveredAt: { lte: cutoff },
      createdAt: { gte: settings.loyaltyEnabledAt },
      loyaltyAccrual: { is: null },
    },
    select: { id: true },
  });

  let creditedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const ord of orders) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.loyaltyAccrual.findUnique({
          where: { orderId: ord.id },
        });
        if (existing) return;

        const order = await tx.order.findUnique({
          where: { id: ord.id },
          include: {
            items: true,
            returnRequests: { include: { items: true } },
          },
        });
        if (!order || order.fulfilmentStatus !== "DELIVERED" || !order.deliveredAt) {
          return;
        }

        const hasOpenReturn = order.returnRequests.some((r) =>
          ["REQUESTED", "APPROVED", "RECEIVED"].includes(r.status)
        );
        if (hasOpenReturn) return;

        const goodsNetPaise = computeOrderGoodsNetPaise(order);
        const refundedGoodsPaise = computeRefundedGoodsPaise(order);
        const { basePaise, earnedPaise } = computeLoyaltyEarn({
          goodsNetPaise,
          refundedGoodsPaise,
          storeCreditApplied: order.storeCreditApplied,
          bps: settings.loyaltyPercentBps,
        });

        if (earnedPaise <= 0) {
          await tx.loyaltyAccrual.create({
            data: {
              orderId: order.id,
              userId: order.userId,
              basePaise,
              earnedPaise: 0,
              status: "SKIPPED",
              lotId: null,
            },
          });
          skippedCount += 1;
          return;
        }

        const expiresAt = computeExpiresAt(
          "LOYALTY",
          "PROMO",
          now,
          settings.promoCreditExpiryDays
        );
        const credit = await creditWalletLot(
          {
            userId: order.userId,
            kind: "PROMO",
            amountPaise: earnedPaise,
            expiresAt,
            sourceType: "LOYALTY",
            sourceId: order.id,
            reason: `Loyalty reward for Order #${order.displayId}`,
            orderId: order.id,
            idempotencyKey: `loyalty:${order.id}`,
            now,
          },
          tx
        );

        await tx.loyaltyAccrual.create({
          data: {
            orderId: order.id,
            userId: order.userId,
            basePaise,
            earnedPaise,
            status: "CREDITED",
            lotId: credit.lot?.id ?? null,
          },
        });
        creditedCount += 1;
      });
    } catch (err) {
      errorCount += 1;
      console.error(
        `[releaseLoyaltyAccruals] failed order=${ord.id}:`,
        safeErrorSummary(err)
      );
    }
  }

  return { creditedCount, skippedCount, errorCount };
}

export async function releaseReferrerRewards(now: Date = new Date()) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  if (!settings || !settings.referralEnabled) {
    return { rewardedCount: 0, rejectedCount: 0, errorCount: 0 };
  }

  const referrals = await prisma.referral.findMany({
    where: { status: "PENDING_FIRST_ORDER" },
    select: { id: true },
  });

  const istMonthStart = getIstMonthStart(now);
  let rewardedCount = 0;
  let rejectedCount = 0;
  let errorCount = 0;

  for (const refRow of referrals) {
    try {
      await prisma.$transaction(async (tx) => {
        const referral = await tx.referral.findUnique({
          where: { id: refRow.id },
        });
        if (!referral || referral.status !== "PENDING_FIRST_ORDER") return;

        const firstOrder = await tx.order.findFirst({
          where: {
            userId: referral.refereeId,
            paymentStatus: { not: "FAILED" },
            fulfilmentStatus: { not: "CANCELLED" },
          },
          orderBy: { createdAt: "asc" },
          include: {
            items: true,
            returnRequests: { include: { items: true } },
          },
        });

        const monthlyRewardedCount = await tx.referral.count({
          where: {
            referrerId: referral.referrerId,
            status: "REWARDED",
            updatedAt: { gte: istMonthStart },
          },
        });

        const hasOpenReturn = firstOrder
          ? firstOrder.returnRequests.some((r) =>
              ["REQUESTED", "APPROVED", "RECEIVED"].includes(r.status)
            )
          : false;
        const goodsNetPaise = firstOrder ? computeOrderGoodsNetPaise(firstOrder) : 0;
        const refundedGoodsPaise = firstOrder ? computeRefundedGoodsPaise(firstOrder) : 0;

        const decision = evaluateReferrerRelease({
          referral: { expiresAt: referral.expiresAt },
          firstOrder: firstOrder
            ? {
                fulfilmentStatus: firstOrder.fulfilmentStatus,
                paymentStatus: firstOrder.paymentStatus,
                deliveredAt: firstOrder.deliveredAt,
                goodsNetPaise,
                hasOpenReturn,
              }
            : null,
          settings: {
            referralEnabled: settings.referralEnabled,
            returnWindowDays: settings.returnWindowDays,
            referralMinOrderPaise: settings.referralMinOrderPaise,
            referralMonthlyCapPerReferrer: settings.referralMonthlyCapPerReferrer,
          },
          now,
          monthlyRewardedCount,
          refundedGoodsPaise,
        });

        if (decision.action === "wait") return;

        if (decision.action === "reject") {
          await tx.referral.update({
            where: { id: referral.id },
            data: {
              status: "REJECTED",
              rejectionReason: decision.reason,
              firstOrderId: firstOrder?.id ?? null,
            },
          });
          rejectedCount += 1;
          return;
        }

        let lotId: string | null = null;
        if (settings.referrerRewardPaise > 0) {
          const expiresAt = computeExpiresAt(
            "REFERRAL_REFERRER",
            "PROMO",
            now,
            settings.promoCreditExpiryDays
          );
          const credit = await creditWalletLot(
            {
              userId: referral.referrerId,
              kind: "PROMO",
              amountPaise: settings.referrerRewardPaise,
              expiresAt,
              sourceType: "REFERRAL_REFERRER",
              sourceId: referral.id,
              reason: "Referral reward",
              orderId: firstOrder?.id ?? null,
              idempotencyKey: `referral-referrer:${referral.id}`,
              now,
            },
            tx
          );
          lotId = credit.lot?.id ?? null;
        }

        await tx.referral.update({
          where: { id: referral.id },
          data: {
            status: "REWARDED",
            firstOrderId: firstOrder?.id ?? null,
            referrerLotId: lotId,
          },
        });
        rewardedCount += 1;
      });
    } catch (err) {
      errorCount += 1;
      console.error(
        `[releaseReferrerRewards] failed referral=${refRow.id}:`,
        safeErrorSummary(err)
      );
    }
  }

  return { rewardedCount, rejectedCount, errorCount };
}
