"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ProductStatus, Prisma, Product } from "@prisma/client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaff } from "@/lib/guards";
import { sendBackInStockEmail } from "@/lib/email";
import { writeAudit } from "@/lib/audit";
import { productMerchandiseFields, toProductFieldData } from "@/lib/catalog/product-fields";
import { validateImageBuffer } from "@/lib/uploads/image-check";
import { validateImageColor } from "@/lib/catalog/image-color";
import { planSlugChange } from "@/lib/seo/slug-redirects";
import { z } from "zod";

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "product";
  let slug = base;
  let existing = await prisma.product.findUnique({ where: { slug } });
  while (existing) {
    const suffix = Math.random().toString(36).substring(2, 6);
    slug = `${base}-${suffix}`;
    existing = await prisma.product.findUnique({ where: { slug } });
  }
  return slug;
}

function getStoragePathFromUrl(url: string, bucket: string): string | null {
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) {
    return decodeURIComponent(url.substring(idx + marker.length));
  }
  return null;
}

const createProductSchema = z
  .object({
    name: z.string().trim().min(1, "Product name is required"),
    categoryId: z.string().min(1, "Product category is required"),
    price: z.number().positive("Price must be greater than 0"),
    stock: z.number().int("Stock must be an integer").min(0, "Stock cannot be negative").default(0),
    description: z.string().default(""),
    ...productMerchandiseFields,
  })
  .superRefine((data, ctx) => {
    if (
      data.compareAtRupees !== null &&
      data.compareAtRupees !== undefined &&
      data.compareAtRupees <= data.price
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compareAtRupees"],
        message: "Compare-at price must be greater than price",
      });
    }
  });

const updateProductSchema = z
  .object({
    name: z.string().trim().min(1, "Product name is required"),
    slug: z.string().trim().min(1, "Slug cannot be empty").max(160).optional(),
    categoryId: z.string().min(1, "Product category is required"),
    price: z.number().positive("Price must be greater than 0"),
    description: z.string().default(""),
    status: z.nativeEnum(ProductStatus, { errorMap: () => ({ message: "Invalid product status" }) }),
    ...productMerchandiseFields,
  })
  .superRefine((data, ctx) => {
    if (
      data.compareAtRupees !== null &&
      data.compareAtRupees !== undefined &&
      data.compareAtRupees <= data.price
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compareAtRupees"],
        message: "Compare-at price must be greater than price",
      });
    }
  });

const updateVariantStockSchema = z.object({
  variantId: z.string().min(1, "Variant ID is required"),
  stock: z.number().int("Stock must be an integer").min(0, "Stock cannot be negative"),
});

async function uploadFileToSupabase(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { mimeType, ext } = validateImageBuffer(buffer);

  const supabase = getSupabaseAdmin();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${ext}`;
  const filePath = `products/${fileName}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error("Supabase storage upload error:", error);
    throw new Error("Failed to upload image.");
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(filePath);
  return data.publicUrl;
}

