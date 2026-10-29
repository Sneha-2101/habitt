import { describe, it, expect } from "vitest";
import { getClientIp } from "@/lib/client-ip";

describe("getClientIp", () => {
  it("extracts the first IP from x-forwarded-for header list", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "203.0.113.195, 70.41.3.18, 150.172.238.178");
    expect(getClientIp(headers)).toBe("203.0.113.195");
  });

  it("extracts IP from plain record with x-forwarded-for", () => {
    const record = {
      "x-forwarded-for": "198.51.100.22, 10.0.0.1",
    };
    expect(getClientIp(record)).toBe("198.51.100.22");
  });

  it("extracts single IP from x-forwarded-for", () => {
    const headers = new Headers();
    headers.set("x-forwarded-for", "198.51.100.42");
    expect(getClientIp(headers)).toBe("198.51.100.42");
  });

  it("falls back to x-real-ip if x-forwarded-for is missing", () => {
    const headers = new Headers();
    headers.set("x-real-ip", "192.0.2.1");
    expect(getClientIp(headers)).toBe("192.0.2.1");

    const record = { "x-real-ip": "192.0.2.2" };
    expect(getClientIp(record)).toBe("192.0.2.2");
  });

  it("returns 'unknown' when neither header is present", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");

    const record = {};
    expect(getClientIp(record)).toBe("unknown");
  });

  it("returns 'unknown' when headers object is null or undefined", () => {
    expect(getClientIp(null)).toBe("unknown");
    expect(getClientIp(undefined)).toBe("unknown");
  });
});

