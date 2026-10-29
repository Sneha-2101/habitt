"use server";

import { headers } from "next/headers";
import { generateAndSendOtp, normalizeIdentifier, OtpChannel, verifyOtp } from "@/lib/otp";
import { getClientIp } from "@/lib/client-ip";
import { limit, otpDailyCap } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { mapOtpError } from "@/lib/safe-error";

export async function requestOtpAction(
  identifier: string,
  channel: OtpChannel,
  turnstileToken?: string
): Promise<{ success: boolean; identifier?: string; devMode?: boolean; error?: string }> {
  try {
    let ip = "unknown";
    try {
      const reqHeaders = await headers();
      ip = getClientIp(reqHeaders);
    } catch {
      // outside request context (e.g. vitest integration tests)
    }

    // 1. Verify Turnstile token if configured
    const turnstileOk = await verifyTurnstile(turnstileToken, ip);
    if (!turnstileOk) {
      return {
        success: false,
        error: "Security verification failed. Please try again.",
      };
    }

    // 2. Global OTP Daily Cap check
    const dailyCapResult = await otpDailyCap();
    if (!dailyCapResult.ok) {
      return {
        success: false,
        error: "Verification service is temporarily unavailable. Please try again later.",
      };
    }

    // 3. IP Rate limit: otpSendIp (10 per hour)
    const ipLimit = await limit("otpSendIp", ip);
    if (!ipLimit.ok) {
      return {
        success: false,
        error: "Too many verification requests from this IP. Please try again later.",
      };
    }

    // 4. Identifier Rate limit: otpSendIdentifier (3 per 15 min)
    const normalized = normalizeIdentifier(identifier, channel);
    const idLimit = await limit("otpSendIdentifier", normalized);
    if (!idLimit.ok) {
      return {
        success: false,
        error: "Too many verification requests. Please wait 15 minutes before trying again.",
      };
    }

    const result = await generateAndSendOtp(identifier, channel);
    return {
      success: true,
      identifier: result.identifier,
      devMode: result.devMode,
    };
  } catch (err) {
    return {
      success: false,
      error: mapOtpError(err, "Failed to send verification code."),
    };
  }
}

export async function verifyOtpAction(
  rawIdentifier: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await verifyOtp(rawIdentifier, code);
    if (!res.success) {
      return { success: false, error: res.message || "Failed to verify code." };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: mapOtpError(err, "Failed to verify code."),
    };
  }
}
