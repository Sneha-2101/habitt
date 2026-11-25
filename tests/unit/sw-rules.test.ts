import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SW_EXCLUDED_BASES, SW_EXCLUDED_PREFIXES, isExcludedSwPath } from "@/lib/pwa/sw-rules";

describe("sw-rules", () => {
  it("excludes all sensitive paths in shared rules", () => {
    const required = ["/api/", "/admin/", "/checkout", "/account", "/staff", "/auth"];
    for (const prefix of required) {
      expect(SW_EXCLUDED_PREFIXES).toContain(prefix);
      expect(isExcludedSwPath(prefix)).toBe(true);
      const nested = prefix.endsWith("/") ? `${prefix}nested` : `${prefix}/nested`;
      expect(isExcludedSwPath(nested)).toBe(true);
    }
    for (const base of SW_EXCLUDED_BASES) {
      expect(isExcludedSwPath(base)).toBe(true);
      expect(isExcludedSwPath(`${base}/foo`)).toBe(true);
      expect(isExcludedSwPath(`${base}s`)).toBe(false);
    }
    expect(isExcludedSwPath("/shop")).toBe(false);
    expect(isExcludedSwPath("/")).toBe(false);
  });

  it("public/sw.js contains all excluded bases and header guards", () => {
    const swPath = path.join(process.cwd(), "public", "sw.js");
    const swText = fs.readFileSync(swPath, "utf8");

    expect(swText).toContain('"/api/"');
    for (const base of SW_EXCLUDED_BASES) {
      expect(swText).toContain(`"${base}"`);
    }
    expect(swText).toContain("Authorization");
    expect(swText).toContain('request.method !== "GET"');
    expect(swText).not.toContain("Set-Cookie");
  });
});
