"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Category, Size } from "@prisma/client";
import { getSupabaseAdmin } from "@/lib/supabase";

const SIZES: Size[] = ["S", "M", "L", "XL", "XXL"];

function slugify(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

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
  const name = (formData.get("name") as string || "").trim();
  const category = formData.get("category") as Category;
  const rawPrice = formData.get("price");
  const priceNum = Number(rawPrice);

  if (!name) {
    throw new Error("Product name is required");
  }

  if (rawPrice === null || rawPrice === "" || isNaN(priceNum) || priceNum <= 0) {
    throw new Error("Please enter a valid product price");
  }

  const price = Math.round(priceNum * 100); // rupees -> paise
  const description = (formData.get("description") as string) || "";
  const stockPerSize = Number(formData.get("stock")) || 0;

  const product = await prisma.product.create({
    data: {
      name,
      slug: slugify(name) + "-" + Math.floor(Math.random() * 1000),
      description,
      category,
      price,
      status: "DRAFT",
      variants: { create: SIZES.map((size) => ({ size, stock: stockPerSize })) },
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
  const name = (formData.get("name") as string || "").trim();
  const category = formData.get("category") as Category;
  const rawPrice = formData.get("price");
  const priceNum = Number(rawPrice);

  if (!name) {
    throw new Error("Product name is required");
  }

  if (rawPrice === null || rawPrice === "" || isNaN(priceNum) || priceNum <= 0) {
    throw new Error("Please enter a valid product price");
  }

  const price = Math.round(priceNum * 100);
  const description = (formData.get("description") as string) || "";
  const status = formData.get("status") as "DRAFT" | "ACTIVE" | "ARCHIVED";

  await prisma.product.update({
    where: { id: productId },
    data: { name, category, price, description, status },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productId}/edit`);
}

export async function addProductImage(productId: string, formData: FormData) {
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
  await prisma.productImage.delete({ where: { id: imageId } });
  revalidatePath(`/admin/products/${productId}/edit`);
  revalidatePath("/admin/products");
}

export async function updateVariantStock(variantId: string, stock: number) {
  await prisma.productVariant.update({ where: { id: variantId }, data: { stock } });
  revalidatePath("/admin/products");
}

export async function archiveProduct(productId: string) {
  // Soft-delete only — see Schema.md note on preserving order history.
  await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
  revalidatePath("/admin/products");
}
