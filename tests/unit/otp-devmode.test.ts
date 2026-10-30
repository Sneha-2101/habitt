import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWhatsappOtp } from "@/lib/whatsapp";
import { sendEmailOtp } from "@/lib/otp-email";

describe("T36: OTP devMode impossible in production", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalMetaToken = process.env.META_WHATSAPP_TOKEN;
  const originalMetaPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const originalResendKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
    process.env.META_WHATSAPP_TOKEN = originalMetaToken;
    process.env.META_WHATSAPP_PHONE_NUMBER_ID = originalMetaPhoneId;
    process.env.RESEND_API_KEY = originalResendKey;
    vi.restoreAllMocks();
  });

  it("sendWhatsappOtp in production with missing credentials fails closed and does not log code", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.META_WHATSAPP_TOKEN;
    delete process.env.META_WHATSAPP_PHONE_NUMBER_ID;

    const consoleSpy = vi.spyOn(console, "log");

    const result = await sendWhatsappOtp("+919876543210", "123456");

    expect(result.success).toBe(false);
    expect(result.devMode).toBeUndefined();
    expect(result.error).toBe("WhatsApp is not configured");

    // Must not output code to console in production
    const loggedText = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(loggedText).not.toContain("123456");
  });

  it("sendEmailOtp in production with disabled/missing credentials fails closed and does not log code", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.RESEND_API_KEY = "disabled";

    const consoleSpy = vi.spyOn(console, "log");

    const result = await sendEmailOtp("test@example.com", "654321");

    expect(result.success).toBe(false);
    expect(result.devMode).toBeUndefined();
    expect(result.error).toBe("Email is not configured");

    const loggedText = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(loggedText).not.toContain("654321");
  });
});
