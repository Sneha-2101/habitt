import crypto from "crypto";

function getOtpIdentifierSecret(): string {
  let secret = process.env.OTP_PEPPER;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("OTP_PEPPER environment variable is required in production");
    }
    secret = process.env.AUTH_SECRET;
  }
  if (!secret) {
    throw new Error("Neither OTP_PEPPER nor AUTH_SECRET is configured");
  }
  return secret;
}

/**
 * Computes a domain-separated HMAC-SHA256 hex digest for an already-normalised
 * OTP identifier (e.g. from `normalizeIdentifier` or `"ticket_guest:<email>"`).
 *
 * In non-production environments, identifiers containing `"m1test"` are prefixed
 * with `"m1test~"` as a test-cleanup aid so `cleanupM1TestRows` can locate and
 * delete test OTP rows without storing plaintext identifiers.
 */
export function otpIdentifierKey(identifier: string): string {
  const secret = getOtpIdentifierSecret();
  const derivedKey = crypto
    .createHmac("sha256", secret)
    .update("otp-identifier-v1")
    .digest();
  const digest = crypto
    .createHmac("sha256", derivedKey)
    .update(identifier)
    .digest("hex");

  // Test-cleanup aid: prefix m1test rows in non-production so fixtures can clean them up.
  if (
    process.env.NODE_ENV !== "production" &&
    identifier.toLowerCase().includes("m1test")
  ) {
    return `m1test~${digest}`;
  }

  return digest;
}
