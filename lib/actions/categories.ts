"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { categoryInputSchema } from "@/lib/catalog/categories";
import { revalidatePath } from "next/cache";

const updateCategorySchema = categoryInputSchema.omit({ slug: true });

function parseCategoryInput(input: unknown): Record<string, unknown> {
  if (input instanceof FormData) {
    const rawSizes = input.get("sizes");
    let sizes: string[] = [];
    if (typeof rawSizes === "string") {
      sizes = rawSizes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const rawPos = input.get("position");
    const rawActive = input.get("active");
    return {
      slug: (input.get("slug") as string)?.trim(),
      name: (input.get("name") as string)?.trim(),
      sizes,
      position: rawPos !== null && rawPos !== "" ? Number(rawPos) : 0,
      active: rawActive !== null ? rawActive === "true" || rawActive === "on" : true,
    };
  }
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    let sizes = obj.sizes;
    if (typeof sizes === "string") {
      sizes = sizes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return {
      ...obj,
      sizes,
    };
  }
  return {};
}

export async function createCategoryAction(input: unknown) {
  const user = await requireStaff();
  const parsed = categoryInputSchema.parse(parseCategoryInput(input));

  const category = await prisma.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({
      where: { slug: parsed.slug },
    });
    if (existing) {
      throw new Error(`Category slug "${parsed.slug}" is duplicate`);
    }

    return tx.category.create({
      data: {
        slug: parsed.slug,
        name: parsed.name,
        position: parsed.position,
        sizes: parsed.sizes,
        active: parsed.active,
      },
    });
  });

  await writeAudit({
    actorId: user.id,
    action: "category.create",
    entity: "Category",
    entityId: category.id,
    meta: { before: null, after: category },
  });

  revalidatePath("/shop");
  revalidatePath("/admin/categories");

  return { success: true, category };
}

export async function updateCategoryAction(id: string, input: unknown) {
  const user = await requireStaff();
  const rawData = parseCategoryInput(input);
  const validated = updateCategorySchema.parse(rawData);

  const { before, after } = await prisma.$transaction(async (tx) => {
    const current = await tx.category.findUnique({
      where: { id },
    });
    if (!current) {
      throw new Error("Category not found");
    }

    // Rule: removing a size from sizes is rejected if any ProductVariant of a product in this category still has that size
    const newSizesSet = new Set(validated.sizes.map((s) => s.toLowerCase()));
    const removedSizes = current.sizes.filter((s) => !newSizesSet.has(s.toLowerCase()));

    if (removedSizes.length > 0) {
      const inUseVariant = await tx.productVariant.findFirst({
        where: {
          product: { categoryId: id },
          size: { in: removedSizes },
        },
        select: { size: true, product: { select: { name: true } } },
      });

      if (inUseVariant) {
        throw new Error(
          `Cannot remove size "${inUseVariant.size}" because it is currently used by product "${inUseVariant.product.name}"`
        );
      }
    }

    const updated = await tx.category.update({
      where: { id },
      data: {
        name: validated.name,
        position: validated.position,
        sizes: validated.sizes,
        active: validated.active,
      },
    });

    return { before: current, after: updated };
  });

  await writeAudit({
    actorId: user.id,
    action: "category.update",
    entity: "Category",
    entityId: id,
    meta: { before, after },
  });

  revalidatePath("/shop");
  revalidatePath("/admin/categories");

  return { success: true, category: after };
}

export async function deleteCategoryAction(id: string) {
  const user = await requireStaff();

  const current = await prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
    });
    if (!category) {
      throw new Error("Category not found");
    }

    // Rule: deleting a category is rejected if any product references it
    const productCount = await tx.product.count({
      where: { categoryId: id },
    });
    if (productCount > 0) {
      throw new Error(`Cannot delete category because ${productCount} product(s) reference it`);
    }

    await tx.category.delete({
      where: { id },
    });

    return category;
  });

  await writeAudit({
    actorId: user.id,
    action: "category.delete",
    entity: "Category",
    entityId: id,
    meta: { before: current, after: null },
  });

  revalidatePath("/shop");
  revalidatePath("/admin/categories");

  return { success: true };
}

const renameSizeSchema = z.object({
  categoryId: z.string().min(1, "Category ID is required"),
  from: z
    .string()
    .trim()
    .min(1, "Current size cannot be empty")
    .max(12, "Size cannot exceed 12 characters")
    .refine((s) => !s.includes(","), "Size cannot contain commas"),
  to: z
    .string()
    .trim()
    .min(1, "New size cannot be empty")
    .max(12, "Size cannot exceed 12 characters")
    .refine((s) => !s.includes(","), "Size cannot contain commas"),
});

