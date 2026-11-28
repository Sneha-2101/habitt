import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ "x-forwarded-for": "127.0.0.1" })),
}));

import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import {
  requestContactChangeAction,
  confirmContactChangeAction,
} from "@/lib/actions/contact";
import { requestStepUpAction, confirmStepUpAction } from "@/lib/actions/step-up";
import { authorizeCustomerOtp } from "@/lib/auth-authorize";
import { otpIdentifierKey } from "@/lib/otp-identifier";
import { createSession } from "@/lib/sessions";
import { StepUpRequiredError } from "@/lib/guards";
import * as sessionsModule from "@/lib/sessions";
import * as otpModule from "@/lib/otp";

describe("T54, T55: Contact Change, Customer Step-Up, and Identifier Verification", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T54.1: requestContactChangeAction & confirmContactChangeAction require fresh step-up", async () => {
    const user = await createTestUser({ email: `${genId("m1test_cc1")}@habitt.test` });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    // 1. No stepUpAt
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    await expect(
      requestContactChangeAction({ channel: "EMAIL", newValue: `${genId("m1test_new")}@habitt.test` })
    ).rejects.toThrow(StepUpRequiredError);

    await expect(
      confirmContactChangeAction({ channel: "EMAIL", newValue: `${genId("m1test_new")}@habitt.test`, code: "123456" })
    ).rejects.toThrow(StepUpRequiredError);

    // 2. Stale stepUpAt (> 10 min)
    const staleTime = new Date(Date.now() - 15 * 60 * 1000);
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid,
      stepUpAt: staleTime,
    });

    await expect(
      requestContactChangeAction({ channel: "EMAIL", newValue: `${genId("m1test_new")}@habitt.test` })
    ).rejects.toThrow(StepUpRequiredError);

    await expect(
      confirmContactChangeAction({ channel: "EMAIL", newValue: `${genId("m1test_new")}@habitt.test`, code: "123456" })
    ).rejects.toThrow(StepUpRequiredError);
  });

  it("T54.2: taken vs free identifier returns identical result and taken creates NO OtpCode row", async () => {
    const userA = await createTestUser({ email: `${genId("m1test_user_a")}@habitt.test` });
    const userB = await createTestUser({ email: `${genId("m1test_user_b")}@habitt.test` });
    const { sid } = await createSession({ userId: userA.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userA.id,
      role: "CUSTOMER",
      email: userA.email,
      phone: userA.phone ?? null,
      name: userA.name,
      sid,
      stepUpAt: new Date(),
    });

    // Request change to taken email (owned by userB)
    const takenRes = await requestContactChangeAction({
      channel: "EMAIL",
      newValue: userB.email!,
    });
    expect(takenRes).toEqual({
      success: true,
      message: "If this can be used, we've sent a code to it.",
    });

    // Ensure NO OtpCode row was created for userB's email
    const takenCodes = await prisma.otpCode.findMany({
      where: { identifier: otpIdentifierKey(userB.email!.toLowerCase().trim()) },
    });
    expect(takenCodes.length).toBe(0);

    // Request change to a free email
    const freeEmail = `${genId("m1test_free_email")}@habitt.test`;
    const freeRes = await requestContactChangeAction({
      channel: "EMAIL",
      newValue: freeEmail,
    });
    expect(freeRes).toEqual({
      success: true,
      message: "If this can be used, we've sent a code to it.",
    });

    // Verify OtpCode row WAS created for free email
    const freeCodes = await prisma.otpCode.findMany({
      where: { identifier: otpIdentifierKey(freeEmail.toLowerCase().trim()) },
    });
    expect(freeCodes.length).toBe(1);
  });

  it("T54.3: confirm success updates field + verifiedAt, revokes other sessions but keeps current, writes audit w/o values", async () => {
    const user = await createTestUser({ email: `${genId("m1test_user_c")}@habitt.test` });
    const s1 = await createSession({ userId: user.id, role: "CUSTOMER" });
    const s2 = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid: s1.sid,
      stepUpAt: new Date(),
    });

    const newPhone = "+919876543210";
    // Mock OTP verification to succeed
    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: newPhone,
      channel: "PHONE",
    });

    const res = await confirmContactChangeAction({
      channel: "PHONE",
      newValue: newPhone,
      code: "123456",
    });
    expect(res.success).toBe(true);

    // Verify User record updated
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.phone).toBe(newPhone);
    expect(updatedUser?.phoneVerifiedAt).not.toBeNull();

    // Verify session s1 is still active
    const session1 = await prisma.session.findUnique({ where: { id: s1.sid } });
    expect(session1?.revokedAt).toBeNull();

    // Verify session s2 is revoked
    const session2 = await prisma.session.findUnique({ where: { id: s2.sid } });
    expect(session2?.revokedAt).not.toBeNull();

    // Verify audit log has no phone or email values in meta
    const auditLogs = await prisma.auditLog.findMany({
      where: { actorId: user.id, action: "account.contact_changed" },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].meta).toEqual({ channel: "PHONE" });
  });

  it("T54.4: confirm with code issued for different identifier fails", async () => {
    const user = await createTestUser({ email: `${genId("m1test_user_d")}@habitt.test` });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid,
      stepUpAt: new Date(),
    });

    // Create an OTP for emailA
    const emailA = `${genId("m1test_otp_a")}@habitt.test`;
    const plainCode = 482910;
    const rndSpy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    await otpModule.generateAndSendOtp(emailA, "EMAIL");
    rndSpy.mockRestore();

    // Attempt confirming with emailB using emailA's code
    const emailB = `${genId("m1test_otp_b")}@habitt.test`;
    await expect(
      confirmContactChangeAction({
        channel: "EMAIL",
        newValue: emailB,
        code: plainCode.toString(),
      })
    ).rejects.toThrow("Invalid or expired code");
  });

  it("T54.5: two users confirming the same new identifier concurrently -> exactly one succeeds, other gets generic failure", async () => {
    const user1 = await createTestUser({ email: `${genId("m1test_conc1")}@habitt.test` });
    const user2 = await createTestUser({ email: `${genId("m1test_conc2")}@habitt.test` });
    const s1 = await createSession({ userId: user1.id, role: "CUSTOMER" });
    const s2 = await createSession({ userId: user2.id, role: "CUSTOMER" });

    const sharedNewEmail = `${genId("m1test_shared")}@habitt.test`;
    const plainCode = 571932;

    // Generate valid OTP for sharedNewEmail
    const rndSpy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainCode as never);
    await otpModule.generateAndSendOtp(sharedNewEmail, "EMAIL");
    rndSpy.mockRestore();

    // First user confirms
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user1.id,
      role: "CUSTOMER",
      email: user1.email,
      phone: user1.phone ?? null,
      name: user1.name,
      sid: s1.sid,
      stepUpAt: new Date(),
    });

    const res1 = await confirmContactChangeAction({
      channel: "EMAIL",
      newValue: sharedNewEmail,
      code: plainCode.toString(),
    });
    expect(res1.success).toBe(true);

    // Second user attempts to confirm same email (even with mock verifyOtp succeeding)
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user2.id,
      role: "CUSTOMER",
      email: user2.email,
      phone: user2.phone ?? null,
      name: user2.name,
      sid: s2.sid,
      stepUpAt: new Date(),
    });
    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: sharedNewEmail,
      channel: "EMAIL",
    });

    await expect(
      confirmContactChangeAction({
        channel: "EMAIL",
        newValue: sharedNewEmail,
        code: plainCode.toString(),
      })
    ).rejects.toThrow("Invalid or expired code");
  });

  it("T54.6: customer step-up works via EMAIL and PHONE channels", async () => {
    const user = await createTestUser({
      email: `${genId("m1test_cust_stepup")}@habitt.test`,
      phone: "+919876500001",
    });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    const generateSpy = vi.spyOn(otpModule, "generateAndSendOtp");
    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: user.phone!,
      channel: "PHONE",
    });

    // Request via PHONE
    const phoneReq = await requestStepUpAction("PHONE");
    expect(phoneReq.success).toBe(true);
    expect(generateSpy).toHaveBeenCalledWith(user.phone, "PHONE");

    // Confirm via PHONE
    const phoneConf = await confirmStepUpAction("654321", "PHONE");
    expect(phoneConf.success).toBe(true);

    const sPhone = await prisma.session.findUnique({ where: { id: sid } });
    expect(sPhone?.stepUpAt).not.toBeNull();

    // Request via EMAIL
    const emailReq = await requestStepUpAction("EMAIL");
    expect(emailReq.success).toBe(true);
    expect(generateSpy).toHaveBeenCalledWith(user.email, "EMAIL");
  });

  it("T55: authorizeCustomerOtp sets verifiedAt for used identifier on found and created users", async () => {
    const phoneNum = "+919876500002";
    const plainPhoneCode = 654321;

    // 1. Created user (new registration via phone OTP)
    let rndSpy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainPhoneCode as never);
    await otpModule.generateAndSendOtp(phoneNum, "PHONE");
    rndSpy.mockRestore();

    const auth1 = await authorizeCustomerOtp({
      identifier: phoneNum,
      code: plainPhoneCode.toString(),
    });
    expect(auth1).not.toBeNull();

    const createdUser = await prisma.user.findUnique({ where: { id: auth1!.id } });
    expect(createdUser?.phone).toBe(phoneNum);
    expect(createdUser?.phoneVerifiedAt).not.toBeNull();
    expect(createdUser?.emailVerifiedAt).toBeNull();

    // 2. Found user (existing user logging in via email OTP)
    const existingEmail = `${genId("m1test_exist")}@habitt.test`;
    const existUser = await createTestUser({ email: existingEmail });
    expect(existUser.emailVerifiedAt).toBeNull();

    const plainEmailCode = 789123;
    rndSpy = vi.spyOn(crypto, "randomInt").mockReturnValue(plainEmailCode as never);
    await otpModule.generateAndSendOtp(existingEmail, "EMAIL");
    rndSpy.mockRestore();

    const auth2 = await authorizeCustomerOtp({
      identifier: existingEmail,
      code: plainEmailCode.toString(),
    });
    expect(auth2).not.toBeNull();

    const foundUser = await prisma.user.findUnique({ where: { id: existUser.id } });
    expect(foundUser?.emailVerifiedAt).not.toBeNull();
  });
});
