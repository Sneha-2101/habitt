import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { requestStaffOtpAction } from "@/lib/actions/staff-auth";
import { authorizeCustomerOtp, authorizeStaffOtp } from "@/lib/auth-authorize";
import * as otpModule from "@/lib/otp";
import * as emailModule from "@/lib/email";

describe("T42, T43, T47: Staff Auth, Allowlist, and New-Device Alert", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T42: requestStaffOtpAction returns identical response for allowlisted and non-allowlisted emails; sends only for allowlisted", async () => {
    const allowlistedEmail = `${genId("m1test_staff")}@habitt.test`;
    const nonAllowlistedEmail = `${genId("m1test_random")}@habitt.test`;

    // Put one email on the active allowlist
    await prisma.staffAllowlist.create({
      data: {
        id: genId("m1test_allow"),
        email: allowlistedEmail,
        role: "STAFF",
        active: true,
      },
    });

    const sendOtpSpy = vi.spyOn(otpModule, "generateAndSendOtp").mockResolvedValue({
      success: true,
      identifier: allowlistedEmail,
    });

    // Request for allowlisted
    const resAllow = await requestStaffOtpAction(allowlistedEmail);
    expect(resAllow.success).toBe(true);
    expect(resAllow.message).toBe("If this email has staff access, a code has been sent.");
    expect(sendOtpSpy).toHaveBeenCalledWith(allowlistedEmail, "EMAIL");

    sendOtpSpy.mockClear();

    // Request for non-allowlisted
    const resNonAllow = await requestStaffOtpAction(nonAllowlistedEmail);
    expect(resNonAllow.success).toBe(true);
    expect(resNonAllow.message).toBe("If this email has staff access, a code has been sent.");
    // Must NOT have dispatched OTP for non-allowlisted
    expect(sendOtpSpy).not.toHaveBeenCalled();
  });

  it("T43: authorizeCustomerOtp refuses STAFF/OWNER; authorizeStaffOtp refuses non-allowlist; success creates staff lifetimes", async () => {
    const staffEmail = `${genId("m1test_staff")}@habitt.test`;
    const staffUser = await createTestUser({ email: staffEmail, role: "STAFF" });

    // Mock verifyOtp to succeed
    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: staffEmail,
      channel: "EMAIL",
    });

    // 1. Customer provider MUST return null for a staff/owner account
    const customerAuthRes = await authorizeCustomerOtp({
      identifier: staffEmail,
      code: "123456",
    });
    expect(customerAuthRes).toBeNull();

    // 2. Staff provider before allowlist entry returns null
    const staffBeforeAllow = await authorizeStaffOtp({
      email: staffEmail,
      code: "123456",
    });
    expect(staffBeforeAllow).toBeNull();

    // Add to allowlist
    await prisma.staffAllowlist.create({
      data: {
        id: genId("m1test_allow"),
        email: staffEmail,
        role: "STAFF",
        active: true,
      },
    });

    // 3. Staff provider with allowlist entry succeeds and sets staff lifetimes
    const staffSuccess = await authorizeStaffOtp({
      email: staffEmail,
      code: "123456",
    });
    expect(staffSuccess).not.toBeNull();
    expect(staffSuccess?.id).toBe(staffUser.id);
    expect(staffSuccess?.role).toBe("STAFF");
    expect(staffSuccess?.sid).toBeDefined();

    // Verify session lifetime (STAFF: idle 7d, absolute 30d)
    const session = await prisma.session.findUnique({
      where: { id: staffSuccess!.sid },
    });
    expect(session).not.toBeNull();
    expect(session?.absoluteExpiresAt).not.toBeNull();

    const diffIdleDays = Math.round(
      (session!.expiresAt.getTime() - session!.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    expect(diffIdleDays).toBe(7);

    const diffAbsDays = Math.round(
      (session!.absoluteExpiresAt!.getTime() - session!.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );
    expect(diffAbsDays).toBe(30);
  });

  it("T47: new-device alert sent only for first session per uaHash; email failure does not block login", async () => {
    const email = `${genId("m1test_alert")}@habitt.test`;
    await prisma.staffAllowlist.create({
      data: {
        id: genId("m1test_allow"),
        email,
        role: "STAFF",
        active: true,
      },
    });

    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: email,
      channel: "EMAIL",
    });

    const alertSpy = vi.spyOn(emailModule, "sendStaffSignInAlertEmail").mockResolvedValue({
      success: true,
    } as never);

    const ctx = {
      ip: "10.0.0.1",
      userAgent: "TestDeviceBrowser/1.0",
    };

    // 1. First login with this user agent -> alert sent
    const res1 = await authorizeStaffOtp({ email, code: "123456" }, ctx);
    expect(res1).not.toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // 2. Second login with SAME user agent -> alert NOT sent
    const res2 = await authorizeStaffOtp({ email, code: "123456" }, ctx);
    expect(res2).not.toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // 3. New user agent with email failure -> login still succeeds
    alertSpy.mockRejectedValueOnce(new Error("Resend network timeout"));
    const newCtx = {
      ip: "10.0.0.2",
      userAgent: "DifferentDeviceBrowser/2.0",
    };
    const res3 = await authorizeStaffOtp({ email, code: "123456" }, newCtx);
    expect(res3).not.toBeNull();
    expect(res3?.sid).toBeDefined();
  });

  it("requestStaffOtpAction returns identical neutral result on 60s cooldown or send failure", async () => {
    const allowlistedEmail = `${genId("m1test_staff_neutral")}@habitt.test`;
    const nonAllowlistedEmail = `${genId("m1test_unlisted")}@habitt.test`;

    await prisma.staffAllowlist.create({
      data: {
        id: genId("m1test_allow"),
        email: allowlistedEmail,
        role: "STAFF",
        active: true,
      },
    });

    const nonAllowRes = await requestStaffOtpAction(nonAllowlistedEmail);
    expect(nonAllowRes.success).toBe(true);
    expect(nonAllowRes.message).toBe("If this email has staff access, a code has been sent.");

    // 1. Cooldown error from generateAndSendOtp
    const cooldownSpy = vi.spyOn(otpModule, "generateAndSendOtp").mockRejectedValue(
      new Error("Please wait 60 seconds before requesting another code.")
    );

    const cooldownRes = await requestStaffOtpAction(allowlistedEmail);
    expect(cooldownRes.success).toBe(true);
    expect(cooldownRes.message).toBe(nonAllowRes.message);
    expect(cooldownRes.error).toBeUndefined();

    // 2. Generic send failure from generateAndSendOtp
    cooldownSpy.mockRejectedValue(new Error("Resend network error / SMTP timeout"));
    const failRes = await requestStaffOtpAction(allowlistedEmail);
    expect(failRes.success).toBe(true);
    expect(failRes.message).toBe(nonAllowRes.message);
    expect(failRes.error).toBeUndefined();
  });
});

