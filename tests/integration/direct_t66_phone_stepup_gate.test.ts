import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { requestStepUpAction, confirmStepUpAction } from "@/lib/actions/step-up";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";
import * as otpEmailModule from "@/lib/otp-email";
import * as ratelimitModule from "@/lib/ratelimit";

describe("T66: Phone step-up gating when WhatsApp is not live", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("Case A: NODE_ENV=production, WHATSAPP_OTP_LIVE unset, phone-only user, requestStepUpAction('PHONE') rejects with exact message; zero OtpCode rows; console.log not called with code", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_OTP_LIVE;

    const phone = "+9198765" + String(Math.floor(10000 + Math.random() * 90000));
    const user = await createTestUser({
      id: genId("m1test_user"),
      phone,
      email: null,
      role: "CUSTOMER",
    });

    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: null,
      phone: user.phone,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    const consoleSpy = vi.spyOn(console, "log");

    await expect(requestStepUpAction("PHONE")).rejects.toThrow(
      "Phone verification isn't available yet. Please use your email."
    );

    // Zero OtpCode rows for that identifier
    const otpRows = await prisma.otpCode.findMany({
      where: { identifier: phone },
    });
    expect(otpRows).toHaveLength(0);

    // console.log not called with the code
    const allLogs = consoleSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(allLogs).not.toContain("WhatsApp OTP");
  });

  it("Case B: NODE_ENV=test (non-production), WHATSAPP_OTP_LIVE unset, phone-only user: succeeds via dev console path; confirmStepUpAction records step-up on session", async () => {
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.WHATSAPP_OTP_LIVE;

    const phone = "+9198765" + String(Math.floor(10000 + Math.random() * 90000));
    const user = await createTestUser({
      id: genId("m1test_user"),
      phone,
      email: null,
      role: "CUSTOMER",
    });

    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: null,
      phone: user.phone,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    let loggedCode: string | null = null;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = args.join(" ");
      const match = line.match(/WhatsApp OTP for \S+: (\d{6})/);
      if (match) {
        loggedCode = match[1];
      }
    });

    const reqRes = await requestStepUpAction("PHONE");
    expect(reqRes.success).toBe(true);
    expect(loggedCode).not.toBeNull();
    expect(typeof loggedCode).toBe("string");

    // Session before confirmStepUpAction
    const sessionBefore = await prisma.session.findUnique({ where: { id: sid } });
    expect(sessionBefore?.stepUpAt).toBeNull();

    // Confirm step-up with the code
    const confirmRes = await confirmStepUpAction(loggedCode!);
    expect(confirmRes.success).toBe(true);

    // Step-up is recorded on session
    const sessionAfter = await prisma.session.findUnique({ where: { id: sid } });
    expect(sessionAfter?.stepUpAt).not.toBeNull();
  });

  it("Case C: user with an email, channel EMAIL: unaffected by the flag in production-mode stub", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WHATSAPP_OTP_LIVE;

    const email = `${genId("m1test_email")}@example.test`;
    const user = await createTestUser({
      id: genId("m1test_user"),
      email,
      phone: null,
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
      stepUpAt: null,
    });

    const sendEmailSpy = vi.spyOn(otpEmailModule, "sendEmailOtp").mockResolvedValue({
      success: true,
    });
    vi.spyOn(ratelimitModule, "limit").mockResolvedValue({
      ok: true,
      retryAfterSec: 0,
    });

    const res = await requestStepUpAction("EMAIL");
    expect(res.success).toBe(true);
    expect(res.message).toContain("Verification code sent to");
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });
});
