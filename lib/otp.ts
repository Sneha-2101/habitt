import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWhatsappOtp } from "@/lib/whatsapp";
import { sendEmailOtp } from "@/lib/otp-email";
import { limit } from "@/lib/ratelimit";
import { mapOtpError } from "@/lib/safe-error";

export type OtpChannel = "PHONE" | "EMAIL";

export function normalizeIdentifier(identifier: string, channel?: OtpChannel): string {
  const trimmed = identifier.trim();
  if (channel === "EMAIL" || trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }

  // Phone number normalization: strip all non-digit characters except leading '+'
  let cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) {
    if (cleaned.length === 10) {
      cleaned = `+91${cleaned}`;
    } else {
      cleaned = `+${cleaned}`;
    }
  }
  return cleaned;
}

/**
 * Computes HMAC-SHA256 hex of `${normalizedIdentifier}:${code}` keyed by OTP_PEPPER.
 * Production requires OTP_PEPPER (throws if missing).
 * Development falls back to AUTH_SECRET with a console warning.
 */
export function hashOtp(normalizedIdentifier: string, code: string): string {
  let pepper = process.env.OTP_PEPPER;
  if (!pepper) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("OTP_PEPPER environment variable is required in production");
    }
    console.warn("[OTP] OTP_PEPPER missing; falling back to AUTH_SECRET in development.");
    pepper = process.env.AUTH_SECRET;
  }
  if (!pepper) {
    throw new Error("Neither OTP_PEPPER nor AUTH_SECRET is configured");
  }

  return crypto
    .createHmac("sha256", pepper)
    .update(`${normalizedIdentifier}:${code}`)
    .digest("hex");
}

export async function generateAndSendOtp(
  rawIdentifier: string,
  channel: OtpChannel
): Promise<{ success: boolean; identifier: string; devMode?: boolean }> {
  const identifier = normalizeIdentifier(rawIdentifier, channel);

  if (!identifier) {
    throw new Error("Please enter a valid phone number or email address.");
  }

  // 60-second cooldown check
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
  const recentCode = await prisma.otpCode.findFirst({
    where: {
      identifier,
      channel,
      verified: false,
      expiresAt: { gt: new Date() },
      createdAt: { gt: sixtySecondsAgo },
    },
  });

  if (recentCode) {
    throw new Error("Please wait 60 seconds before requesting another code.");
  }

  // Generate 6-digit cryptographically secure code
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-minute expiry
  const hashedCode = hashOtp(identifier, code);

  await prisma.otpCode.create({
    data: {
      identifier,
      channel,
      code: hashedCode,
      expiresAt,
    },
  });

  // Dispatch plaintext code via chosen channel
  let result: { success: boolean; devMode?: boolean; error?: string };
  if (channel === "PHONE") {
    result = await sendWhatsappOtp(identifier, code);
  } else {
    result = await sendEmailOtp(identifier, code);
  }

  if (!result.success) {
    throw new Error(result.error || "Failed to send verification code.");
  }

  return {
    success: true,
    identifier,
    devMode: result.devMode,
  };
}

export async function verifyOtp(
  rawIdentifier: string,
  code: string,
  ip?: string
): Promise<{ success: boolean; message?: string; identifier?: string; channel?: OtpChannel }> {
  const identifier = normalizeIdentifier(rawIdentifier);
  const inputCode = code.trim();

  if (!identifier || !inputCode) {
    return { success: false, message: "Invalid or expired verification code" };
  }

  try {
    // Rate limit verification attempts by identifier (10 per 15 min)
    const idRateLimit = await limit("otpVerifyIdentifier", identifier);
    if (!idRateLimit.ok) {
      return { success: false, message: "Too many verification attempts. Please wait 15 minutes." };
    }

    // Rate limit verification attempts by IP if provided (30 per 15 min)
    if (ip && ip !== "unknown") {
      const ipRateLimit = await limit("otpVerifyIp", ip);
      if (!ipRateLimit.ok) {
        return { success: false, message: "Too many verification attempts. Please wait 15 minutes." };
      }
    }

    const now = new Date();

    // Find active, unexpired, unverified OtpCode
    const activeCode = await prisma.otpCode.findFirst({
      where: {
        identifier,
        verified: false,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!activeCode) {
      return { success: false, message: "Invalid or expired verification code" };
    }

    // Atomic attempts increment with attempts < 5 condition (0 count means locked or expired)
    const updateAttempts = await prisma.otpCode.updateMany({
      where: {
        id: activeCode.id,
        verified: false,
        expiresAt: { gt: now },
        attempts: { lt: 5 },
      },
      data: {
        attempts: { increment: 1 },
      },
    });

    if (updateAttempts.count === 0) {
      return { success: false, message: "Too many failed attempts. Please request a new code." };
    }

    // Compare hashes with crypto.timingSafeEqual
    const expectedHash = hashOtp(identifier, inputCode);
    const actualBuffer = Buffer.from(activeCode.code, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    const isMatch =
      actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer);

    if (!isMatch) {
      return { success: false, message: "Invalid or expired verification code" };
    }

    // On match, atomic mark verified (must match count === 1 to close race)
    const markVerified = await prisma.otpCode.updateMany({
      where: {
        id: activeCode.id,
        verified: false,
      },
      data: {
        verified: true,
      },
    });

    if (markVerified.count !== 1) {
      return { success: false, message: "Verification code has already been used." };
    }

    return {
      success: true,
      identifier: activeCode.identifier,
      channel: activeCode.channel,
    };
  } catch (err) {
    return {
      success: false,
      message: mapOtpError(err, "Verification failed. Please try again."),
    };
  }
}
