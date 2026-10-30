import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CUSTOMER_IDLE_MS,
  STAFF_IDLE_MS,
  STAFF_ABSOLUTE_MS,
  TOUCH_INTERVAL_MS,
  computeUaHash,
  computeIpPrefix,
} from "@/lib/sessions";

describe("T35: Session lifetimes and helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("constants match specifications", () => {
    expect(CUSTOMER_IDLE_MS).toBe(365 * 24 * 60 * 60 * 1000);
    expect(STAFF_IDLE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(STAFF_ABSOLUTE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(TOUCH_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("computeUaHash hashes user agent deterministically with sha256", () => {
    const ua1 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
    const hash1 = computeUaHash(ua1);
    const hash2 = computeUaHash(ua1);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(computeUaHash("")).toHaveLength(64);
  });

  it("computeIpPrefix anonymizes IPv4 to /24 and IPv6 to /48", () => {
    expect(computeIpPrefix("192.168.1.42")).toBe("192.168.1.0/24");
    expect(computeIpPrefix("10.0.50.99")).toBe("10.0.50.0/24");
    expect(computeIpPrefix("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe("2001:0db8:85a3::/48");
    expect(computeIpPrefix("unknown")).toBe("unknown");
    expect(computeIpPrefix(null)).toBe("unknown");
  });
});

