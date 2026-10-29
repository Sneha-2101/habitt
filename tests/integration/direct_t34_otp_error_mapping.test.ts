import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as otpModule from "@/lib/otp";
import { requestOtpAction } from "@/lib/actions/otp";
import { RateLimitUnavailableError, resetMemoryLimits } from "@/lib/ratelimit";
import { cleanupM1TestRows } from "../helpers/fixtures";

describe("T34: OTP Error Mapping and Sanitization", () => {
  beforeEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
    vi.restoreAllMocks();
  });

  it("masks secret configuration error when generateAndSendOtp throws OTP_PEPPER error", async () => {
    vi.spyOn(otpModule, "generateAndSendOtp").mockRejectedValue(
      new Error("OTP_PEPPER environment variable is required in production")
    );

    const res = await requestOtpAction("m1test_t34_pepper@example.com", "EMAIL");

    expect(res.success).toBe(false);
    expect(res.error).toBe("Failed to send verification code.");
    expect(JSON.stringify(res).includes("OTP_PEPPER")).toBe(false);
  });

  it("masks Prisma error when generateAndSendOtp throws an internal database error", async () => {
    vi.spyOn(otpModule, "generateAndSendOtp").mockRejectedValue(
      new Error("Invalid `prisma.otpCode.create()` invocation: Connection pool timed out")
    );

    const res = await requestOtpAction("m1test_t34_prisma@example.com", "EMAIL");

    expect(res.success).toBe(false);
    expect(res.error).toBe("Failed to send verification code.");
    expect(JSON.stringify(res).includes("prisma")).toBe(false);
  });

  it("passes through cooldown message unchanged", async () => {
    const cooldownMsg = "Please wait 60 seconds before requesting another code.";
    vi.spyOn(otpModule, "generateAndSendOtp").mockRejectedValue(new Error(cooldownMsg));

    const res = await requestOtpAction("m1test_t34_cooldown@example.com", "EMAIL");

    expect(res.success).toBe(false);
    expect(res.error).toBe(cooldownMsg);
  });

  it("maps RateLimitUnavailableError to generic temporarily unavailable message", async () => {
    vi.spyOn(otpModule, "generateAndSendOtp").mockRejectedValue(
      new RateLimitUnavailableError()
    );

    const res = await requestOtpAction("m1test_t34_rl@example.com", "EMAIL");

    expect(res.success).toBe(false);
    expect(res.error).toBe(
      "Verification is temporarily unavailable. Please try again shortly."
    );
  });
});

