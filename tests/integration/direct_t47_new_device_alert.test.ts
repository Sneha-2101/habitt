import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, genId } from "../helpers/fixtures";
import { authorizeStaffOtp } from "@/lib/auth-authorize";
import * as otpModule from "@/lib/otp";
import * as emailModule from "@/lib/email";

describe("T47: New Device Sign-In Alert", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("first staff login for a uaHash sends the alert; second with same UA does not; different UA does; sender throw does not block login", async () => {
    const email = `${genId("m1test_t47_alert")}@habitt.test`;
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

    const ua1 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0";
    const ctx1 = {
      ip: "192.168.1.10",
      userAgent: ua1,
    };

    // 1. First login with ua1 -> sends alert
    const session1 = await authorizeStaffOtp({ email, code: "123456" }, ctx1);
    expect(session1).not.toBeNull();
    expect(session1?.sid).toBeDefined();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: email,
      })
    );

    // 2. Second login with SAME ua1 -> does NOT send alert
    const session2 = await authorizeStaffOtp({ email, code: "123456" }, ctx1);
    expect(session2).not.toBeNull();
    expect(session2?.sid).toBeDefined();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // 3. Different UA (ua2) -> DOES send alert
    const ua2 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) TestMobile/2.0";
    const ctx2 = {
      ip: "192.168.1.20",
      userAgent: ua2,
    };
    const session3 = await authorizeStaffOtp({ email, code: "123456" }, ctx2);
    expect(session3).not.toBeNull();
    expect(session3?.sid).toBeDefined();
    expect(alertSpy).toHaveBeenCalledTimes(2);

    // 4. Different UA (ua3) where alert sender throws -> login still succeeds and returns session
    alertSpy.mockRejectedValueOnce(new Error("Email provider network error"));
    const ua3 = "Mozilla/5.0 (X11; Linux x86_64) TestLinux/3.0";
    const ctx3 = {
      ip: "192.168.1.30",
      userAgent: ua3,
    };
    const session4 = await authorizeStaffOtp({ email, code: "123456" }, ctx3);
    expect(session4).not.toBeNull();
    expect(session4?.sid).toBeDefined();
    expect(session4?.role).toBe("STAFF");
  });
});

