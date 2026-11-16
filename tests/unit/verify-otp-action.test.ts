import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockHeadersFn = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => mockHeadersFn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otpCode: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { verifyOtpAction } from "@/lib/actions/otp";
import { resetMemoryLimits } from "@/lib/ratelimit";

describe("verifyOtpAction: IP forwarding and rate limiting", () => {
  beforeEach(() => {
    resetMemoryLimits();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMemoryLimits();
    vi.restoreAllMocks();
  });

  it("with the otpVerifyIp limiter exhausted, verify via this action is blocked", async () => {
    const testIp = "203.0.113.88";
    const reqHeaders = new Headers();
    reqHeaders.set("x-forwarded-for", testIp);
    mockHeadersFn.mockResolvedValue(reqHeaders);

    // otpVerifyIp limit is 30 per 15 min.
    // Call verifyOtpAction 30 times with unique identifiers so otpVerifyIdentifier (10) is not triggered.
    for (let i = 1; i <= 30; i++) {
      const res = await verifyOtpAction(`user${i}@example.com`, "123456");
      expect(res.error).not.toBe("Too many verification attempts. Please wait 15 minutes.");
    }

    // 31st attempt from the same IP must be blocked by the otpVerifyIp limiter
    const blockedRes = await verifyOtpAction("new_user@example.com", "123456");
    expect(blockedRes.success).toBe(false);
    expect(blockedRes.error).toBe("Too many verification attempts. Please wait 15 minutes.");
  });
});
