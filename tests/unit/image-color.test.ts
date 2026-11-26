import { describe, it, expect } from "vitest";
import { normalizeColor, validateImageColor, imagesForColor } from "@/lib/catalog/image-color";

describe("catalog/image-color", () => {
  it("normalizeColor trims, collapses whitespace, and lowercases", () => {
    expect(normalizeColor("  Forest   Green ")).toBe("forest green");
    expect(normalizeColor(null)).toBe("");
    expect(normalizeColor("")).toBe("");
  });

  it("validateImageColor returns canonical variant color, null for blank, and throws for unknown", () => {
    const colors = ["Forest Green", "Ivory"];
    expect(validateImageColor("  forest  green ", colors)).toBe("Forest Green");
    expect(validateImageColor("   ", colors)).toBeNull();
    expect(validateImageColor(null, colors)).toBeNull();
    expect(() => validateImageColor("Crimson", colors)).toThrow("Invalid image color");
  });

  it("imagesForColor returns tagged images, falls back to untagged, then all, preserving position order", () => {
    const imgs = [
      { id: "1", color: "Ivory", position: 2 },
      { id: "2", color: null, position: 1 },
      { id: "3", color: "Forest Green", position: 0 },
      { id: "4", color: "Ivory", position: 0 },
    ];

    expect(imagesForColor(imgs, "ivory").map((i) => i.id)).toEqual(["4", "1"]);
    expect(imagesForColor(imgs, "Navy").map((i) => i.id)).toEqual(["2"]);

    const onlyTagged = [
      { id: "a", color: "Ivory", position: 1 },
      { id: "b", color: "Navy", position: 0 },
    ];
    expect(imagesForColor(onlyTagged, "Charcoal").map((i) => i.id)).toEqual(["b", "a"]);
  });
});
