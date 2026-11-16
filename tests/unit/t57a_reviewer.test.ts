import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isReviewerLoginActive, isReviewerIdentifier } from "@/lib/reviewer";

describe("T57a: isReviewerLoginActive unit checks", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns false by default when reviewer env variables are unset or false", () => {
    delete process.env.REVIEWER_OTP_ENABLED;
    delete process.env.REVIEWER_IDENTIFIER;
    delete process.env.REVIEWER_OTP_CODE;
    delete process.env.REVIEWER_OTP_EXPIRES_AT;

    expect(isReviewerLoginActive()).toBe(false);

    process.env.REVIEWER_OTP_ENABLED = "false";
    expect(isReviewerLoginActive()).toBe(false);
  });

  it("returns false when reviewer code is not exactly 6 digits", () => {
    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = "reviewer@example.com";
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 600000).toISOString();

    // 5 digits
    process.env.REVIEWER_OTP_CODE = "12345";
    expect(isReviewerLoginActive()).toBe(false);

    // 7 digits
    process.env.REVIEWER_OTP_CODE = "1234567";
    expect(isReviewerLoginActive()).toBe(false);

    // non-digit characters
    process.env.REVIEWER_OTP_CODE = "12345a";
    expect(isReviewerLoginActive()).toBe(false);
  });

  it("returns false when expiration timestamp is expired or invalid", () => {
    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = "reviewer@example.com";
    process.env.REVIEWER_OTP_CODE = "123456";

    // Expired in the past
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() - 1000).toISOString();
    expect(isReviewerLoginActive()).toBe(false);

    // Invalid date string
    process.env.REVIEWER_OTP_EXPIRES_AT = "not-a-date";
    expect(isReviewerLoginActive()).toBe(false);
  });

  it("returns false when reviewer identifier is empty or missing", () => {
    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_OTP_CODE = "123456";
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 600000).toISOString();
    process.env.REVIEWER_IDENTIFIER = "   ";

    expect(isReviewerLoginActive()).toBe(false);
  });

  it("returns true only when all conditions hold", () => {
    process.env.REVIEWER_OTP_ENABLED = "true";
    process.env.REVIEWER_IDENTIFIER = "reviewer@example.com";
    process.env.REVIEWER_OTP_CODE = "654321";
    process.env.REVIEWER_OTP_EXPIRES_AT = new Date(Date.now() + 3600000).toISOString();

    expect(isReviewerLoginActive()).toBe(true);
    expect(isReviewerIdentifier("reviewer@example.com")).toBe(true);
    expect(isReviewerIdentifier("other@example.com")).toBe(false);
  });
});

