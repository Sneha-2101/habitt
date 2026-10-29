import { describe, it, expect } from "vitest";
import { sanitizeCsvCell } from "@/lib/csv";

describe("sanitizeCsvCell", () => {
  it("prefixes a single quote when string starts with formula triggers (=, +, -, @, \\t, \\r)", () => {
    expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe("\"'=cmd|' /C calc'!A0\"");
    expect(sanitizeCsvCell("+1234567890")).toBe("\"'+1234567890\"");
    expect(sanitizeCsvCell("-50")).toBe("\"'-50\"");
    expect(sanitizeCsvCell("@SUM(A1:A10)")).toBe("\"'@SUM(A1:A10)\"");
    expect(sanitizeCsvCell("\tmalicious")).toBe("\"'\tmalicious\"");
    expect(sanitizeCsvCell("\rmalicious")).toBe("\"'\rmalicious\"");
  });

  it("escapes quotes by doubling them", () => {
    expect(sanitizeCsvCell('John "The Boss" Doe')).toBe('"John ""The Boss"" Doe"');
    expect(sanitizeCsvCell('"')).toBe('""""');
  });

  it("handles normal text and wraps in double quotes without single quote prefix", () => {
    expect(sanitizeCsvCell("Regular Customer Name")).toBe('"Regular Customer Name"');
    expect(sanitizeCsvCell("Mumbai, Maharashtra")).toBe('"Mumbai, Maharashtra"');
  });

  it("handles null and undefined by returning empty cell quotes", () => {
    expect(sanitizeCsvCell(null)).toBe('""');
    expect(sanitizeCsvCell(undefined)).toBe('""');
  });

  it("handles numbers properly", () => {
    expect(sanitizeCsvCell(1234)).toBe('"1234"');
    expect(sanitizeCsvCell(-10)).toBe("\"'-10\""); // starts with -
    expect(sanitizeCsvCell(0)).toBe('"0"');
  });
});

