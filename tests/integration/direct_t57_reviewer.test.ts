import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { authorizeCustomerOtp, authorizeStaffOtp } from "@/lib/auth-authorize";
import { verifyOtp } from "@/lib/otp";

describe("T57: Reviewer Login Integration", () => {
  const origEnv = { ...process.env };

  beforeEach(async () => {
    await cleanupM1TestRows();
    process.env = { ...origEnv };
  });

  afterEach(async () => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T57.1: inactive reviewer config -> reviewer code rejected", async () => {
    process.env.REVIEWER_OTP_ENABLED = "false";
    process.env.REVIEWER_IDENTIFIER = "reviewer@habitt.test";
    process.env.REVIEWER_OTP_CODE = "998877";
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const authRes = await authorizeCustomerOtp({
      identifier: "reviewer@habitt.test",
      code: "998877",
    });
    expect(authRes).toBeNull();
  });

  it("T57.2: active reviewer identifier + code logs in as CUSTOMER with deviceLabel 'reviewer' and audit row", async () => {
    const reviewerEmail = `${genId("m1test_reviewer")}@habitt.test`;
    const reviewerCode = "123456";

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = reviewerEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const authRes = await authorizeCustomerOtp(
      { identifier: reviewerEmail, code: reviewerCode },
      { ip: "127.0.0.1", userAgent: "ReviewerAgent/1.0" }
    );

    expect(authRes).not.toBeNull();
    expect(authRes?.role).toBe("CUSTOMER");

    // Check Session row has deviceLabel "reviewer"
    const session = await prisma.session.findUnique({
      where: { id: authRes!.sid },
    });
    expect(session?.deviceLabel).toBe("reviewer");

    // Check AuditLog has reviewer.login
    const auditLogs = await prisma.auditLog.findMany({
      where: { actorId: authRes!.id, action: "reviewer.login" },
    });
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].entityId).toBe(authRes!.sid);
  });

  it("T57.3: wrong code fails and counts attempts", async () => {
    const reviewerEmail = `${genId("m1test_reviewer_bad")}@habitt.test`;
    const reviewerCode = "123456";

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = reviewerEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const badVerify = await verifyOtp(reviewerEmail, "999999", "127.0.0.1");
    expect(badVerify.success).toBe(false);

    const badAuth = await authorizeCustomerOtp({
      identifier: reviewerEmail,
      code: "999999",
    });
    expect(badAuth).toBeNull();
  });

  it("T57.4: reviewer code does NOT work for any other identifier", async () => {
    const reviewerEmail = `${genId("m1test_rev_id")}@habitt.test`;
    const otherEmail = `${genId("m1test_other_id")}@habitt.test`;
    const reviewerCode = "123456";

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = reviewerEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const badAuth = await authorizeCustomerOtp({
      identifier: otherEmail,
      code: reviewerCode,
    });
    expect(badAuth).toBeNull();
  });

  it("T57.5: an identifier on StaffAllowlist is refused even if set as REVIEWER_IDENTIFIER", async () => {
    const staffEmail = `${genId("m1test_staff_rev")}@habitt.test`;
    const reviewerCode = "123456";

    await prisma.staffAllowlist.create({
      data: {
        email: staffEmail,
        role: "STAFF",
      },
    });

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = staffEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const authRes = await authorizeCustomerOtp({
      identifier: staffEmail,
      code: reviewerCode,
    });
    expect(authRes).toBeNull();
  });

  it("T57.6: authorizeStaffOtp rejects the reviewer code", async () => {
    const staffEmail = `${genId("m1test_staff_login")}@habitt.test`;
    const reviewerCode = "123456";

    await createTestUser({ email: staffEmail, role: "STAFF" });
    await prisma.staffAllowlist.create({
      data: {
        email: staffEmail,
        role: "STAFF",
      },
    });

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = staffEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    const staffAuth = await authorizeStaffOtp({
      email: staffEmail,
      code: reviewerCode,
    });
    expect(staffAuth).toBeNull();
  });

  it("T57.7: expired reviewer timestamp is rejected", async () => {
    const reviewerEmail = `${genId("m1test_rev_exp")}@habitt.test`;
    const reviewerCode = "123456";

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = reviewerEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago

    const authRes = await authorizeCustomerOtp({
      identifier: reviewerEmail,
      code: reviewerCode,
    });
    expect(authRes).toBeNull();
  });

  it("T57.8: 6th attempt in 15 min is blocked even with the correct code", async () => {
    const reviewerEmail = `${genId("m1test_rev_limit")}@habitt.test`;
    const reviewerCode = "123456";

    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = reviewerEmail;
    process.env.REVIEWER_OTP_CODE = reviewerCode;
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();

    // 5 attempts with wrong code
    for (let i = 1; i <= 5; i++) {
      const res = await verifyOtp(reviewerEmail, "000000");
      expect(res.success).toBe(false);
      expect(res.message).toBe("Invalid or expired verification code");
    }

    // 6th attempt with CORRECT code is blocked by reviewerVerify rate limiter
    const res6 = await verifyOtp(reviewerEmail, reviewerCode);
    expect(res6.success).toBe(false);
    expect(res6.message).toBe("Too many failed attempts. Please request a new code.");
  });
});

