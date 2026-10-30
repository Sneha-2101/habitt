import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";
import { authorizeCustomerOtp } from "@/lib/auth-authorize";
import * as otpModule from "@/lib/otp";

describe("T44: Concurrent first customer login", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("concurrent first customer login for the same new identifier creates exactly one user", async () => {
    const phone = `+9199999${Math.floor(10000 + Math.random() * 90000)}`;

    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: phone,
      channel: "PHONE",
    });

    // Run 5 concurrent authorizations for the brand new phone identifier
    const results = await Promise.all([
      authorizeCustomerOtp({ identifier: phone, code: "123456" }),
      authorizeCustomerOtp({ identifier: phone, code: "123456" }),
      authorizeCustomerOtp({ identifier: phone, code: "123456" }),
      authorizeCustomerOtp({ identifier: phone, code: "123456" }),
      authorizeCustomerOtp({ identifier: phone, code: "123456" }),
    ]);

    // All should succeed
    expect(results.every((r) => r !== null)).toBe(true);

    // All should point to the exact same user ID
    const userIds = new Set(results.map((r) => r!.id));
    expect(userIds.size).toBe(1);

    // Exactly one User row should exist in the database for this phone
    const count = await prisma.user.count({
      where: { phone },
    });
    expect(count).toBe(1);
  });
});
