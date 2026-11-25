import { describe, it, expect } from "vitest";
import { parseIstDateRange, formatIstDate } from "@/lib/admin/reports";

describe("reports-ist-boundaries", () => {
  it("converts Date to IST date string YYYY-MM-DD", () => {
    // 2026-11-23 00:00:00 UTC is 2026-11-23 05:30:00 IST
    const d1 = new Date(Date.UTC(2026, 10, 23, 0, 0, 0));
    expect(formatIstDate(d1)).toBe("2026-11-23");

    // 2026-11-22 20:00:00 UTC is 2026-11-23 01:30:00 IST (next day in IST)
    const d2 = new Date(Date.UTC(2026, 10, 22, 20, 0, 0));
    expect(formatIstDate(d2)).toBe("2026-11-23");

    // 2026-11-22 18:29:59.999 UTC is 2026-11-22 23:59:59.999 IST (previous day in IST)
    const d3 = new Date(Date.UTC(2026, 10, 22, 18, 29, 59, 999));
    expect(formatIstDate(d3)).toBe("2026-11-22");
  });

  it("parses IST date string into exact UTC start and end boundaries", () => {
    const { fromUtc, toUtc, fromIst, toIst } = parseIstDateRange("2026-11-01", "2026-11-15");
    expect(fromIst).toBe("2026-11-01");
    expect(toIst).toBe("2026-11-15");

    // 2026-11-01 00:00:00.000 IST = 2026-10-31 18:30:00.000 UTC
    expect(fromUtc.toISOString()).toBe("2026-10-31T18:30:00.000Z");

    // 2026-11-15 23:59:59.999 IST = 2026-11-15 18:29:59.999 UTC
    expect(toUtc.toISOString()).toBe("2026-11-15T18:29:59.999Z");
  });

  it("handles month and year cross boundaries correctly", () => {
    // Cross year: 2026-12-31 to 2027-01-01
    const res = parseIstDateRange("2026-12-31", "2027-01-01");
    expect(res.fromUtc.toISOString()).toBe("2026-12-30T18:30:00.000Z");
    expect(res.toUtc.toISOString()).toBe("2027-01-01T18:29:59.999Z");
  });

  it("defaults to 30 days range when parameters are omitted", () => {
    const res = parseIstDateRange();
    expect(res.fromIst).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.toIst).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const diffMs = res.toUtc.getTime() - res.fromUtc.getTime();
    // 30 days = 30 * 24 * 60 * 60 * 1000 - 1 ms = 2,591,999,999 ms
    expect(diffMs).toBe(30 * 24 * 60 * 60 * 1000 - 1);
  });
});
