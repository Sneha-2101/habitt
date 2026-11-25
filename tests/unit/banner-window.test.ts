import { describe, it, expect } from "vitest";
import { isBannerActiveAt } from "@/lib/content/banner-window";

describe("banner-window", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  it("returns false when isActive is false", () => {
    expect(isBannerActiveAt({ isActive: false, startsAt: null, endsAt: null }, now)).toBe(false);
  });

  it("returns true when isActive is true and window is open-ended", () => {
    expect(isBannerActiveAt({ isActive: true, startsAt: null, endsAt: null }, now)).toBe(true);
  });

  it("returns false before startsAt and after endsAt", () => {
    const futureStart = new Date("2026-11-26T00:00:00.000Z");
    const pastEnd = new Date("2026-11-24T00:00:00.000Z");

    expect(isBannerActiveAt({ isActive: true, startsAt: futureStart, endsAt: null }, now)).toBe(false);
    expect(isBannerActiveAt({ isActive: true, startsAt: null, endsAt: pastEnd }, now)).toBe(false);
  });

  it("returns true when now is within startsAt..endsAt", () => {
    const start = new Date("2026-11-24T00:00:00.000Z");
    const end = new Date("2026-11-26T00:00:00.000Z");
    expect(isBannerActiveAt({ isActive: true, startsAt: start, endsAt: end }, now)).toBe(true);
  });
});
