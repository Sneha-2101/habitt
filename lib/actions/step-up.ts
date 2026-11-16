"use server";

import { headers } from "next/headers";
import { requireUser } from "@/lib/guards";
import { generateAndSendOtp, verifyOtp } from "@/lib/otp";
import { limit } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";
import { mapOtpError } from "@/lib/safe-error";
import { getClientIp } from "@/lib/client-ip";

export async function maskIdentifier(identifier: string): Promise<string> {
  if (identifier.includes("@")) {
    const [local, domain] = identifier.split("@");
    if (!local || local.length <= 1) return `*@${domain || ""}`;
    return `${local[0]}***@${domain}`;
  }
  if (identifier.startsWith("+91") && identifier.length >= 7) {
    const last4 = identifier.slice(-4);
    return `+91******${last4}`;
  }
  if (identifier.length > 4) {
    const last4 = identifier.slice(-4);
    return `******${last4}`;
  }
  return "****";
}

export async function requestStepUpAction(
  channel?: "EMAIL" | "PHONE"
): Promise<{ success: boolean; message: string }> {
  try {
    const user = await requireUser();

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, email: true, phone: true },
    });

    if (!dbUser) {
      throw new Error("User not found.");
    }

    let target: string | null = null;
    let resolvedChannel: "EMAIL" | "PHONE" = "EMAIL";

    if (dbUser.role === "STAFF" || dbUser.role === "OWNER") {
      if (!dbUser.email) {
        throw new Error("No email address associated with your account.");
      }
      target = dbUser.email;
      resolvedChannel = "EMAIL";
    } else {
      // Customer
      if (channel === "PHONE") {
        if (!dbUser.phone) {
          throw new Error("No phone number associated with your account.");
        }
        target = dbUser.phone;
        resolvedChannel = "PHONE";
      } else if (channel === "EMAIL") {
        if (!dbUser.email) {
          throw new Error("No email address associated with your account.");
        }
        target = dbUser.email;
        resolvedChannel = "EMAIL";
      } else {
        // Default: prefer EMAIL if present, else PHONE
        if (dbUser.email) {
          target = dbUser.email;
          resolvedChannel = "EMAIL";
        } else if (dbUser.phone) {
          target = dbUser.phone;
          resolvedChannel = "PHONE";
        } else {
          throw new Error("No contact method associated with your account.");
        }
      }
    }

    const rateLimitResult = await limit("stepUpSend", user.id);
    if (!rateLimitResult.ok) {
      throw new Error("Too many verification attempts. Please wait 15 minutes before trying again.");
    }

    const sendRes = await generateAndSendOtp(target, resolvedChannel);
    if (!sendRes.success) {
      throw new Error("Failed to send verification code.");
    }

    const masked = await maskIdentifier(target);
    return {
      success: true,
      message: `Verification code sent to ${masked}.`,
    };
  } catch (err) {
    const safeMsg = mapOtpError(err, "Failed to send verification code.");
    throw new Error(safeMsg);
  }
}

export async function confirmStepUpAction(
  code: string,
  channel?: "EMAIL" | "PHONE"
): Promise<{ success: boolean }> {
  try {
    const user = await requireUser();
    if (!user.sid) {
      throw new Error("No active session found.");
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, email: true, phone: true },
    });

    if (!dbUser) {
      throw new Error("User not found.");
    }

    let target: string | null = null;
    if (dbUser.role === "STAFF" || dbUser.role === "OWNER") {
      if (!dbUser.email) {
        throw new Error("No email address associated with your account.");
      }
      target = dbUser.email;
    } else {
      if (channel === "PHONE") {
        if (!dbUser.phone) {
          throw new Error("No phone number associated with your account.");
        }
        target = dbUser.phone;
      } else if (channel === "EMAIL") {
        if (!dbUser.email) {
          throw new Error("No email address associated with your account.");
        }
        target = dbUser.email;
      } else {
        if (dbUser.email) {
          target = dbUser.email;
        } else if (dbUser.phone) {
          target = dbUser.phone;
        } else {
          throw new Error("No contact method associated with your account.");
        }
      }
    }

    let ip = "unknown";
    try {
      const reqHeaders = await headers();
      ip = getClientIp(reqHeaders);
    } catch {}

    const verifyResult = await verifyOtp(target, code, ip);
    if (!verifyResult.success) {
      throw new Error(verifyResult.message || "Invalid or expired verification code.");
    }

    const now = new Date();
    await prisma.session.update({
      where: { id: user.sid },
      data: { stepUpAt: now },
    });

    return { success: true };
  } catch (err) {
    const safeMsg = mapOtpError(err, "Invalid or expired verification code.");
    throw new Error(safeMsg);
  }
}
