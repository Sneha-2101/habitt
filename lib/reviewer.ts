import { normalizeIdentifier } from "@/lib/otp";

/**
 * Checks whether reviewer login is active at call time.
 * Requires:
 * 1. REVIEWER_OTP_ENABLED === "true"
 * 2. REVIEWER_OTP_CODE is exactly 6 digits
 * 3. REVIEWER_IDENTIFIER is non-empty
 * 4. REVIEWER_OTP_EXPIRES_AT is a valid future ISO date
 */
export function isReviewerLoginActive(): boolean {
  if (process.env.REVIEWER_OTP_ENABLED !== "true") {
    return false;
  }

  const code = process.env.REVIEWER_OTP_CODE;
  if (!code || !/^\d{6}$/.test(code)) {
    return false;
  }

  const rawIdentifier = process.env.REVIEWER_IDENTIFIER;
  if (!rawIdentifier || rawIdentifier.trim().length === 0) {
    return false;
  }

  const expiresAtStr = process.env.REVIEWER_OTP_EXPIRES_AT;
  if (!expiresAtStr) {
    return false;
  }

  const expiresDate = new Date(expiresAtStr);
  if (isNaN(expiresDate.getTime())) {
    return false;
  }

  if (expiresDate.getTime() <= Date.now()) {
    return false;
  }

  return true;
}

/**
 * Checks if the given normalized identifier matches the configured REVIEWER_IDENTIFIER
 * and reviewer login is currently active.
 */
export function isReviewerIdentifier(normalizedIdentifier: string): boolean {
  if (!isReviewerLoginActive()) {
    return false;
  }

  const configured = process.env.REVIEWER_IDENTIFIER;
  if (!configured) {
    return false;
  }

  const normConfigured = normalizeIdentifier(configured);
  const normInput = normalizeIdentifier(normalizedIdentifier);

  return normInput === normConfigured;
}

