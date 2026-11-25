import { describe, it, expect } from "vitest";
import { renderContentBlocks, MAX_CONTENT_LENGTH } from "@/lib/content/render";

describe("content-render", () => {
  it("parses headings, paragraphs with line breaks, and bullet lists", () => {
    const input = [
      "## Our Craft",
      "",
      "Line one of paragraph.",
      "Line two of paragraph.",
      "",
      "- Heavyweight cotton",
      "- Reinforced seams",
      "",
      "Final paragraph.",
    ].join("\n");

    const blocks = renderContentBlocks(input);
    expect(blocks).toEqual([
      { type: "h2", text: "Our Craft" },
      { type: "p", lines: ["Line one of paragraph.", "Line two of paragraph."] },
      { type: "ul", items: ["Heavyweight cotton", "Reinforced seams"] },
      { type: "p", lines: ["Final paragraph."] },
    ]);
  });

  it("keeps raw HTML such as <script> as literal text without parsing or executing", () => {
    const input = "## <script>alert(1)</script>\n\nHello <img src=x onerror=alert(1)> world\n\n- <b>bold</b>";
    const blocks = renderContentBlocks(input);
    expect(blocks).toEqual([
      { type: "h2", text: "<script>alert(1)</script>" },
      { type: "p", lines: ["Hello <img src=x onerror=alert(1)> world"] },
      { type: "ul", items: ["<b>bold</b>"] },
    ]);
  });

  it("enforces maximum length cap (20000 chars)", () => {
    const valid = "a".repeat(MAX_CONTENT_LENGTH);
    expect(() => renderContentBlocks(valid)).not.toThrow();

    const tooLong = "a".repeat(MAX_CONTENT_LENGTH + 1);
    expect(() => renderContentBlocks(tooLong)).toThrow(/exceeds maximum length/);
  });
});
