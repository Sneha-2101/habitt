import { describe, it, expect } from "vitest";
import { isDefiniteGatewayRejection } from "@/lib/refunds/gateway-errors";

describe("refunds/isDefiniteGatewayRejection", () => {
  it("returns true for definite 4xx rejections excluding 408", () => {
    expect(isDefiniteGatewayRejection({ statusCode: 400, error: { description: "Bad request" } })).toBe(true);
    expect(isDefiniteGatewayRejection({ statusCode: 401 })).toBe(true);
    expect(isDefiniteGatewayRejection({ statusCode: 404 })).toBe(true);
    expect(isDefiniteGatewayRejection({ statusCode: 429 })).toBe(true);
  });

  it("returns false for 408, 5xx, network/timeout errors, and non-object values", () => {
    expect(isDefiniteGatewayRejection({ statusCode: 408 })).toBe(false);
    expect(isDefiniteGatewayRejection({ statusCode: 500 })).toBe(false);
    expect(isDefiniteGatewayRejection({ statusCode: 502 })).toBe(false);
    expect(isDefiniteGatewayRejection({ statusCode: 503 })).toBe(false);
    expect(isDefiniteGatewayRejection({ error: { description: "missing status" } })).toBe(false);
    expect(isDefiniteGatewayRejection(new Error("timeout"))).toBe(false);
    expect(
      isDefiniteGatewayRejection(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))
    ).toBe(false);
    expect(isDefiniteGatewayRejection(null)).toBe(false);
    expect(isDefiniteGatewayRejection("timeout")).toBe(false);
  });
});
