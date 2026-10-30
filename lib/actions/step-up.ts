"use server";

import { requireUser } from "@/lib/guards";
import { generateAndSendOtp, verifyOtp } from "@/lib/otp";
import { limit } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";

export async function requestStepUpAction(): Promise<{ success: boolean; message: string }> {
  const user = await requireUser();
  if (!user.email) {
    throw new Error("No email address associated with your account.");
  }

  const rateLimitResult = await limit("stepUpSend", user.id);
  if (!rateLimitResult.ok) {
    throw new Error("Too many verification attempts. Please wait 15 minutes before trying again.");
  }

  await generateAndSendOtp(user.email, "EMAIL");

  return {
    success: true,
    message: `Verification code sent to ${user.email}.`,
  };
}

export async function confirmStepUpAction(code: string): Promise<{ success: boolean }> {
  const user = await requireUser();
  if (!user.email) {
    throw new Error("No email address associated with your account.");
  }
  if (!user.sid) {
    throw new Error("No active session found.");
  }

  const verifyResult = await verifyOtp(user.email, code);
  if (!verifyResult.success) {
    throw new Error(verifyResult.message || "Invalid or expired verification code.");
  }

  const now = new Date();
  await prisma.session.update({
    where: { id: user.sid },
    data: { stepUpAt: now },
  });

  return { success: true };
}

