import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T117: Consent-Gated Meta Pixel & CSP Report-Only Headers", () => {
  it("never renders fbevents or facebook.com/tr in server HTML and sets Content-Security-Policy-Report-Only on /", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).not.toContain("fbevents");
    expect(html).not.toContain("facebook.com/tr");
    if (!process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim()) {
      expect(html).not.toContain("Cookie consent");
    }

    const cspReportOnly = res.headers.get("content-security-policy-report-only");
    const cspEnforcing = res.headers.get("content-security-policy");
    expect(cspReportOnly).toBeTruthy();
    expect(cspReportOnly).toContain("default-src 'self'");
    expect(cspEnforcing).toBeNull();
  });
});
