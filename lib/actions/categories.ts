"use server";

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
