"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Category, ProductStatus, Size } from "@prisma/client";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireStaff } from "@/lib/guards";
import { sendBackInStockEmail } from "@/lib/email";
import { z } from "zod";

const SIZES: Size[] = ["S", "M", "L", "XL", "XXL"];

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

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.nativeEnum(Category, { errorMap: () => ({ message: "Invalid product category" }) }),
  price: z.number().positive("Price must be greater than 0"),
  stock: z.number().int("Stock must be an integer").min(0, "Stock cannot be negative").default(0),
  description: z.string().default(""),
});

const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required"),
  category: z.nativeEnum(Category, { errorMap: () => ({ message: "Invalid product category" }) }),
  price: z.number().positive("Price must be greater than 0"),
  description: z.string().default(""),
  status: z.nativeEnum(ProductStatus, { errorMap: () => ({ message: "Invalid product status" }) }),
});

const updateVariantStockSchema = z.object({
  variantId: z.string().min(1, "Variant ID is required"),
  stock: z.number().int("Stock must be an integer").min(0, "Stock cannot be negative"),
});

async function uploadFileToSupabase(file: File): Promise<string> {
  const supabase = getSupabaseAdmin();
  const fileExt = file.name.split(".").pop() || "jpg";
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
  const filePath = `products/${fileName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, buffer, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });

  if (error) {
    console.error("Supabase storage upload error:", error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(filePath);
  return data.publicUrl;
}

export async function createProduct(formData: FormData) {
  await requireStaff();

  const rawPrice = formData.get("price");
  const priceNum = rawPrice !== null && rawPrice !== "" ? Number(rawPrice) : NaN;
  const rawStock = formData.get("stock");
  const stockNum = rawStock !== null && rawStock !== "" ? Number(rawStock) : 0;

  const validated = createProductSchema.parse({
    name: formData.get("name") as string,
    category: formData.get("category"),
    price: priceNum,
    stock: stockNum,
    description: (formData.get("description") as string) || "",
  });

  const pricePaise = Math.round(validated.price * 100); // rupees -> paise
  const slug = await generateUniqueSlug(validated.name);

  const product = await prisma.product.create({
    data: {
      name: validated.name,
      slug,
      description: validated.description,
      category: validated.category,
      price: pricePaise,
      status: "DRAFT",
      variants: { create: SIZES.map((size) => ({ size, stock: validated.stock })) },
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

  revalidatePath("/admin/products");
  redirect(`/admin/products/${product.id}/edit`);
}

export async function updateProduct(productId: string, formData: FormData) {
  await requireStaff();

  const rawPrice = formData.get("price");
  const priceNum = rawPrice !== null && rawPrice !== "" ? Number(rawPrice) : NaN;

  const validated = updateProductSchema.parse({
    name: formData.get("name") as string,
    category: formData.get("category"),
    price: priceNum,
    description: (formData.get("description") as string) || "",
    status: formData.get("status"),
  });

  const pricePaise = Math.round(validated.price * 100);

  await prisma.product.update({
    where: { id: productId },
    data: {
      name: validated.name,
      category: validated.category,
      price: pricePaise,
      description: validated.description,
      status: validated.status,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
}

export async function addProductImage(productId: string, formData: FormData) {
  await requireStaff();

  const file = formData.get("image") as File;
  if (!file || file.size === 0) return;

  try {
    const publicUrl = await uploadFileToSupabase(file);
    const existingCount = await prisma.productImage.count({ where: { productId } });

    await prisma.productImage.create({
      data: {
        productId,
        url: publicUrl,
        position: existingCount,
      },
    });
  } catch (err) {
    console.error("Failed image upload on product edit:", err);
    throw new Error(err instanceof Error ? err.message : "Failed to upload image");
  }

  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/products");
}

export async function deleteProductImage(imageId: string, productId: string) {
  await requireStaff();

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
      sendBackInStockEmail(notif.email, variant.product.name, variant.product.slug, variant.size).catch((err) => {
        console.error(`Failed to send back-in-stock email to ${notif.email}:`, err);
      });
      await prisma.stockNotification.update({
        where: { id: notif.id },
        data: { notified: true },
      });
    }
  }

  revalidatePath("/admin/products");
}

export async function archiveProduct(productId: string) {
  await requireStaff();

  // Soft-delete only — see Schema.md note on preserving order history.
  await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
  revalidatePath("/admin/products");
}
