"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { colorInputSchema, skuSchema } from "@/lib/catalog/variants";
import { Prisma } from "@prisma/client";

export async function nameDefaultColorAction(
  productId: string,
  name: string,
  hex?: string | null
): Promise<{ success: boolean }> {
  const staff = await requireStaff();
  const parsed = colorInputSchema.parse({ name, hex });

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    if (product.variants.length === 0) {
      throw new Error("Product has no variants to name");
    }

    const hasNonEmptyColor = product.variants.some((v) => v.color !== "");
    if (hasNonEmptyColor) {
      throw new Error("Default color can only be named when all variants have no color");
    }

    const beforeVariants = product.variants.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      colorHex: v.colorHex,
    }));

    await tx.productVariant.updateMany({
      where: { productId },
      data: {
        color: parsed.name,
        colorHex: parsed.hex,
      },
    });

    return {
      product,
      beforeVariants,
      afterColor: parsed.name,
      afterHex: parsed.hex,
    };
  });

  await writeAudit({
    actorId: staff.id,
    action: "variant.color.name",
    entity: "Product",
    entityId: productId,
    meta: {
      before: { variants: result.beforeVariants },
      after: { color: result.afterColor, colorHex: result.afterHex },
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/shop");
  if (result.product.slug) {
    revalidatePath(`/product/${result.product.slug}`);
  }

  return { success: true };
}

export async function addColorAction(
  productId: string,
  name: string,
  hex?: string | null,
  stock?: number
): Promise<{ success: boolean }> {
  const staff = await requireStaff();
  const parsed = colorInputSchema.parse({ name, hex });
  const stockNum = typeof stock === "number" ? Math.max(0, Math.floor(stock)) : 0;

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    if (product.variants.some((v) => v.color === "")) {
      throw new Error("Name the default color first");
    }

    const duplicate = product.variants.some(
      (v) => v.color.trim().toLowerCase() === parsed.name.trim().toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Color "${parsed.name}" is duplicate for this product`);
    }

    const distinctSizes = Array.from(new Set(product.variants.map((v) => v.size)));
    if (distinctSizes.length === 0) {
      throw new Error("Product has no sizes defined");
    }

    await tx.productVariant.createMany({
      data: distinctSizes.map((size) => ({
        productId,
        size,
        color: parsed.name,
        colorHex: parsed.hex,
        stock: stockNum,
      })),
    });

    return {
      product,
      distinctSizes,
    };
  });

  await writeAudit({
    actorId: staff.id,
    action: "variant.color.add",
    entity: "Product",
    entityId: productId,
    meta: {
      before: null,
      after: {
        color: parsed.name,
        colorHex: parsed.hex,
        sizes: result.distinctSizes,
        stock: stockNum,
      },
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/shop");
  if (result.product.slug) {
    revalidatePath(`/product/${result.product.slug}`);
  }

  return { success: true };
}

export async function renameColorAction(
  productId: string,
  oldColor: string,
  newName: string,
  hex?: string | null
): Promise<{ success: boolean }> {
  const staff = await requireStaff();
  const parsed = colorInputSchema.parse({ name: newName, hex });

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    const existingColorVariants = product.variants.filter((v) => v.color === oldColor);
    if (existingColorVariants.length === 0) {
      throw new Error(`Color "${oldColor}" not found on product`);
    }

    const duplicate = product.variants.some(
      (v) =>
        v.color !== oldColor &&
        v.color.trim().toLowerCase() === parsed.name.trim().toLowerCase()
    );
    if (duplicate) {
      throw new Error(`Color "${parsed.name}" is duplicate for this product`);
    }

    await tx.productVariant.updateMany({
      where: { productId, color: oldColor },
      data: {
        color: parsed.name,
        colorHex: parsed.hex,
      },
    });

    return { product };
  });

  await writeAudit({
    actorId: staff.id,
    action: "variant.color.rename",
    entity: "Product",
    entityId: productId,
    meta: {
      before: { color: oldColor },
      after: { color: parsed.name, colorHex: parsed.hex },
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/shop");
  if (result.product.slug) {
    revalidatePath(`/product/${result.product.slug}`);
  }

  return { success: true };
}

export async function removeColorAction(
  productId: string,
  color: string
): Promise<{ success: boolean }> {
  const staff = await requireStaff();

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    const distinctColors = Array.from(new Set(product.variants.map((v) => v.color)));
    if (distinctColors.length <= 1) {
      throw new Error("Cannot remove the product's only color");
    }

    const colorVariants = product.variants.filter((v) => v.color === color);
    if (colorVariants.length === 0) {
      throw new Error(`Color "${color}" not found on product`);
    }

    const variantIds = colorVariants.map((v) => v.id);

    const orderedItem = await tx.orderItem.findFirst({
      where: { variantId: { in: variantIds } },
    });
    if (orderedItem) {
      throw new Error("Cannot remove color because it is referenced by existing orders");
    }

    // Delete relation records where cascade is not defined or required
    await tx.stockNotification.deleteMany({
      where: { variantId: { in: variantIds } },
    });

    await tx.cartItem.deleteMany({
      where: { variantId: { in: variantIds } },
    });

    await tx.productVariant.deleteMany({
      where: { id: { in: variantIds } },
    });

    return { product, deletedCount: variantIds.length };
  });

  await writeAudit({
    actorId: staff.id,
    action: "variant.color.remove",
    entity: "Product",
    entityId: productId,
    meta: {
      before: { color, count: result.deletedCount },
      after: null,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/shop");
  if (result.product.slug) {
    revalidatePath(`/product/${result.product.slug}`);
  }

  return { success: true };
}

export async function setVariantSkuAction(
  variantId: string,
  sku: string | null | undefined
): Promise<{ success: boolean; sku: string | null }> {
  const staff = await requireStaff();
  const parsedSku = skuSchema.parse(sku);

  let updatedVariant;
  try {
    updatedVariant = await prisma.$transaction(async (tx) => {
      const current = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: true },
      });

      if (!current) {
        throw new Error("Variant not found");
      }

      if (parsedSku !== null) {
        const existing = await tx.productVariant.findFirst({
          where: {
            sku: parsedSku,
            id: { not: variantId },
          },
        });
        if (existing) {
          throw new Error(`SKU "${parsedSku}" is taken by another variant`);
        }
      }

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { sku: parsedSku },
        include: { product: true },
      });

      return {
        updated,
        beforeSku: current.sku,
      };
    });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error(`SKU "${parsedSku}" is taken by another variant`);
    }
    throw err;
  }

  await writeAudit({
    actorId: staff.id,
    action: "variant.sku.set",
    entity: "ProductVariant",
    entityId: variantId,
    meta: {
      before: { sku: updatedVariant.beforeSku },
      after: { sku: parsedSku },
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${updatedVariant.updated.productId}/edit`);
  revalidatePath("/shop");
  if (updatedVariant.updated.product?.slug) {
    revalidatePath(`/product/${updatedVariant.updated.product.slug}`);
  }

  return { success: true, sku: parsedSku };
}

export async function addMissingSizeVariantsAction(
  productId: string
): Promise<{ success: boolean; createdCount: number }> {
  const staff = await requireStaff();

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        variants: true,
      },
    });

    if (!product) {
      throw new Error("Product not found");
    }

    if (!product.category) {
      throw new Error("Product does not belong to a category");
    }

    const categorySizes = product.category.sizes || [];
    if (categorySizes.length === 0) {
      return { createdCount: 0 };
    }

    const colorMap = new Map<string, string | null>();
    if (product.variants.length === 0) {
      colorMap.set("", null);
    } else {
      for (const v of product.variants) {
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
      for (const sz of categorySizes) {
        const szLower = sz.toLowerCase();
        const exists = product.variants.some(
          (v) => (v.color || "").toLowerCase() === cLower && v.size.toLowerCase() === szLower
        );
        if (!exists) {
          toCreate.push({
            productId: product.id,
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
    }

    return { createdCount: toCreate.length };
  });

  await writeAudit({
    actorId: staff.id,
    action: "variant.add_missing_sizes",
    entity: "Product",
    entityId: productId,
    meta: {
      createdCount: result.createdCount,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/shop");

  return { success: true, createdCount: result.createdCount };
}

export interface GenerateSkusParams {
  scope?: "product" | "category" | "all";
  scopeId?: string;
  preview?: boolean;
}

export interface SkuCandidate {
  variantId: string;
  productId: string;
  productName: string;
  color: string;
  size: string;
  currentSku: string | null;
  proposedSku: string;
}

export interface GenerateSkusResult {
  preview: boolean;
  totalMissing: number;
  assignedCount: number;
  candidates: SkuCandidate[];
}

export async function generateMissingSkusAction(
  params?: GenerateSkusParams
): Promise<GenerateSkusResult> {
  const staff = await requireStaff();
  const scope = params?.scope || "all";
  const scopeId = params?.scopeId?.trim();
  const preview = !!params?.preview;

  if ((scope === "product" || scope === "category") && !scopeId) {
    throw new Error(`scopeId required for scope ${scope}`);
  }

  const whereClause: Prisma.ProductVariantWhereInput = {
    OR: [{ sku: null }, { sku: "" }],
  };

  if (scope === "product" && scopeId) {
    whereClause.productId = scopeId;
  } else if (scope === "category" && scopeId) {
    whereClause.product = { categoryId: scopeId };
  }

  const missingVariants = await prisma.productVariant.findMany({
    where: whereClause,
    include: { product: true },
    orderBy: [{ productId: "asc" }, { size: "asc" }],
  });

  if (missingVariants.length === 0) {
    return {
      preview,
      totalMissing: 0,
      assignedCount: 0,
      candidates: [],
    };
  }

  // Find all existing SKUs to avoid collision
  const existingVariants = await prisma.productVariant.findMany({
    where: { sku: { not: null } },
    select: { sku: true },
  });

  const usedSet = new Set<string>();
  for (const ev of existingVariants) {
    if (ev.sku) {
      usedSet.add(ev.sku.trim().toUpperCase());
    }
  }

  const candidates: SkuCandidate[] = [];

  for (const mv of missingVariants) {
    const rawCode = (mv.product.slug || mv.product.name)
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 8);
    const prodCode = rawCode || "PROD";

    const rawColor = (mv.color || "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 3);
    const color3 = rawColor || "DEF";

    const rawSize = mv.size.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const sizeStr = rawSize || "STD";

    const baseSku = `${prodCode}-${color3}-${sizeStr}`;
    let proposedSku = baseSku;
    let collisionIndex = 2;

    while (usedSet.has(proposedSku)) {
      proposedSku = `${baseSku}-${collisionIndex}`;
      collisionIndex += 1;
    }

    usedSet.add(proposedSku);

    candidates.push({
      variantId: mv.id,
      productId: mv.productId,
      productName: mv.product.name,
      color: mv.color || "",
      size: mv.size,
      currentSku: mv.sku,
      proposedSku,
    });
  }

  if (!preview && candidates.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        for (const cand of candidates) {
          await tx.productVariant.update({
            where: { id: cand.variantId },
            data: { sku: cand.proposedSku },
          });
        }
      },
      { timeout: 60000, maxWait: 10000 }
    );

    await writeAudit({
      actorId: staff.id,
      action: "variant.generate_skus",
      entity: "ProductVariant",
      entityId: "bulk",
      meta: {
        count: candidates.length,
        scope,
        scopeId: params?.scopeId,
      },
    });

    try {
      revalidatePath("/admin/products");
      revalidatePath("/shop");
    } catch {
      // Handled outside Next.js request context (e.g. tests)
    }
  }

  return {
    preview,
    totalMissing: candidates.length,
    assignedCount: preview ? 0 : candidates.length,
    candidates,
  };
}

