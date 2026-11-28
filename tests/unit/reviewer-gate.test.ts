import { describe, it, expect, afterEach, vi } from "vitest";
import { isReviewerLoginActive } from "@/lib/reviewer";

describe("lib/reviewer production expiry gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubValidReviewerBase(expiresAt: Date) {
    vi.stubEnv("REVIEWER_OTP_ENABLED", "true");
    vi.stubEnv("REVIEWER_OTP_CODE", "123456");
    vi.stubEnv("REVIEWER_IDENTIFIER", "reviewer@example.test");
    vi.stubEnv("REVIEWER_OTP_EXPIRES_AT", expiresAt.toISOString());
  }

  it("allows reviewer login in production when expiry is within 14 days", () => {
    vi.stubEnv("NODE_ENV", "production");
    stubValidReviewerBase(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    expect(isReviewerLoginActive()).toBe(true);
  });

  it("disables reviewer login in production when expiry exceeds 14 days", () => {
    vi.stubEnv("NODE_ENV", "production");
    stubValidReviewerBase(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));
    expect(isReviewerLoginActive()).toBe(false);
  });

  it("allows >14 day expiry in non-production when otherwise valid", () => {
    vi.stubEnv("NODE_ENV", "test");
    stubValidReviewerBase(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    expect(isReviewerLoginActive()).toBe(true);
  });

  it("disables reviewer login when expired in any environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    stubValidReviewerBase(new Date(Date.now() - 60 * 1000));
    expect(isReviewerLoginActive()).toBe(false);
  });
});
