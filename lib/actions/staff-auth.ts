"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateAndSendOtp } from "@/lib/otp";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { mapOtpError } from "@/lib/safe-error";

export async function requestStaffOtpAction(
  email: string,
  turnstileToken?: string
): Promise<{ success: boolean; message?: string; devMode?: boolean; error?: string }> {
  try {
    let ip = "unknown";
    try {
      const reqHeaders = await headers();
      ip = getClientIp(reqHeaders);
    } catch {
      // outside request context
    }

    // 1. Verify Turnstile token if configured
    const turnstileOk = await verifyTurnstile(turnstileToken, ip);
    if (!turnstileOk) {
      return {
        success: false,
        error: "Security verification failed. Please try again.",
      };
    }

    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      return {
        success: false,
        error: "Please enter a valid email address.",
      };
    }

    // 2. IP Rate limit: staffOtpSendIp (10 per hour)
    const ipLimit = await limit("staffOtpSendIp", ip);
    if (!ipLimit.ok) {
      return {
        success: false,
        error: "Too many verification requests from this IP. Please try again later.",
      };
    }

    // 3. Identifier Rate limit: staffOtpSendIdentifier (3 per 15 min)
    const idLimit = await limit("staffOtpSendIdentifier", normalized);
    if (!idLimit.ok) {
      return {
        success: false,
        error: "Too many verification requests. Please wait 15 minutes before trying again.",
      };
    }

    // 4. Check active allowlist
    const allowlistEntry = await prisma.staffAllowlist.findUnique({
      where: { email: normalized },
    });

    const neutralMessage = "If this email has staff access, a code has been sent.";
    const isProd = process.env.NODE_ENV === "production";

    if (allowlistEntry && allowlistEntry.active) {
      try {
        const sendResult = await generateAndSendOtp(normalized, "EMAIL");
        return {
          success: true,
          message: neutralMessage,
          devMode: isProd ? undefined : sendResult.devMode,
        };
      } catch (sendErr) {
        console.error("[Staff OTP Send Error]:", sendErr);
        return {
          success: true,
          message: neutralMessage,
        };
      }
    }

    // Email not on allowlist: return identical neutral message without sending OTP
    return {
      success: true,
      message: neutralMessage,
    };
  } catch (err) {
    return {
      success: false,
      error: mapOtpError(err, "Failed to send verification code."),
    };
  }
}

