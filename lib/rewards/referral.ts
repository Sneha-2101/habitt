export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_NEW_ACCOUNT_WINDOW_HOURS = 24;

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function generateReferralCode(rng: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    const idx = Math.floor(rng() * REFERRAL_CODE_ALPHABET.length);
    code += REFERRAL_CODE_ALPHABET[idx];
  }
  return code;
}

export type EligibilityFailureReason =
  | "SELF_REFERRAL"
  | "DUPLICATE_IDENTITY"
  | "NOT_NEW_ACCOUNT"
  | "REFERRER_INACTIVE"
  | "DISABLED"
  | "NOT_VERIFIED";

export type RefereeEligibilityResult =
  | { ok: true }
  | { ok: false; reason: EligibilityFailureReason };

export function evaluateRefereeEligibility(input: {
  referrer: {
    id: string;
    status: string;
    email?: string | null;
    phone?: string | null;
  };
  referee: {
    id: string;
    email?: string | null;
    phone?: string | null;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
    createdAt?: Date | null;
    hasExistingOrders: boolean;
    hasExistingReferral: boolean;
  };
  existingClaims: Array<{
    normalizedEmail: string;
    normalizedPhone: string | null;
  }>;
  settings: {
    referralEnabled: boolean;
  };
  now?: Date;
}): RefereeEligibilityResult {
  if (!input.settings.referralEnabled) {
    return { ok: false, reason: "DISABLED" };
  }

  if (input.referrer.status !== "ACTIVE") {
    return { ok: false, reason: "REFERRER_INACTIVE" };
  }

  const refEmail = normalizeEmail(input.referrer.email);
  const refPhone = normalizePhone(input.referrer.phone);
  const friEmail = normalizeEmail(input.referee.email);
  const friPhone = normalizePhone(input.referee.phone);

  if (
    input.referrer.id === input.referee.id ||
    (refEmail && friEmail && refEmail === friEmail) ||
    (refPhone && friPhone && refPhone === friPhone)
  ) {
    return { ok: false, reason: "SELF_REFERRAL" };
  }

  const hasDuplicateClaim = input.existingClaims.some(
    (c) =>
      (friEmail && c.normalizedEmail === friEmail) ||
      (friPhone && c.normalizedPhone === friPhone)
  );
  if (hasDuplicateClaim) {
    return { ok: false, reason: "DUPLICATE_IDENTITY" };
  }

  if (input.referee.hasExistingOrders || input.referee.hasExistingReferral) {
    return { ok: false, reason: "NOT_NEW_ACCOUNT" };
  }

  if (input.referee.createdAt) {
    const nowMs = (input.now ?? new Date()).getTime();
    const ageMs = nowMs - input.referee.createdAt.getTime();
    if (ageMs > REFERRAL_NEW_ACCOUNT_WINDOW_HOURS * 60 * 60 * 1000) {
      return { ok: false, reason: "NOT_NEW_ACCOUNT" };
    }
  }

  if (!input.referee.emailVerifiedAt || !input.referee.phoneVerifiedAt) {
    return { ok: false, reason: "NOT_VERIFIED" };
  }

  return { ok: true };
}

export type ReferrerReleaseDecision =
  | { action: "release" }
  | { action: "wait" }
  | { action: "reject"; reason: string };

export function evaluateReferrerRelease(input: {
  referral: {
    expiresAt: Date;
  };
  firstOrder: {
    fulfilmentStatus: string;
    paymentStatus: string;
    deliveredAt: Date | null;
    goodsNetPaise: number;
    hasOpenReturn: boolean;
  } | null;
  settings: {
    referralEnabled: boolean;
    returnWindowDays: number;
    referralMinOrderPaise: number;
    referralMonthlyCapPerReferrer: number;
  };
  now: Date;
  monthlyRewardedCount: number;
  refundedGoodsPaise: number;
}): ReferrerReleaseDecision {
  if (!input.settings.referralEnabled) {
    return { action: "wait" };
  }

  if (input.referral.expiresAt.getTime() <= input.now.getTime()) {
    return { action: "reject", reason: "EXPIRED" };
  }

  const order = input.firstOrder;
  if (!order) {
    return { action: "wait" };
  }

  if (order.fulfilmentStatus === "CANCELLED" || order.paymentStatus === "FAILED") {
    return { action: "reject", reason: "FIRST_ORDER_CANCELLED_OR_FAILED" };
  }

  if (order.fulfilmentStatus !== "DELIVERED" || !order.deliveredAt) {
    return { action: "wait" };
  }

  if (order.hasOpenReturn) {
    return { action: "wait" };
  }

  const windowEndsMs =
    order.deliveredAt.getTime() + input.settings.returnWindowDays * 24 * 60 * 60 * 1000;
  if (input.now.getTime() < windowEndsMs) {
    return { action: "wait" };
  }

  const remainingGoodsPaise = Math.max(0, order.goodsNetPaise - input.refundedGoodsPaise);
  if (remainingGoodsPaise <= 0) {
    return { action: "reject", reason: "FIRST_ORDER_RETURNED" };
  }

  if (remainingGoodsPaise < input.settings.referralMinOrderPaise) {
    return { action: "reject", reason: "BELOW_MIN_ORDER" };
  }

  if (input.monthlyRewardedCount >= input.settings.referralMonthlyCapPerReferrer) {
    return { action: "reject", reason: "MONTHLY_CAP_REACHED" };
  }

  return { action: "release" };
}
