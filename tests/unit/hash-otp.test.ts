import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { hashOtp } from "@/lib/otp";

describe("hashOtp", () => {
  const originalPepper = process.env.OTP_PEPPER;
  const originalSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.OTP_PEPPER = "test_unit_pepper_secret_value_12345";
  });

  afterEach(() => {
    process.env.OTP_PEPPER = originalPepper;
    process.env.AUTH_SECRET = originalSecret;
  });

  it("produces deterministic HMAC-SHA256 hex output", () => {
    const hash1 = hashOtp("user@example.com", "123456");
    const hash2 = hashOtp("user@example.com", "123456");

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/); // 64 hex characters for SHA-256
  });

  it("produces different hashes for different codes or identifiers", () => {
    const h1 = hashOtp("user@example.com", "123456");
    const h2 = hashOtp("user@example.com", "654321");
    const h3 = hashOtp("other@example.com", "123456");

    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h2).not.toBe(h3);
  });

  it("incorporates pepper into the HMAC", () => {
    process.env.OTP_PEPPER = "pepper_one";
    const h1 = hashOtp("user@example.com", "123456");

    process.env.OTP_PEPPER = "pepper_two";
    const h2 = hashOtp("user@example.com", "123456");

    expect(h1).not.toBe(h2);
  });

  it("verifies hash correctly with crypto.timingSafeEqual", () => {
    const expected = hashOtp("9876543210", "456789");
    const testHash = hashOtp("9876543210", "456789");

    const bufA = Buffer.from(expected, "hex");
    const bufB = Buffer.from(testHash, "hex");

    expect(bufA.length).toBe(bufB.length);
    expect(crypto.timingSafeEqual(bufA, bufB)).toBe(true);

    const wrongBuf = Buffer.from(hashOtp("9876543210", "000000"), "hex");
    expect(crypto.timingSafeEqual(bufA, wrongBuf)).toBe(false);
  });
});

