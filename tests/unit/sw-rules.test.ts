import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SW_EXCLUDED_PREFIXES, isExcludedSwPath } from "@/lib/pwa/sw-rules";

describe("sw-rules", () => {
  it("excludes all sensitive paths in shared rules", () => {
    const required = ["/api/", "/admin/", "/checkout", "/account", "/staff", "/auth"];
    for (const prefix of required) {
      expect(SW_EXCLUDED_PREFIXES).toContain(prefix);
      expect(isExcludedSwPath(prefix)).toBe(true);
      expect(isExcludedSwPath(`${prefix}nested`)).toBe(true);
    }
    expect(isExcludedSwPath("/shop")).toBe(false);
    expect(isExcludedSwPath("/")).toBe(false);
  });

  it("public/sw.js contains all excluded prefixes and header guards", () => {
    const swPath = path.join(process.cwd(), "public", "sw.js");
    const swText = fs.readFileSync(swPath, "utf8");

    for (const prefix of SW_EXCLUDED_PREFIXES) {
      expect(swText).toContain(`"${prefix}"`);
    }
    expect(swText).toContain("Set-Cookie");
    expect(swText).toContain("Authorization");
    expect(swText).toContain('request.method !== "GET"');
  });
});
