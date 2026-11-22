export const PHONE_UNAVAILABLE_MESSAGE =
  "Phone verification isn't available yet. Please use your email.";

export function isWhatsappOtpLive(): boolean {
  return process.env.WHATSAPP_OTP_LIVE === "true";
}

export function isWhatsappMessagesLive(): boolean {
  return process.env.WHATSAPP_MESSAGES_LIVE === "true";
}

export function isPhoneOtpBlocked(): boolean {
  return process.env.NODE_ENV === "production" && !isWhatsappOtpLive();
}

