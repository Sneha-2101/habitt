export function normalizeColor(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateImageColor(
  color: string | null | undefined,
  variantColors: ReadonlyArray<string>
): string | null {
  const norm = normalizeColor(color);
  if (!norm) return null;

  for (const vc of variantColors) {
    if (normalizeColor(vc) === norm && vc.trim().length > 0) {
      return vc.trim();
    }
  }

  throw new Error(`Invalid image color "${color?.trim()}". Must match one of the product's variant colors.`);
}

export function imagesForColor<T extends { color?: string | null; position?: number }>(
  images: ReadonlyArray<T>,
  selectedColor?: string | null
): T[] {
  const sorted = images
    .map((img, idx) => ({ img, idx }))
    .sort((a, b) => (a.img.position ?? 0) - (b.img.position ?? 0) || a.idx - b.idx)
    .map((x) => x.img);

  const normSelected = normalizeColor(selectedColor);
  if (normSelected) {
    const tagged = sorted.filter((img) => normalizeColor(img.color) === normSelected);
    if (tagged.length > 0) return tagged;
  }

  const untagged = sorted.filter((img) => !normalizeColor(img.color));
  if (untagged.length > 0) return untagged;

  return sorted;
}
