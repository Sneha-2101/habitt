import { prisma } from "@/lib/prisma";
import { sendWhatsappOtp } from "@/lib/whatsapp";
import { sendEmailOtp } from "@/lib/otp-email";

export type OtpChannel = "PHONE" | "EMAIL";

export function normalizeIdentifier(identifier: string, channel?: OtpChannel): string {
  const trimmed = identifier.trim();
  if (channel === "EMAIL" || trimmed.includes("@")) {
    return trimmed.toLowerCase();
  }

  // Phone number normalization
  // Strip all non-digit characters except leading '+'
  let cleaned = trimmed.replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+")) {
    // Default to +91 (India) if 10-digit number without country code
    if (cleaned.length === 10) {
      cleaned = `+91${cleaned}`;
    } else {
      cleaned = `+${cleaned}`;
    }
  }
  return cleaned;
}

export async function generateAndSendOtp(
  rawIdentifier: string,
  channel: OtpChannel
): Promise<{ success: boolean; identifier: string; devMode?: boolean }> {
  const identifier = normalizeIdentifier(rawIdentifier, channel);

  if (!identifier) {
    throw new Error("Please enter a valid phone number or email address.");
  }

  // Rate-limit: Check if code created within last 60 seconds
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
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5-minute expiry

  await prisma.otpCode.create({
    data: {
      identifier,
      channel,
      code,
      expiresAt,
    },
  });

  // Dispatch via chosen channel
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
  code: string
): Promise<{ success: boolean; message?: string; identifier?: string; channel?: OtpChannel }> {
  const identifier = normalizeIdentifier(rawIdentifier);
  const inputCode = code.trim();

  if (!identifier || !inputCode) {
    return { success: false, message: "Invalid or expired verification code" };
  }

  // Find active, unexpired, unverified OtpCode
  const activeCode = await prisma.otpCode.findFirst({
    where: {
      identifier,
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!activeCode) {
    return { success: false, message: "Invalid or expired verification code" };
  }

  // Brute force protection: maximum 5 attempts per OTP record
  if (activeCode.attempts >= 5) {
    return { success: false, message: "Too many failed attempts. Please request a new code." };
  }

  // Increment attempt counter
  await prisma.otpCode.update({
    where: { id: activeCode.id },
    data: { attempts: { increment: 1 } },
  });

  if (activeCode.code === inputCode) {
    // Mark OTP code as verified
    await prisma.otpCode.update({
      where: { id: activeCode.id },
      data: { verified: true },
    });

    return {
      success: true,
      identifier: activeCode.identifier,
      channel: activeCode.channel,
    };
  }

  return { success: false, message: "Invalid or expired verification code" };
}
