import { z } from "zod";
import { sortSizes } from "@/lib/catalog/categories";

export const colorInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Color name is required")
    .max(30, "Color name must be 30 characters or fewer")
    .refine((s) => !/[\x00-\x1F\x7F]/.test(s), "Color name cannot contain control characters")
    .refine((s) => !s.includes("|"), "Color name cannot contain '|'"),
  hex: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => {
      if (!v || v === "") return null;
      return v.toUpperCase();
    })
    .refine((v) => v === null || /^#[0-9A-F]{6}$/.test(v), {
      message: "Hex must be in #RRGGBB format",
    }),
});

export const skuSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v || v === "") return null;
    return v.toUpperCase();
  })
  .refine(
    (v) => {
      if (v === null) return true;
      return v.length >= 3 && v.length <= 40 && /^[A-Z0-9][A-Z0-9._-]*$/.test(v);
    },
    {
      message:
        "SKU must be 3-40 alphanumeric characters (allowing ., _, -), starting with an alphanumeric character",
    }
  );

export interface VariantInput {
  id: string;
  size: string;
  color: string;
  colorHex?: string | null;
  stock: number;
}

export interface GroupedColor {
  color: string;
  colorHex: string | null;
  inStock: boolean;
  sizes: Array<{
    id: string;
    size: string;
    stock: number;
  }>;
}

export interface GroupedVariantsResult {
  colors: GroupedColor[];
  hasColors: boolean;
}

export interface DefaultVariantSelection {
  color: string;
  size: string;
  id: string;
  variantId: string;
  stock: number;
}

export function groupVariants(
  variants: VariantInput[],
  categorySizes: string[] = []
): GroupedVariantsResult {
  const hasColors = variants.some((v) => v.color && v.color.trim() !== "");

  // Colors in first-appearance order
  const colorMap = new Map<string, { colorHex: string | null; sizes: Array<{ id: string; size: string; stock: number }> }>();

  for (const v of variants) {
    const cName = v.color || "";
    if (!colorMap.has(cName)) {
      colorMap.set(cName, {
        colorHex: v.colorHex || null,
        sizes: [],
      });
    }
    const entry = colorMap.get(cName)!;
    if (!entry.colorHex && v.colorHex) {
      entry.colorHex = v.colorHex;
    }
    entry.sizes.push({
      id: v.id,
      size: v.size,
      stock: v.stock,
    });
  }

  const colors: GroupedColor[] = [];

  for (const [colorName, data] of colorMap.entries()) {
    const orderedSizeNames = sortSizes(
      data.sizes.map((s) => s.size),
      categorySizes
    );
    const sizeRank = new Map(orderedSizeNames.map((sz, idx) => [sz, idx]));

    const sortedSizes = [...data.sizes].sort(
      (a, b) => (sizeRank.get(a.size) ?? 999) - (sizeRank.get(b.size) ?? 999)
    );

    const inStock = sortedSizes.some((s) => s.stock > 0);

    colors.push({
      color: colorName,
      colorHex: data.colorHex,
      inStock,
      sizes: sortedSizes,
    });
  }

  return {
    colors,
    hasColors,
  };
}

export function pickDefaultVariant(
  grouped: GroupedVariantsResult
): DefaultVariantSelection | null {
  if (!grouped.colors || grouped.colors.length === 0) {
    return null;
  }

  // First color that has any stock, falls back to first color
  const chosenColor = grouped.colors.find((c) => c.inStock) || grouped.colors[0];
  if (!chosenColor || chosenColor.sizes.length === 0) {
    return null;
  }

  // First in-stock size of that color, falls back to first size
  const chosenSize = chosenColor.sizes.find((s) => s.stock > 0) || chosenColor.sizes[0];

  return {
    color: chosenColor.color,
    size: chosenSize.size,
    id: chosenSize.id,
    variantId: chosenSize.id,
    stock: chosenSize.stock,
  };
}
