import { describe, it, expect } from "vitest";
import {
  isProductVisible,
  isProductPurchasable,
  storefrontProductWhere,
} from "@/lib/catalog/visibility";

describe("catalog-visibility unit tests", () => {
  const now = new Date("2026-11-23T12:00:00.000Z");

  it("handles null and undefined safely", () => {
    expect(isProductVisible(null, now)).toBe(false);
    expect(isProductVisible(undefined, now)).toBe(false);
    expect(isProductPurchasable(null, now)).toBe(false);
  });

  it("rejects non-active products regardless of publishAt", () => {
    expect(isProductVisible({ status: "DRAFT", publishAt: null }, now)).toBe(false);
    expect(
      isProductVisible(
        { status: "DRAFT", publishAt: new Date(now.getTime() - 1000) },
        now
      )
    ).toBe(false);
    expect(isProductVisible({ status: "ARCHIVED", publishAt: null }, now)).toBe(false);
    expect(
      isProductVisible(
        { status: "ARCHIVED", publishAt: new Date(now.getTime() - 1000) },
        now
      )
    ).toBe(false);
  });

  it("allows active products with null or undefined publishAt immediately", () => {
    expect(isProductVisible({ status: "ACTIVE", publishAt: null }, now)).toBe(true);
    expect(isProductVisible({ status: "ACTIVE" }, now)).toBe(true);
    expect(isProductPurchasable({ status: "ACTIVE", publishAt: null }, now)).toBe(true);
  });

  it("handles boundary exactly at publishAt", () => {
    const exactBoundary = new Date("2026-11-23T12:00:00.000Z");
    expect(
      isProductVisible({ status: "ACTIVE", publishAt: exactBoundary }, exactBoundary)
    ).toBe(true);
    expect(
      isProductPurchasable({ status: "ACTIVE", publishAt: exactBoundary }, exactBoundary)
    ).toBe(true);
  });

  it("handles past and future publish dates relative to now", () => {
    const oneSecPast = new Date(now.getTime() - 1000);
    const oneSecFuture = new Date(now.getTime() + 1000);

    expect(isProductVisible({ status: "ACTIVE", publishAt: oneSecPast }, now)).toBe(true);
    expect(isProductVisible({ status: "ACTIVE", publishAt: oneSecFuture }, now)).toBe(false);
    expect(isProductPurchasable({ status: "ACTIVE", publishAt: oneSecFuture }, now)).toBe(false);
  });

  it("builds correct Prisma where fragment", () => {
    const where = storefrontProductWhere(now);
    expect(where.status).toBe("ACTIVE");
    expect(where.OR).toEqual([
      { publishAt: null },
      { publishAt: { lte: now } },
    ]);
  });
});
