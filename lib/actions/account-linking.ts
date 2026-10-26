"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { verifyOtp, normalizeIdentifier, OtpChannel } from "@/lib/otp";
import { revalidatePath } from "next/cache";

export async function linkIdentifierAction(
  rawIdentifier: string,
  code: string,
  channel: OtpChannel
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!session?.user || !userId) {
    return { success: false, error: "Unauthorized: Please sign in to link identifiers." };
  }

  const identifier = normalizeIdentifier(rawIdentifier, channel);
  const verifyResult = await verifyOtp(identifier, code);

  if (!verifyResult.success) {
    return { success: false, error: verifyResult.message || "Invalid or expired verification code" };
  }

  const isPhone = channel === "PHONE";

  // Check if identifier is claimed by ANOTHER user
  const existingUser = isPhone
    ? await prisma.user.findFirst({
        where: {
          phone: identifier,
          id: { not: userId },
        },
      })
    : await prisma.user.findFirst({
        where: {
          email: identifier,
          id: { not: userId },
        },
      });

  if (existingUser) {
    return {
      success: false,
      error: `This ${isPhone ? "phone number" : "email address"} is already linked to another registered account.`,
    };
  }

  // Update current user record
  await prisma.user.update({
    where: { id: userId },
    data: isPhone ? { phone: identifier } : { email: identifier },
  });

  revalidatePath("/account");
  return { success: true };
}
