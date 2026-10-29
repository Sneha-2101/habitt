import { describe, it, expect } from "vitest";
import { safeRedirect } from "@/lib/safe-redirect";

describe("safeRedirect", () => {
  it("allows safe internal paths", () => {
    expect(safeRedirect("/shop")).toBe("/shop");
    expect(safeRedirect("/account?tab=orders")).toBe("/account?tab=orders");
    expect(safeRedirect("/product/oversized-heavyweight-tee")).toBe("/product/oversized-heavyweight-tee");
    expect(safeRedirect("/checkout")).toBe("/checkout");
  });

  it("rejects external URLs and returns fallback", () => {
    expect(safeRedirect("https://attacker.com")).toBe("/");
    expect(safeRedirect("http://evil.com/phish")).toBe("/");
    expect(safeRedirect("https://attacker.com", "/fallback")).toBe("/fallback");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirect("//evil.com")).toBe("/");
    expect(safeRedirect("//evil.com/path")).toBe("/");
    expect(safeRedirect("/\\evil.com")).toBe("/");
    expect(safeRedirect("/evil.com:80")).toBe("/");
  });

  it("rejects javascript and data protocols", () => {
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
    expect(safeRedirect("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("returns fallback for null, undefined, empty, or non-string inputs", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect("")).toBe("/");
    expect(safeRedirect("   ")).toBe("/");
    expect(safeRedirect(null, "/shop")).toBe("/shop");
  });
});

