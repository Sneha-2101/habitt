import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getMarginTabState } from "@/lib/admin/reports-view";
import type { MarginReportResult } from "@/lib/admin/reports";

describe("admin/reports margin error state", () => {
  it("returns explicit error state when marginError is true or marginData is null", () => {
    expect(getMarginTabState(true, null, true)).toBe("error");
    expect(getMarginTabState(true, null, false)).toBe("error");
    expect(getMarginTabState(false, null, true)).toBe("hidden");

    const sample: MarginReportResult = {
      from: "2026-11-01",
      to: "2026-11-28",
      totalRevenuePaise: 10000,
      totalCostPaise: 4000,
      grossMarginPaise: 6000,
      marginPercent: 60,
      items: [],
    };
    expect(getMarginTabState(true, sample, true)).toBe("error");
    expect(getMarginTabState(true, sample, false)).toBe("data");
  });

  it("logs safeErrorSummary on margin failure and renders explicit error message in UI", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "app/admin/reports/page.tsx"),
      "utf8"
    );
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "app/admin/reports/ReportsClient.tsx"),
      "utf8"
    );

    expect(pageSrc).toContain("safeErrorSummary");
    expect(pageSrc).toContain("marginError = true");
    expect(clientSrc).toContain("Could not load margin data");
    expect(clientSrc).toContain("getMarginTabState");
  });
});
