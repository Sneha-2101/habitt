import { describe, it, expect } from "vitest";
import { maskEmail, maskPhone, safeErrorSummary } from "@/lib/log-redact";

describe("lib/log-redact", () => {
  it("masks emails in a***@d***.tld style", () => {
    expect(maskEmail("alice@domain.com")).toBe("a***@d***.com");
    expect(maskEmail("bob.smith@sub.example.co.in")).toBe("b***@s***.in");
    expect(maskEmail("invalid")).toBe("***");
    expect(maskEmail(null)).toBe("***");
    expect(maskEmail("")).toBe("***");
  });

  it("masks phone numbers to last 2 digits only", () => {
    expect(maskPhone("+919876543210")).toBe("***10");
    expect(maskPhone("9876543210")).toBe("***10");
    expect(maskPhone("1")).toBe("***");
    expect(maskPhone(undefined)).toBe("***");
  });

  it("summarizes errors with name/code only and never leaks message text", () => {
    const errWithCode = Object.assign(new Error("secret@email.com +919876543210"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    const summary1 = safeErrorSummary(errWithCode);
    expect(summary1).toBe("PrismaClientKnownRequestError(P2002)");
    expect(summary1).not.toContain("secret@email.com");
    expect(summary1).not.toContain("9876543210");

    const plainErr = new TypeError("contains sensitive token xyz123");
    const summary2 = safeErrorSummary(plainErr);
    expect(summary2).toBe("TypeError");
    expect(summary2).not.toContain("xyz123");

    expect(safeErrorSummary("raw string secret")).toBe("UnknownError");
  });
});
