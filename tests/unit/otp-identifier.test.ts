import { describe, it, expect, afterEach, vi } from "vitest";
import { otpIdentifierKey } from "@/lib/otp-identifier";

describe("lib/otp-identifier", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is deterministic and produces 64-char hex in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "test-pepper-secret-value");

    const a1 = otpIdentifierKey("alice@example.com");
    const a2 = otpIdentifierKey("alice@example.com");
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^[0-9a-f]{64}$/);
    expect(a1).not.toContain("alice@example.com");
  });

  it("produces different keys for different inputs", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "test-pepper-secret-value");

    const k1 = otpIdentifierKey("alice@example.com");
    const k2 = otpIdentifierKey("bob@example.com");
    expect(k1).not.toBe(k2);
  });

  it("prefixes m1test~ in non-production for m1test inputs, but not in production", () => {
    vi.stubEnv("OTP_PEPPER", "test-pepper-secret-value");

    vi.stubEnv("NODE_ENV", "test");
    const nonProdKey = otpIdentifierKey("m1test_user@example.test");
    expect(nonProdKey).toMatch(/^m1test~[0-9a-f]{64}$/);
    expect(nonProdKey).not.toContain("m1test_user@example.test");

    vi.stubEnv("NODE_ENV", "production");
    const prodKey = otpIdentifierKey("m1test_user@example.test");
    expect(prodKey).toMatch(/^[0-9a-f]{64}$/);
    expect(prodKey.startsWith("m1test~")).toBe(false);
  });

  it("throws in production when OTP_PEPPER is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_PEPPER", "");

    expect(() => otpIdentifierKey("alice@example.com")).toThrow(
      "OTP_PEPPER environment variable is required in production"
    );
  });

  it("is deterministic over already-normalised inputs", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("OTP_PEPPER", "test-pepper-secret-value");

    const first = otpIdentifierKey("+919876543210");
    const second = otpIdentifierKey("+919876543210");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
