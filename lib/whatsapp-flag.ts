export function isWhatsappOtpLive(): boolean {
  return process.env.WHATSAPP_OTP_LIVE === "true";
}
