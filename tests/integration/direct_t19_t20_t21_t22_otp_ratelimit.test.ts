import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";
import { requestOtpAction } from "@/lib/actions/otp";
import { verifyOtp } from "@/lib/otp";
import { limit, otpDailyCap, resetMemoryLimits } from "@/lib/ratelimit";

describe("T19–T22: OTP Abuse Protection & Rate Limiting", () => {
  beforeEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
  });

  it("T19 otp storage: requestOtpAction -> stored code column is NOT 6 digits (is the HMAC hex) and verifyOtp succeeds with the plain code", async () => {
    const email = "m1test_t19_storage@example.test";
    const plainCode = 482910;

    const spy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    const actionRes = await requestOtpAction(email, "EMAIL");
    spy.mockRestore();

    expect(actionRes.success).toBe(true);

    const storedOtp = await prisma.otpCode.findFirst({
      where: { identifier: email },
      orderBy: { createdAt: "desc" },
    });

    expect(storedOtp).toBeDefined();
    // Stored code column must NOT be 6 digits
    expect(storedOtp?.code).not.toBe(plainCode.toString());
    expect(storedOtp?.code).not.toMatch(/^\d{6}$/);
    // Stored code column is the 64-char HMAC-SHA256 hex string
    expect(storedOtp?.code).toMatch(/^[0-9a-f]{64}$/);

    // verifyOtp succeeds with the plain code
    const verifyRes = await verifyOtp(email, plainCode.toString());
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.identifier).toBe(email);
  });

  it("T20 otp lockout: 10 parallel wrong guesses -> attempts never exceeds 5; correct code fails on a locked record; a new code request works", async () => {
    const email = "m1test_t20_lockout@example.test";
    const plainCode = 837492;

    const spy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    const reqRes = await requestOtpAction(email, "EMAIL");
    spy.mockRestore();
    expect(reqRes.success).toBe(true);

    // 10 parallel wrong guesses
    const wrongGuesses = Array.from({ length: 10 }).map(() =>
      verifyOtp(email, "000000")
    );
    await Promise.allSettled(wrongGuesses);

    // Check attempts in DB
    const record = await prisma.otpCode.findFirst({
      where: { identifier: email },
      orderBy: { createdAt: "desc" },
    });

    expect(record).toBeDefined();
    expect(record?.attempts).toBeLessThanOrEqual(5);

    // Correct code must fail on a locked record
    const correctTry = await verifyOtp(email, plainCode.toString());
    expect(correctTry.success).toBe(false);

    // Bypass 60-second cooldown in DB to allow fresh request
    await prisma.otpCode.updateMany({
      where: { identifier: email },
      data: { createdAt: new Date(Date.now() - 70000) },
    });

    // A new code request works
    const newReq = await requestOtpAction(email, "EMAIL");
    expect(newReq.success).toBe(true);
  });

  it("T21 otp single use: same correct code verified twice in parallel -> exactly one succeeds", async () => {
    const email = "m1test_t21_singleuse@example.test";
    const plainCode = 519284;

    const spy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    const reqRes = await requestOtpAction(email, "EMAIL");
    spy.mockRestore();
    expect(reqRes.success).toBe(true);

    // Same correct code verified twice in parallel
    const [resA, resB] = await Promise.all([
      verifyOtp(email, plainCode.toString()),
      verifyOtp(email, plainCode.toString()),
    ]);

    const successes = [resA.success, resB.success].filter(Boolean);
    expect(successes.length).toBe(1);

    const failures = [resA, resB].filter((r) => !r.success);
    expect(failures.length).toBe(1);
    expect(failures[0].message).toContain("already been used");
  });

  it("T22 rate limits: 4th OTP send blocked for same identifier; 11th from same IP blocked; global daily cap blocks when OTP_DAILY_CAP=2", async () => {
    resetMemoryLimits();
    const email = "m1test_t22_ratelimits@example.test";

    // 1. Identifier limit (3 per 15 min): send 3, 4th must be blocked
    for (let i = 0; i < 3; i++) {
      const res = await requestOtpAction(email, "EMAIL");
      expect(res.success).toBe(true);
      // bypass cooldown
      await prisma.otpCode.updateMany({
        where: { identifier: email },
        data: { createdAt: new Date(Date.now() - 70000) },
      });
    }
    const res4 = await requestOtpAction(email, "EMAIL");
    expect(res4.success).toBe(false);
    expect(res4.error).toContain("Too many verification requests");

    // 2. IP limit (10 per hour): 10 succeed, 11th must fail
    const testIp = "198.51.100.77";
    for (let i = 0; i < 10; i++) {
      const rl = await limit("otpSendIp", testIp);
      expect(rl.ok).toBe(true);
    }
    const rl11 = await limit("otpSendIp", testIp);
    expect(rl11.ok).toBe(false);
    expect(rl11.retryAfterSec).toBeGreaterThan(0);

    // 3. Global daily cap: blocks when OTP_DAILY_CAP=2
    const originalCap = process.env.OTP_DAILY_CAP;
    process.env.OTP_DAILY_CAP = "2";
    resetMemoryLimits();
    try {
      const cap1 = await otpDailyCap();
      expect(cap1.ok).toBe(true);

      const cap2 = await otpDailyCap();
      expect(cap2.ok).toBe(true);

      const cap3 = await otpDailyCap();
      expect(cap3.ok).toBe(false);
    } finally {
      process.env.OTP_DAILY_CAP = originalCap;
      resetMemoryLimits();
    }
  });
});

