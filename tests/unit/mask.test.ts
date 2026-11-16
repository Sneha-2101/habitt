import { describe, it, expect } from "vitest";
import { maskIdentifier } from "@/lib/mask";

describe("maskIdentifier unit tests", () => {
  it("masks emails correctly", () => {
    expect(maskIdentifier("a@example.com")).toBe("*@example.com");
    expect(maskIdentifier("aarav@habitt.test")).toBe("a***@habitt.test");
    expect(maskIdentifier("customer@domain.co.in")).toBe("c***@domain.co.in");
  });

  it("masks +91 phone numbers showing only last 4 digits", () => {
    expect(maskIdentifier("+919876543210")).toBe("+91******3210");
  });

  it("masks general numbers / strings > 4 chars", () => {
    expect(maskIdentifier("9876543210")).toBe("******3210");
  });

  it("masks short identifiers <= 4 chars", () => {
    expect(maskIdentifier("1234")).toBe("****");
    expect(maskIdentifier("abc")).toBe("****");
  });
});

