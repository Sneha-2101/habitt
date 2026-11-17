import { describe, it, expect, afterEach, vi } from "vitest";
import { isWhatsappOtpLive } from "@/lib/whatsapp-flag";

describe("isWhatsappOtpLive flag helper", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true only for the exact string 'true'", () => {
    vi.stubEnv("WHATSAPP_OTP_LIVE", "true");
    expect(isWhatsappOtpLive()).toBe(true);
  });

  it("returns false for unset", () => {
    delete process.env.WHATSAPP_OTP_LIVE;
    expect(isWhatsappOtpLive()).toBe(false);
  });

  it("returns false for empty string", () => {
    vi.stubEnv("WHATSAPP_OTP_LIVE", "");
    expect(isWhatsappOtpLive()).toBe(false);
  });

  it("returns false for 'TRUE'", () => {
    vi.stubEnv("WHATSAPP_OTP_LIVE", "TRUE");
    expect(isWhatsappOtpLive()).toBe(false);
  });

  it("returns false for '1'", () => {
    vi.stubEnv("WHATSAPP_OTP_LIVE", "1");
    expect(isWhatsappOtpLive()).toBe(false);
  });

  it("returns false for 'false'", () => {
    vi.stubEnv("WHATSAPP_OTP_LIVE", "false");
    expect(isWhatsappOtpLive()).toBe(false);
  });
});
