import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockHeadersFn = vi.fn().mockResolvedValue(new Headers());

vi.mock("next/headers", () => ({
  headers: () => mockHeadersFn(),
}));

import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { confirmContactChangeAction } from "@/lib/actions/contact";
import { confirmStepUpAction } from "@/lib/actions/step-up";
import { maskIdentifier } from "@/lib/mask";
import { verifyOtp, hashOtp } from "@/lib/otp";
import * as otpModule from "@/lib/otp";
import * as emailModule from "@/lib/email";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";
import { resetMemoryLimits } from "@/lib/ratelimit";

describe("T63, T64, T65: Hardening verification", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
    resetMemoryLimits();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
    resetMemoryLimits();
  });

  describe("T63: Contact change alerts and IP handling", () => {
    it("EMAIL change alerts OLD email; PHONE change alerts email; contains no contact values; throwing sender does not fail action", async () => {
      const oldEmail = `${genId("m1test_old")}@habitt.test`;
      const user = await createTestUser({
        email: oldEmail,
        phone: "+919876543210",
        name: "Security Tester",
      });
      const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

      vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
        id: user.id,
        role: "CUSTOMER",
        email: user.email,
        phone: user.phone,
        name: user.name,
        sid,
        stepUpAt: new Date(), // fresh step-up
      });

      // Mock verifyOtp to succeed
      vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
        success: true,
        identifier: "dummy",
      });

      const alertSpy = vi.spyOn(emailModule, "sendContactChangedAlertEmail");

      // 1. EMAIL change -> alerts old email
      const newEmail = `${genId("m1test_new")}@habitt.test`;
      const emailRes = await confirmContactChangeAction({
        channel: "EMAIL",
        newValue: newEmail,
        code: "123456",
      });
      expect(emailRes.success).toBe(true);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const emailAlertArgs = alertSpy.mock.calls[0][0];
      expect(emailAlertArgs.to).toBe(oldEmail);
      expect(emailAlertArgs.channel).toBe("EMAIL");
      // Must not leak the new or old email in other properties
      expect(JSON.stringify(emailAlertArgs)).not.toContain(newEmail);

      alertSpy.mockClear();

      // 2. PHONE change -> alerts email
      const newPhone = "+919999888877";
      const phoneRes = await confirmContactChangeAction({
        channel: "PHONE",
        newValue: newPhone,
        code: "123456",
      });
      expect(phoneRes.success).toBe(true);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const phoneAlertArgs = alertSpy.mock.calls[0][0];
      // Should be sent to user's email
      expect(phoneAlertArgs.to).toBe(newEmail);
      expect(phoneAlertArgs.channel).toBe("PHONE");
      // Must not leak phone numbers
      expect(JSON.stringify(phoneAlertArgs)).not.toContain(newPhone);
      expect(JSON.stringify(phoneAlertArgs)).not.toContain("+919876543210");

      alertSpy.mockClear();

      // 3. Throwing email sender does not fail the action
      alertSpy.mockRejectedValue(new Error("SMTP failure"));
      const thirdEmail = `${genId("m1test_third")}@habitt.test`;
      const throwingRes = await confirmContactChangeAction({
        channel: "EMAIL",
        newValue: thirdEmail,
        code: "123456",
      });
      expect(throwingRes.success).toBe(true);
    });
  });

  describe("T64: Reviewer hardening", () => {
    it("reviewer attempts are limited via limiter (6th attempt blocked); staff-allowlisted email skips reviewer branch", async () => {
      const origEnv = { ...process.env };

      try {
        const reviewerEmail = `${genId("m1test_rev")}@habitt.test`;
        process.env.REVIEWER_OTP_ENABLED = "true";
        process.env.REVIEWER_IDENTIFIER = reviewerEmail;
        process.env.REVIEWER_OTP_CODE = "654321";
        process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 60000).toISOString();

        // 1. Wrong attempts 1 to 5 should fail with Invalid code
        for (let i = 1; i <= 5; i++) {
          const res = await verifyOtp(reviewerEmail, "000000");
          expect(res.success).toBe(false);
          expect(res.message).toBe("Invalid or expired verification code");
        }

        // 2. 6th attempt should be blocked by reviewerVerify rate limit
        const blockedRes = await verifyOtp(reviewerEmail, "000000");
        expect(blockedRes.success).toBe(false);
        expect(blockedRes.message).toBe("Too many failed attempts. Please request a new code.");

        // 3. Staff-allowlisted email with REVIEWER_IDENTIFIER set skips reviewer branch
        resetMemoryLimits();
        const staffEmail = `${genId("m1test_staff_rev")}@habitt.test`;
        await prisma.staffAllowlist.create({
          data: {
            id: genId("m1test_allow"),
            email: staffEmail,
            role: "STAFF",
          },
        });

        // Set staff email as reviewer identifier
        process.env.REVIEWER_IDENTIFIER = staffEmail;
        process.env.REVIEWER_OTP_CODE = "999999";

        // Seed real OTP code in database for staff email
        const realCode = "888123";
        const hashed = hashOtp(staffEmail, realCode);
        await prisma.otpCode.create({
          data: {
            id: genId("m1test_otp"),
            identifier: staffEmail,
            channel: "EMAIL",
            code: hashed,
            expiresAt: new Date(Date.now() + 300000),
          },
        });

        // Try reviewer code -> must be rejected because reviewer branch was skipped
        const revCodeRes = await verifyOtp(staffEmail, "999999");
        expect(revCodeRes.success).toBe(false);
        expect(revCodeRes.message).toBe("Invalid or expired verification code");

        // Real OTP code -> must succeed
        const realCodeRes = await verifyOtp(staffEmail, realCode);
        expect(realCodeRes.success).toBe(true);
        expect(realCodeRes.identifier).toBe(staffEmail);
      } finally {
        process.env = origEnv;
      }
    });
  });

  describe("T65: confirmStepUpAction and maskIdentifier", () => {
    it("confirmStepUpAction passes real IP into verifyOtp; maskIdentifier never returns full value", async () => {
      const user = await createTestUser({ email: `${genId("m1test_step")}@habitt.test` });
      const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

      vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
        id: user.id,
        role: "CUSTOMER",
        email: user.email,
        phone: null,
        name: user.name,
        sid,
        stepUpAt: null,
      });

      // Mock headers to provide real client IP
      const reqHeaders = new Headers();
      reqHeaders.set("x-forwarded-for", "198.51.100.42, 10.0.0.1");
      mockHeadersFn.mockResolvedValue(reqHeaders);

      const verifySpy = vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
        success: true,
        identifier: user.email || undefined,
      });

      const res = await confirmStepUpAction("123456", "EMAIL");
      expect(res.success).toBe(true);
      expect(verifySpy).toHaveBeenCalledTimes(1);
      // Verify real IP was passed (first public IP from x-forwarded-for)
      expect(verifySpy).toHaveBeenCalledWith(user.email, "123456", "198.51.100.42");

      // Test maskIdentifier helper
      const email1 = "testuser@example.com";
      const masked1 = await maskIdentifier(email1);
      expect(masked1).toBe("t***@example.com");
      expect(masked1).not.toBe(email1);
      expect(masked1).not.toContain("estuser");

      const emailShort = "a@domain.com";
      const maskedShort = await maskIdentifier(emailShort);
      expect(maskedShort).toBe("*@domain.com");
      expect(maskedShort).not.toBe(emailShort);

      const phone1 = "+919876543210";
      const maskedPhone = await maskIdentifier(phone1);
      expect(maskedPhone).toBe("+91******3210");
      expect(maskedPhone).not.toBe(phone1);
      expect(maskedPhone).not.toContain("987654");

      const phoneShort = "1234567";
      const maskedShortPhone = await maskIdentifier(phoneShort);
      expect(maskedShortPhone).toBe("******4567");
      expect(maskedShortPhone).not.toBe(phoneShort);
    });
  });
});
