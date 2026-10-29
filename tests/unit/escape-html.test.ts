import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/escape-html";

describe("escapeHtml", () => {
  it("escapes &, <, >, \", and '", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
    expect(escapeHtml('<script>alert("XSS & \'attack\'")</script>')).toBe(
      "&lt;script&gt;alert(&quot;XSS &amp; &#39;attack&#39;&quot;)&lt;/script&gt;"
    );
  });

  it("handles numbers safely", () => {
    expect(escapeHtml(12345)).toBe("12345");
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(-42)).toBe("-42");
    expect(escapeHtml(3.1415)).toBe("3.1415");
  });

  it("handles null and undefined safely", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("handles plain strings without entities unmodified", () => {
    expect(escapeHtml("Habitt Minimalist Basics")).toBe("Habitt Minimalist Basics");
    expect(escapeHtml("")).toBe("");
  });
});