export async function createProduct(formData: FormData) {
  const user = await requireStaff();

  const rawPrice = formData.get("price");
  const priceNum = rawPrice !== null && rawPrice !== "" ? Number(rawPrice) : NaN;
  const rawStock = formData.get("stock");
  const stockNum = rawStock !== null && rawStock !== "" ? Number(rawStock) : 0;

  const rawCost =
    user.role === "OWNER"
      ? (formData.get("costRupees") ?? formData.get("cost"))
      : undefined;

  let validated: z.infer<typeof createProductSchema>;
  try {
    validated = createProductSchema.parse({
      name: formData.get("name") as string,
      categoryId: (formData.get("categoryId") || formData.get("category")) as string,
      price: priceNum,
      stock: stockNum,
      description: (formData.get("description") as string) || "",
      compareAtRupees: formData.get("compareAtRupees") ?? formData.get("compareAt"),
      costRupees: rawCost,
      hsn: formData.get("hsn"),
      fabric: formData.get("fabric"),
      fit: formData.get("fit"),
      care: formData.get("care"),
      sizeChartUrl: formData.get("sizeChartUrl"),
      seoTitle: formData.get("seoTitle"),
      seoDescription: formData.get("seoDescription"),
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const msg = err.errors.map((e) => e.message).join(", ");
      throw new Error(msg || "Invalid product data");
    }
    throw err;
  }

  const category = await prisma.category.findUnique({
    where: { id: validated.categoryId },
  });
  if (!category) {
    throw new Error("Category not found");
  }

  const pricePaise = Math.round(validated.price * 100); // rupees -> paise
  const slug = await generateUniqueSlug(validated.name);

  const fieldData = toProductFieldData(validated, {
    includeCost: user.role === "OWNER",
  });

  const productData: Prisma.ProductUncheckedCreateInput = {
    name: validated.name,
    slug,
    description: validated.description,
    categoryId: validated.categoryId,
    price: pricePaise,
    status: "DRAFT",
    compareAtPrice: fieldData.compareAtPrice,
    hsn: fieldData.hsn,
    fabric: fieldData.fabric,
    fit: fieldData.fit,
    care: fieldData.care,
    sizeChartUrl: fieldData.sizeChartUrl,
    seoTitle: fieldData.seoTitle,
    seoDescription: fieldData.seoDescription,
    variants: {
      create: category.sizes.map((size) => ({ size, stock: validated.stock })),
    },
  };
  if (user.role === "OWNER" && fieldData.costPrice !== undefined) {
    productData.costPrice = fieldData.costPrice;
  }
  if (formData.has("publishAt")) {
    const rawPublishAt = formData.get("publishAt");
    if (typeof rawPublishAt === "string" && rawPublishAt.trim() !== "") {
      const parsedDate = new Date(rawPublishAt.trim());
      productData.publishAt = isNaN(parsedDate.getTime()) ? null : parsedDate;
    }
  }

  const product = await prisma.product.create({
    data: productData,
    ...(user.role === "OWNER" ? { omit: { costPrice: false } } : {}),
  });

  // Audit log product.create
  await writeAudit({
    actorId: user.id,
    action: "product.create",
    entity: "Product",
    entityId: product.id,
    meta: {
      before: null,
      after: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        price: product.price,
        categoryId: product.categoryId,
        compareAtPrice: product.compareAtPrice,
        ...(user.role === "OWNER"
          ? {
              costPrice:
                "costPrice" in product && typeof (product as Product).costPrice === "number"
                  ? (product as Product).costPrice
                  : null,
            }
          : {}),
        hsn: product.hsn,
        fabric: product.fabric,
        fit: product.fit,
        care: product.care,
        sizeChartUrl: product.sizeChartUrl,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
      },
    },
  });

  // Process uploaded images if attached
  const imageFiles = formData.getAll("images") as File[];
  let position = 0;
  for (const file of imageFiles) {
    if (file && file.size > 0) {
      try {
        const publicUrl = await uploadFileToSupabase(file);
        await prisma.productImage.create({
          data: {
            productId: product.id,
            url: publicUrl,
            position: position++,
          },
        });
      } catch (err) {
        console.error("Failed image upload:", err);
      }
    }
  }

  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${product.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed/google");
  revalidatePath("/admin/products");
  redirect(`/admin/products/${product.id}/edit`);
}

export async function updateProduct(productId: string, formData: FormData) {
  const user = await requireStaff();

  const rawPrice = formData.get("price");
  const priceNum = rawPrice !== null && rawPrice !== "" ? Number(rawPrice) : NaN;

  const hasCompareAt = formData.has("compareAtRupees") || formData.has("compareAt");
  const rawCompareAt = hasCompareAt
    ? (formData.get("compareAtRupees") ?? formData.get("compareAt"))
    : undefined;

  const hasCost = formData.has("costRupees") || formData.has("cost");
  const rawCost =
    user.role === "OWNER" && hasCost
      ? (formData.get("costRupees") ?? formData.get("cost"))
      : undefined;

  let validated: z.infer<typeof updateProductSchema>;
  try {
    const rawSlug = formData.has("slug") ? String(formData.get("slug") ?? "").trim() : undefined;
    const normalizedSlug = rawSlug !== undefined ? slugify(rawSlug) : undefined;
    if (rawSlug !== undefined && !normalizedSlug) {
      throw new Error("Slug must contain letters or numbers");
    }
    validated = updateProductSchema.parse({
      name: formData.get("name") as string,
      ...(normalizedSlug !== undefined ? { slug: normalizedSlug } : {}),
      categoryId: (formData.get("categoryId") || formData.get("category")) as string,
      price: priceNum,
      description: (formData.get("description") as string) || "",
      status: formData.get("status"),
      compareAtRupees: rawCompareAt,
      costRupees: rawCost,
      hsn: formData.has("hsn") ? formData.get("hsn") : undefined,
      fabric: formData.has("fabric") ? formData.get("fabric") : undefined,
      fit: formData.has("fit") ? formData.get("fit") : undefined,
      care: formData.has("care") ? formData.get("care") : undefined,
      sizeChartUrl: formData.has("sizeChartUrl") ? formData.get("sizeChartUrl") : undefined,
      seoTitle: formData.has("seoTitle") ? formData.get("seoTitle") : undefined,
      seoDescription: formData.has("seoDescription") ? formData.get("seoDescription") : undefined,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const msg = err.errors.map((e) => e.message).join(", ");
      throw new Error(msg || "Invalid product data");
    }
    throw err;
  }

  const pricePaise = Math.round(validated.price * 100);

  const { updatedProduct, beforeSnapshot, oldSlug } = await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({
      where: { id: productId },
      include: { variants: true },
      ...(user.role === "OWNER" ? { omit: { costPrice: false } } : {}),
    });
    if (!current) throw new Error("Product not found");

    if (current.categoryId !== validated.categoryId) {
      const newCategory = await tx.category.findUnique({
        where: { id: validated.categoryId },
      });
      if (!newCategory) throw new Error("New category not found");

      const newSizesSet = new Set(newCategory.sizes.map((s) => s.toLowerCase()));
      const unsupportedVariant = current.variants.find(
        (v) => !newSizesSet.has(v.size.toLowerCase())
      );
      if (unsupportedVariant) {
        throw new Error(
          `Cannot change category: variant size "${unsupportedVariant.size}" is not supported by category "${newCategory.name}"`
        );
      }
    }

    // Effective compareAtPrice: newly submitted (if provided in form) or stored
    const effectiveCompareAt =
      hasCompareAt && validated.compareAtRupees !== undefined
        ? (validated.compareAtRupees !== null ? Math.round(validated.compareAtRupees * 100) : null)
        : current.compareAtPrice;

    if (
      effectiveCompareAt !== null &&
      effectiveCompareAt !== undefined &&
      pricePaise >= effectiveCompareAt
    ) {
      throw new Error("Price cannot be greater than or equal to compare-at price");
    }

    const fieldData = toProductFieldData(validated, {
      includeCost: user.role === "OWNER",
    });

    const updateData: Prisma.ProductUncheckedUpdateInput = {
      name: validated.name,
      categoryId: validated.categoryId,
      price: pricePaise,
      description: validated.description,
      status: validated.status,
    };

    if (validated.slug && validated.slug !== current.slug) {
      const slugInUse = await tx.product.findFirst({
        where: { slug: validated.slug, id: { not: productId } },
        select: { id: true },
      });
      if (slugInUse) {
        throw new Error("Slug is in use by another product.");
      }

      const existingRedirects = await tx.productSlugRedirect.findMany({
        where: { oldSlug: { in: [current.slug, validated.slug] } },
        select: { id: true, oldSlug: true, productId: true },
      });

      const plan = planSlugChange({
        productId,
        oldSlug: current.slug,
        newSlug: validated.slug,
        existingRedirects,
      });
      if (!plan.ok) {
        throw new Error(plan.reason);
      }

      if (plan.deleteRedirectIds.length > 0) {
        await tx.productSlugRedirect.deleteMany({
          where: { id: { in: plan.deleteRedirectIds } },
        });
      }
      if (plan.createRedirect) {
        await tx.productSlugRedirect.create({
          data: { oldSlug: current.slug, productId },
        });
      }
      updateData.slug = validated.slug;
    }

    if (hasCompareAt) {
      updateData.compareAtPrice = fieldData.compareAtPrice ?? null;
    }
    if (formData.has("publishAt")) {
      const rawPublishAt = formData.get("publishAt");
      if (typeof rawPublishAt === "string" && rawPublishAt.trim() !== "") {
        const parsedDate = new Date(rawPublishAt.trim());
        updateData.publishAt = isNaN(parsedDate.getTime()) ? null : parsedDate;
      } else {
        updateData.publishAt = null;
      }
    }
    if (formData.has("hsn")) updateData.hsn = fieldData.hsn ?? null;
    if (formData.has("fabric")) updateData.fabric = fieldData.fabric ?? null;
    if (formData.has("fit")) updateData.fit = fieldData.fit ?? null;
    if (formData.has("care")) updateData.care = fieldData.care ?? null;
    if (formData.has("sizeChartUrl")) updateData.sizeChartUrl = fieldData.sizeChartUrl ?? null;
    if (formData.has("seoTitle")) updateData.seoTitle = fieldData.seoTitle ?? null;
    if (formData.has("seoDescription")) updateData.seoDescription = fieldData.seoDescription ?? null;

    if (user.role === "OWNER" && hasCost && fieldData.costPrice !== undefined) {
      updateData.costPrice = fieldData.costPrice;
    }

    const before = {
      name: current.name,
      slug: current.slug,
      price: current.price,
      categoryId: current.categoryId,
      compareAtPrice: current.compareAtPrice,
      publishAt: current.publishAt,
      ...(user.role === "OWNER"
        ? {
            costPrice:
              "costPrice" in current && typeof (current as Product).costPrice === "number"
                ? (current as Product).costPrice
                : null,
          }
        : {}),
      hsn: current.hsn,
      fabric: current.fabric,
      fit: current.fit,
      care: current.care,
      sizeChartUrl: current.sizeChartUrl,
      seoTitle: current.seoTitle,
      seoDescription: current.seoDescription,
    };

    const updated = await tx.product.update({
      where: { id: productId },
      data: updateData,
      ...(user.role === "OWNER" ? { omit: { costPrice: false } } : {}),
    });

    if (formData.has("hasCollections")) {
      const collectionIds = formData.getAll("collectionIds").map(String).filter(Boolean);
      await tx.productCollection.deleteMany({ where: { productId } });
      if (collectionIds.length > 0) {
        await tx.productCollection.createMany({
          data: collectionIds.map((cId) => ({ productId, collectionId: cId })),
        });
      }
    }

    return { updatedProduct: updated, beforeSnapshot: before, oldSlug: current.slug };
  });

  await writeAudit({
    actorId: user.id,
    action: "product.update",
    entity: "Product",
    entityId: productId,
    meta: {
      before: beforeSnapshot as Prisma.InputJsonObject,
      after: {
        name: updatedProduct.name,
        slug: updatedProduct.slug,
        price: updatedProduct.price,
        categoryId: updatedProduct.categoryId,
        compareAtPrice: updatedProduct.compareAtPrice,
        publishAt: updatedProduct.publishAt,
        ...(user.role === "OWNER"
          ? {
              costPrice:
                "costPrice" in updatedProduct && typeof updatedProduct.costPrice === "number"
                  ? updatedProduct.costPrice
                  : null,
            }
          : {}),
        hsn: updatedProduct.hsn,
        fabric: updatedProduct.fabric,
        fit: updatedProduct.fit,
        care: updatedProduct.care,
        sizeChartUrl: updatedProduct.sizeChartUrl,
        seoTitle: updatedProduct.seoTitle,
        seoDescription: updatedProduct.seoDescription,
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${updatedProduct.slug}`);
  if (oldSlug !== updatedProduct.slug) {
    revalidatePath(`/product/${oldSlug}`);
  }
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed/google");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
}

export async function addProductImage(productId: string, formData: FormData) {
  await requireStaff();

  const file = formData.get("image") as File;
  if (!file || file.size === 0) return;

  const rawAlt = formData.get("altText");
  const altText =
    typeof rawAlt === "string" && rawAlt.trim().length > 0
      ? rawAlt.trim().slice(0, 200)
      : null;

  const rawColor = formData.get("color");
  const variantRows = await prisma.productVariant.findMany({
    where: { productId },
    select: { color: true },
  });
  const color = validateImageColor(
    typeof rawColor === "string" ? rawColor : null,
    variantRows.map((v) => v.color)
  );

  try {
    const publicUrl = await uploadFileToSupabase(file);
    const existingCount = await prisma.productImage.count({ where: { productId } });

    await prisma.productImage.create({
      data: {
        productId,
        url: publicUrl,
        altText,
        color,
        position: existingCount,
      },
    });
  } catch (err) {
    console.error("Failed image upload on product edit:", err);
    throw new Error("Failed to upload image.");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });
  if (product) revalidatePath(`/product/${product.slug}`);
  revalidatePath("/shop");
  revalidatePath("/");
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/products");
}

export async function updateProductImageAlt(
  imageId: string,
  productId: string,
  altText: string
) {
  const staff = await requireStaff();
  const normalized = altText.trim().slice(0, 200) || null;

  const updated = await prisma.productImage.update({
    where: { id: imageId },
    data: { altText: normalized },
    include: { product: { select: { slug: true } } },
  });

  await writeAudit({
    actorId: staff.id,
    action: "product_image.alt_update",
    entity: "ProductImage",
    entityId: imageId,
    meta: { productId, altLength: normalized?.length ?? 0 },
  });

  revalidatePath(`/product/${updated.product.slug}`);
  revalidatePath("/shop");
  revalidatePath("/");
  revalidatePath(`/admin/products/${productId}/edit`);
}

export async function updateProductImageColor(
  imageId: string,
  productId: string,
  color: string | null
) {
  const staff = await requireStaff();
  const variantRows = await prisma.productVariant.findMany({
    where: { productId },
    select: { color: true },
  });
  const canonicalColor = validateImageColor(
    color,
    variantRows.map((v) => v.color)
  );

  const updated = await prisma.productImage.update({
    where: { id: imageId },
    data: { color: canonicalColor },
    include: { product: { select: { slug: true } } },
  });

  await writeAudit({
    actorId: staff.id,
    action: "product_image.color_update",
    entity: "ProductImage",
    entityId: imageId,
    meta: { productId, color: canonicalColor },
  });

  revalidatePath(`/product/${updated.product.slug}`);
  revalidatePath("/shop");
  revalidatePath("/");
  revalidatePath("/feed/google");
  revalidatePath(`/admin/products/${productId}/edit`);
}

export async function deleteProductImage(imageId: string, productId: string) {
  await requireStaff();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });

  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (image) {
    const storagePath = getStoragePathFromUrl(image.url, "product-images");
    if (storagePath) {
      try {
        const supabase = getSupabaseAdmin();
        await supabase.storage.from("product-images").remove([storagePath]);
      } catch (err) {
        console.error("Failed to delete image from Supabase storage:", err);
      }
    }
    await prisma.productImage.delete({ where: { id: imageId } });
  }

  if (product) {
    revalidatePath(`/product/${product.slug}`);
    revalidatePath("/shop");
    revalidatePath("/");
  }
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/products");
}

export async function updateVariantStock(variantId: string, stock: number) {
  const staff = await requireStaff();

  const validated = updateVariantStockSchema.parse({ variantId, stock });

  const current = await prisma.productVariant.findUnique({
    where: { id: validated.variantId },
    select: { stock: true },
  });

  const delta = validated.stock - (current?.stock ?? 0);

  const variant = await prisma.$transaction(async (tx) => {
    const updated = await tx.productVariant.update({
      where: { id: validated.variantId },
      data: { stock: validated.stock },
      include: { product: true },
    });

    if (delta !== 0) {
      await tx.stockMovement.create({
        data: {
          variantId: validated.variantId,
          delta,
          reason: "MANUAL_ADJUST",
          refType: "ADMIN_STOCK_EDIT",
          actorId: staff.id,
        },
      });
    }

    return updated;
  });

  if (validated.stock > 0) {
    // Notify subscribers
    const pendingNotifications = await prisma.stockNotification.findMany({
      where: { variantId: validated.variantId, notified: false },
    });

    for (const notif of pendingNotifications) {
      const sizeLabel = variant.color ? `${variant.size} · ${variant.color}` : variant.size;
      sendBackInStockEmail(notif.email, variant.product.name, variant.product.slug, sizeLabel).catch((err) => {
        console.error(`Failed to send back-in-stock email to ${notif.email}:`, err);
      });
      await prisma.stockNotification.update({
        where: { id: notif.id },
        data: { notified: true },
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${variant.product.slug}`);
  revalidatePath("/feed/google");
  revalidatePath("/admin/products");
}

export async function archiveProduct(productId: string) {
  await requireStaff();

  // Soft-delete only — see Schema.md note on preserving order history.
  const archived = await prisma.product.update({
    where: { id: productId },
    data: { status: "ARCHIVED" },
    select: { slug: true },
  });
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath(`/product/${archived.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/feed/google");
  revalidatePath("/admin/products");
}
