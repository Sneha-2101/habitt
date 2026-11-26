import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const categoryInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be between 2 and 40 characters")
    .max(40, "Slug must be between 2 and 40 characters")
    .regex(/^[a-z0-9-]+$/, "Slug must only contain lowercase letters, numbers, and hyphens"),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer"),
  sizes: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Size cannot be empty")
        .max(12, "Size cannot exceed 12 characters")
        .refine((s) => !s.includes(","), "Size cannot contain commas")
    )
    .min(1, "At least one size is required")
    .max(15, "Cannot have more than 15 sizes")
    .refine((arr) => {
      const lower = arr.map((s) => s.toLowerCase());
      return new Set(lower).size === lower.length;
    }, "Sizes must be unique (case-insensitive)"),
  position: z
    .number()
    .int("Position must be an integer")
    .min(0, "Position must be between 0 and 999")
    .max(999, "Position must be between 0 and 999")
    .default(0),
  active: z.boolean().default(true),
  seoTitle: z
    .string()
    .trim()
    .max(70, "SEO title must be 70 characters or fewer")
    .nullish()
    .transform((v) => v || null),
  seoDescription: z
    .string()
    .trim()
    .max(160, "SEO description must be 160 characters or fewer")
    .nullish()
    .transform((v) => v || null),
  introText: z
    .string()
    .trim()
    .max(2000, "Intro text must be 2000 characters or fewer")
    .nullish()
    .transform((v) => v || null),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

export function sortSizes(variantSizes: string[], categorySizes: string[]): string[] {
  const catOrderMap = new Map<string, number>();
  categorySizes.forEach((sz, idx) => {
    catOrderMap.set(sz, idx);
  });

  const known: string[] = [];
  const unknown: string[] = [];

  for (const s of variantSizes) {
    if (catOrderMap.has(s)) {
      known.push(s);
    } else {
      unknown.push(s);
    }
  }

  // Sort known by category order
  known.sort((a, b) => (catOrderMap.get(a) ?? 0) - (catOrderMap.get(b) ?? 0));
  // Sort unknown alphabetically
  unknown.sort((a, b) => a.localeCompare(b));

  return [...known, ...unknown];
}

export function isSizeAllowed(size: string, categorySizes: string[]): boolean {
  return categorySizes.includes(size);
}

export async function getPickerCategories() {
  return prisma.category.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
  });
}
