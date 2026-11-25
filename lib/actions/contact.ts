"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser, requireFreshStepUp } from "@/lib/guards";
import { limit } from "@/lib/ratelimit";
import { normalizeIdentifier, generateAndSendOtp, verifyOtp } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { revokeAllSessions } from "@/lib/sessions";
import { writeAudit } from "@/lib/audit";
import { maybeGrantRefereeCredit } from "@/lib/rewards/service";
import { sendContactChangedAlertEmail } from "@/lib/email";
import { getClientIp } from "@/lib/client-ip";
import { Prisma } from "@prisma/client";
import {
  isPhoneOtpBlocked,
  PHONE_UNAVAILABLE_MESSAGE,
} from "@/lib/whatsapp-flag";

const emailSchema = z.string().trim().email("Please enter a valid email address");
const phoneSchema = z.string().regex(/^\+91[6-9]\d{9}$/, "Please enter a valid 10-digit Indian mobile number");

export async function requestContactChangeAction({
  channel,
  newValue,
}: {
  channel: "EMAIL" | "PHONE";
  newValue: string;
}): Promise<{ success: boolean; message: string }> {
  const user = await requireUser();
  await requireFreshStepUp();

  if (channel === "PHONE" && isPhoneOtpBlocked()) {
    return {
      success: false,
      message: PHONE_UNAVAILABLE_MESSAGE,
    };
  }

  const rateLimitResult = await limit("linkIdentifier", user.id);
  if (!rateLimitResult.ok) {
    return {
      success: true,
      message: "If this can be used, we've sent a code to it.",
    };
  }

  const normalized = normalizeIdentifier(newValue, channel);
  if (channel === "EMAIL") {
    emailSchema.parse(normalized);
  } else {
    phoneSchema.parse(normalized);
  }

  // Check if identifier is already owned by ANY user (including the caller)
  const existing =
    channel === "EMAIL"
      ? await prisma.user.findFirst({ where: { email: normalized } })
      : await prisma.user.findFirst({ where: { phone: normalized } });

  if (existing) {
    // Send nothing if already taken
    return {
      success: true,
      message: "If this can be used, we've sent a code to it.",
    };
  }

  try {
    await generateAndSendOtp(normalized, channel);
  } catch (err) {
    console.error("[Contact Change OTP Send Error]:", err);
  }

  return {
    success: true,
    message: "If this can be used, we've sent a code to it.",
  };
}

export async function confirmContactChangeAction({
  channel,
  newValue,
  code,
}: {
  channel: "EMAIL" | "PHONE";
  newValue: string;
  code: string;
}): Promise<{ success: boolean }> {
  const user = await requireUser();
  await requireFreshStepUp();

  const normalized = normalizeIdentifier(newValue, channel);
  if (channel === "EMAIL") {
    emailSchema.parse(normalized);
  } else {
    phoneSchema.parse(normalized);
  }

  let ip = "unknown";
  try {
    const headerList = await headers();
    ip = getClientIp(headerList);
  } catch {}

  const verifyResult = await verifyOtp(normalized, code, ip);
  if (!verifyResult.success) {
    throw new Error("Invalid or expired code");
  }

  // Read old user info BEFORE update for security alerts
  const oldUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, phone: true },
  });

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data:
          channel === "EMAIL"
            ? { email: normalized, emailVerifiedAt: now }
            : { phone: normalized, phoneVerifiedAt: now },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error("Invalid or expired code");
    }
    throw err;
  }

  await maybeGrantRefereeCredit(user.id);

  // Revoke other sessions except current sid
  if (user.sid) {
    await revokeAllSessions(user.id, user.sid);
  } else {
    await revokeAllSessions(user.id);
  }

  // Write audit log with meta { channel } (NO contact values)
  await writeAudit({
    actorId: user.id,
    action: "account.contact_changed",
    entity: "User",
    entityId: user.id,
    meta: { channel },
    ip,
  });

  // Non-blocking security alert:
  // EMAIL change: send to old email if one existed
  // PHONE change: send to current/old email if one exists
  const alertTarget = channel === "EMAIL" ? oldUser?.email : oldUser?.email;
  if (alertTarget) {
    sendContactChangedAlertEmail({
      to: alertTarget,
      name: oldUser?.name,
      channel,
    }).catch((err) => {
      console.error("[Contact Change Alert Error]:", err);
    });
  }

  revalidatePath("/account");
  return { success: true };
}

