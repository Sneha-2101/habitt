import { describe, it, expect } from "vitest";
import { validateImageBuffer } from "@/lib/uploads/image-check";
import { isValidCtaHref } from "@/lib/content/content";

describe("validateImageBuffer", () => {
  it("accepts valid JPEG, PNG, and WEBP magic bytes", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(validateImageBuffer(jpeg)).toEqual({ mimeType: "image/jpeg", ext: "jpg" });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(validateImageBuffer(png)).toEqual({ mimeType: "image/png", ext: "png" });

    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8 ", "ascii"),
    ]);
    expect(validateImageBuffer(webp)).toEqual({ mimeType: "image/webp", ext: "webp" });
  });

  it("rejects empty buffers, oversized buffers (>5MB), and SVG/HTML/GIF", () => {
    expect(() => validateImageBuffer(Buffer.alloc(0))).toThrow();
    expect(() => validateImageBuffer(Buffer.alloc(5 * 1024 * 1024 + 1, 0xff))).toThrow();

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
    expect(() => validateImageBuffer(svg)).toThrow();

    const html = Buffer.from("<html><body>hi</body></html>", "utf8");
    expect(() => validateImageBuffer(html)).toThrow();

    const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "ascii");
    expect(() => validateImageBuffer(gif)).toThrow();
  });
});

describe("isValidCtaHref", () => {
  it("allows root, single-slash relative paths, and https URLs", () => {
    expect(isValidCtaHref("/")).toBe(true);
    expect(isValidCtaHref("/shop")).toBe(true);
    expect(isValidCtaHref("/products/tea?sort=new")).toBe(true);
    expect(isValidCtaHref("https://example.com/sale")).toBe(true);
  });

  it("rejects protocol-relative, backslash, whitespace, control chars, and non-https schemes", () => {
    expect(isValidCtaHref("")).toBe(false);
    expect(isValidCtaHref("//evil.com")).toBe(false);
    expect(isValidCtaHref("\\evil.com")).toBe(false);
    expect(isValidCtaHref("/\\evil.com")).toBe(false);
    expect(isValidCtaHref("/shop\t")).toBe(false);
    expect(isValidCtaHref("/shop\n")).toBe(false);
    expect(isValidCtaHref("/shop\x00")).toBe(false);
    expect(isValidCtaHref("javascript:alert(1)")).toBe(false);
    expect(isValidCtaHref("http://example.com")).toBe(false);
  });
});