export async function renameCategorySizeAction(
  categoryId: string,
  from: string,
  to: string
): Promise<{ success: boolean; renamedVariantsCount: number; affectedProductsCount: number }> {
  const user = await requireStaff();
  const parsed = renameSizeSchema.parse({ categoryId, from, to });

  const result = await prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: parsed.categoryId },
    });
    if (!category) {
      throw new Error("Category not found");
    }

    const fromLower = parsed.from.toLowerCase();
    const toLower = parsed.to.toLowerCase();

    const fromIndex = category.sizes.findIndex((s) => s.toLowerCase() === fromLower);
    if (fromIndex === -1) {
      throw new Error(`Size "${parsed.from}" not found in category "${category.name}"`);
    }

    if (fromLower !== toLower) {
      const alreadyHasTo = category.sizes.some((s) => s.toLowerCase() === toLower);
      if (alreadyHasTo) {
        throw new Error(`Category "${category.name}" already contains size "${parsed.to}"`);
      }
    }

    // Update Category.sizes preserving order
    const updatedSizes = category.sizes.map((s, idx) => (idx === fromIndex ? parsed.to : s));

    // Load all products in this category with their variants
    const products = await tx.product.findMany({
      where: { categoryId: parsed.categoryId },
      include: { variants: true },
    });

    const collisions: string[] = [];
    const variantIdsToUpdate: string[] = [];
    const affectedProductIds = new Set<string>();

    for (const prod of products) {
      const fromVariants = prod.variants.filter((v) => v.size.toLowerCase() === fromLower);
      if (fromVariants.length === 0) continue;

      for (const fv of fromVariants) {
        const fColor = (fv.color || "").toLowerCase();
        // Check if prod already has a variant with size `to` and same color
        const collides = prod.variants.some(
          (other) =>
            other.id !== fv.id &&
            other.size.toLowerCase() === toLower &&
            (other.color || "").toLowerCase() === fColor
        );
        if (collides) {
          collisions.push(`${prod.name} (${prod.slug})`);
          break;
        }
      }

      if (collisions.length === 0) {
        for (const fv of fromVariants) {
          variantIdsToUpdate.push(fv.id);
          affectedProductIds.add(prod.id);
        }
      }
    }

    if (collisions.length > 0) {
      throw new Error(
        `Cannot rename size "${parsed.from}" to "${parsed.to}": collision with existing variants in products: ${Array.from(new Set(collisions)).join(", ")}`
      );
    }

    // 1. Update Category sizes
    await tx.category.update({
      where: { id: parsed.categoryId },
      data: { sizes: updatedSizes },
    });

    // 2. Update ProductVariant.size for all matching variants
    if (variantIdsToUpdate.length > 0) {
      await tx.productVariant.updateMany({
        where: { id: { in: variantIdsToUpdate } },
        data: { size: parsed.to },
      });
    }

    return {
      renamedVariantsCount: variantIdsToUpdate.length,
      affectedProductsCount: affectedProductIds.size,
    };
  });

  await writeAudit({
    actorId: user.id,
    action: "category.rename_size",
    entity: "Category",
    entityId: parsed.categoryId,
    meta: {
      from: parsed.from,
      to: parsed.to,
      renamedVariantsCount: result.renamedVariantsCount,
      affectedProductsCount: result.affectedProductsCount,
    },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");
  revalidatePath("/shop");

  return { success: true, ...result };
}

export async function addMissingVariantsForCategoryAction(
  categoryId: string
): Promise<{ success: boolean; createdCount: number; affectedProductsCount: number }> {
  const user = await requireStaff();

  const result = await prisma.$transaction(async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      include: { products: { include: { variants: true } } },
    });
    if (!category) {
      throw new Error("Category not found");
    }

    let createdTotal = 0;
    let affectedProds = 0;

    for (const prod of category.products) {
      const colorMap = new Map<string, string | null>();
      if (prod.variants.length === 0) {
        colorMap.set("", null);
      } else {
        for (const v of prod.variants) {
          const c = v.color || "";
          if (!colorMap.has(c)) {
            colorMap.set(c, v.colorHex ?? null);
          }
        }
      }

      const toCreate: {
        productId: string;
        size: string;
        color: string;
        colorHex: string | null;
        stock: number;
      }[] = [];

      for (const [colorName, colorHex] of colorMap.entries()) {
        const cLower = colorName.toLowerCase();
        for (const sz of category.sizes) {
          const szLower = sz.toLowerCase();
          const exists = prod.variants.some(
            (v) => (v.color || "").toLowerCase() === cLower && v.size.toLowerCase() === szLower
          );
          if (!exists) {
            toCreate.push({
              productId: prod.id,
              size: sz,
              color: colorName,
              colorHex,
              stock: 0,
            });
          }
        }
      }

      if (toCreate.length > 0) {
        await tx.productVariant.createMany({
          data: toCreate,
        });
        createdTotal += toCreate.length;
        affectedProds++;
      }
    }

    return { createdCount: createdTotal, affectedProductsCount: affectedProds };
  });

  await writeAudit({
    actorId: user.id,
    action: "category.add_missing_variants",
    entity: "Category",
    entityId: categoryId,
    meta: {
      createdCount: result.createdCount,
      affectedProductsCount: result.affectedProductsCount,
    },
  });

  revalidatePath("/admin/categories");
  revalidatePath("/admin/products");

  return { success: true, ...result };
}
