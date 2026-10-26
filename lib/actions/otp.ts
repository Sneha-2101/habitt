"use server";

import { generateAndSendOtp, OtpChannel } from "@/lib/otp";

export async function requestOtpAction(
  identifier: string,
  channel: OtpChannel
): Promise<{ success: boolean; identifier?: string; devMode?: boolean; error?: string }> {
  try {
    const result = await generateAndSendOtp(identifier, channel);
    return {
      success: true,
      identifier: result.identifier,
      devMode: result.devMode,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send verification code.",
    };
  }
}
