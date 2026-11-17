import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { requestOtpAction } from "@/lib/actions/otp";
import { requestContactChangeAction } from "@/lib/actions/contact";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";
import * as otpEmailModule from "@/lib/otp-email";
import * as ratelimitModule from "@/lib/ratelimit";
import * as turnstileModule from "@/lib/turnstile";
import { PHONE_UNAVAILABLE_MESSAGE } from "@/lib/whatsapp-flag";

function randomPhone(): string {
  return "+919" + String(Math.floor(100000000 + Math.random() * 900000000));
}

describe("T67: Phone gates when WhatsApp is not live", () => {
  beforeEach(async () => {
    ratelimitModule.resetMemoryLimits();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    ratelimitModule.resetMemoryLimits();
    await cleanupM1TestRows();
  });

  it("Case A: production + flag unset: requestOtpAction(phone, 'PHONE') returns { success: false, error: PHONE_UNAVAILABLE_MESSAGE }; zero OtpCode rows; console.log never called with a code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_OTP_LIVE;

    vi.spyOn(turnstileModule, "verifyTurnstile").mockResolvedValue(true);
    const consoleSpy = vi.spyOn(console, "log");

    const phone = randomPhone();
    const res = await requestOtpAction(phone, "PHONE");

    expect(res).toEqual({
      success: false,
      error: PHONE_UNAVAILABLE_MESSAGE,
    });

    const otpRows = await prisma.otpCode.findMany({
      where: { identifier: phone },
    });
    expect(otpRows).toHaveLength(0);

    const allLogs = consoleSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(allLogs).not.toContain("WhatsApp OTP");
  });

  it("Case B: production + flag unset: contact change to a new phone returns failure with same message for BOTH a free phone and an already owned phone; zero OtpCode rows for either", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_OTP_LIVE;

    const callerEmail = `${genId("m1test_caller")}@habitt.test`;
    const callerUser = await createTestUser({
      id: genId("m1test_caller"),
      email: callerEmail,
      role: "CUSTOMER",
    });

    const ownedPhone = randomPhone();
    await createTestUser({
      id: genId("m1test_other"),
      phone: ownedPhone,
      email: `${genId("m1test_other")}@habitt.test`,
      role: "CUSTOMER",
    });

    const { sid } = await createSession({ userId: callerUser.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: callerUser.id,
      role: "CUSTOMER",
      email: callerUser.email,
      phone: null,
      name: callerUser.name,
      sid,
      stepUpAt: new Date(),
    });

    const freePhone = randomPhone();

    // 1. Free phone
    const freeRes = await requestContactChangeAction({
      channel: "PHONE",
      newValue: freePhone,
    });
    expect(freeRes).toEqual({
      success: false,
      message: PHONE_UNAVAILABLE_MESSAGE,
    });

    // 2. Already owned phone
    const takenRes = await requestContactChangeAction({
      channel: "PHONE",
      newValue: ownedPhone,
    });
    expect(takenRes).toEqual({
      success: false,
      message: PHONE_UNAVAILABLE_MESSAGE,
    });

    // Zero OtpCode rows for either
    const freeCodes = await prisma.otpCode.findMany({
      where: { identifier: freePhone },
    });
    expect(freeCodes).toHaveLength(0);

    const takenCodes = await prisma.otpCode.findMany({
      where: { identifier: ownedPhone },
    });
    expect(takenCodes).toHaveLength(0);
  });

  it("Case C: NODE_ENV=test + flag unset: both paths work through console fallback (spy on console.log) and an OtpCode row is created", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.WHATSAPP_OTP_LIVE;

    const loggedCodes: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = args.join(" ");
      const match = line.match(/WhatsApp OTP for \S+: (\d{6})/);
      if (match) {
        loggedCodes.push(match[1]);
      }
    });

    // 1. requestOtpAction (phone login)
    const phoneA = randomPhone();
    const loginRes = await requestOtpAction(phoneA, "PHONE");
    expect(loginRes.success).toBe(true);

    const otpRowsA = await prisma.otpCode.findMany({
      where: { identifier: phoneA },
    });
    expect(otpRowsA.length).toBeGreaterThan(0);

    // 2. requestContactChangeAction (contact change to phone)
    const user = await createTestUser({
      id: genId("m1test_user_c"),
      email: `${genId("m1test_user_c")}@habitt.test`,
      role: "CUSTOMER",
    });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: null,
      name: user.name,
      sid,
      stepUpAt: new Date(),
    });

    const phoneB = randomPhone();
    const contactRes = await requestContactChangeAction({
      channel: "PHONE",
      newValue: phoneB,
    });
    expect(contactRes.success).toBe(true);
    expect(contactRes.message).toBe("If this can be used, we've sent a code to it.");

    const otpRowsB = await prisma.otpCode.findMany({
      where: { identifier: phoneB },
    });
    expect(otpRowsB.length).toBeGreaterThan(0);

    expect(loggedCodes.length).toBe(2);
  });

  it("Case D: email login and email contact change behave exactly as before in production mode (reuse sender mocks)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_OTP_LIVE;

    vi.spyOn(turnstileModule, "verifyTurnstile").mockResolvedValue(true);
    const sendEmailSpy = vi.spyOn(otpEmailModule, "sendEmailOtp").mockResolvedValue({
      success: true,
    });
    vi.spyOn(ratelimitModule, "limit").mockResolvedValue({
      ok: true,
      retryAfterSec: 0,
    });
    vi.spyOn(ratelimitModule, "otpDailyCap").mockResolvedValue({
      ok: true,
    });

    // 1. Email login
    const loginEmail = `${genId("m1test_login")}@habitt.test`;
    const loginRes = await requestOtpAction(loginEmail, "EMAIL");
    expect(loginRes.success).toBe(true);

    const loginRows = await prisma.otpCode.findMany({
      where: { identifier: loginEmail },
    });
    expect(loginRows.length).toBeGreaterThan(0);

    // 2. Email contact change
    const callerUser = await createTestUser({
      id: genId("m1test_caller_d"),
      email: `${genId("m1test_caller_d")}@habitt.test`,
      role: "CUSTOMER",
    });
    const { sid } = await createSession({ userId: callerUser.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: callerUser.id,
      role: "CUSTOMER",
      email: callerUser.email,
      phone: null,
      name: callerUser.name,
      sid,
      stepUpAt: new Date(),
    });

    const newEmail = `${genId("m1test_new_email")}@habitt.test`;
    const contactRes = await requestContactChangeAction({
      channel: "EMAIL",
      newValue: newEmail,
    });
    expect(contactRes.success).toBe(true);
    expect(contactRes.message).toBe("If this can be used, we've sent a code to it.");

    const contactRows = await prisma.otpCode.findMany({
      where: { identifier: newEmail },
    });
    expect(contactRows.length).toBeGreaterThan(0);

    expect(sendEmailSpy).toHaveBeenCalledTimes(2);
  });
});
