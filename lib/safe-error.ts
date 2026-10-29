import { RateLimitUnavailableError } from "./ratelimit";

/**
 * Maps OTP-related errors to safe, user-facing error messages.
 * Prevents leaking Prisma, environment variables, or internal stack details.
 */
export function mapOtpError(
  err: unknown,
  defaultMessage = "Failed to send verification code."
): string {
  if (
    err instanceof RateLimitUnavailableError ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name?: string }).name === "RateLimitUnavailableError")
  ) {
    return "Verification is temporarily unavailable. Please try again shortly.";
  }

  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (msg.startsWith("Please wait")) {
    return msg;
  }

  console.error(err);
  return defaultMessage;
}

