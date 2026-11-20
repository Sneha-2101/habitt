"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";

export const collectionInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(64, "Slug cannot exceed 64 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with optional single hyphens"),
  name: z.string().trim().min(1, "Name is required").max(100, "Name cannot exceed 100 characters"),
  position: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});

export const updateCollectionSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(64, "Slug cannot exceed 64 characters")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with optional single hyphens")
    .optional(),
  name: z.string().trim().min(1, "Name is required").max(100, "Name cannot exceed 100 characters").optional(),
  position: z.coerce.number().int().optional(),
  active: z.boolean().optional(),
});

export async function createCollection(input: unknown) {
  const staff = await requireStaff();
  const parsed = collectionInputSchema.parse(input);

  const existing = await prisma.collection.findUnique({
    where: { slug: parsed.slug },
  });
  if (existing) {
    throw new Error(`Collection slug "${parsed.slug}" is duplicate`);
  }

  const collection = await prisma.collection.create({
    data: {
      slug: parsed.slug,
      name: parsed.name,
      position: parsed.position,
      active: parsed.active,
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "collection.create",
    entity: "Collection",
    entityId: collection.id,
    meta: { after: collection },
  });

  revalidatePath("/admin/collections");
  revalidatePath("/shop");

  return { success: true, collection };
}

export async function updateCollection(id: string, input: unknown) {
  const staff = await requireStaff();
  const parsed = updateCollectionSchema.parse(input);

  const existing = await prisma.collection.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new Error(`Collection with ID "${id}" does not exist`);
  }

  if (parsed.slug && parsed.slug !== existing.slug) {
    const slugConflict = await prisma.collection.findUnique({
      where: { slug: parsed.slug },
    });
    if (slugConflict) {
      throw new Error(`Collection slug "${parsed.slug}" is duplicate`);
    }
  }

  const updated = await prisma.collection.update({
    where: { id },
    data: {
      ...(parsed.slug ? { slug: parsed.slug } : {}),
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.position !== undefined ? { position: parsed.position } : {}),
      ...(parsed.active !== undefined ? { active: parsed.active } : {}),
    },
  });

  await writeAudit({
    actorId: staff.id,
    action: "collection.update",
    entity: "Collection",
    entityId: id,
    meta: { before: existing, after: updated },
  });

  revalidatePath("/admin/collections");
  revalidatePath("/shop");

  return { success: true, collection: updated };
}

export async function setCollectionActive(id: string, active: boolean) {
  return updateCollection(id, { active });
}

export async function setCollectionPosition(id: string, position: number) {
  return updateCollection(id, { position });
}

export async function deleteCollection(id: string) {
  const staff = await requireStaff();

  const existing = await prisma.collection.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new Error(`Collection with ID "${id}" does not exist`);
  }

  // Refuse if any OfferTarget uses it
  const offerTargetCount = await prisma.offerTarget.count({
    where: { collectionId: id },
  });
  if (offerTargetCount > 0) {
    throw new Error(
      "Cannot delete collection because it is targeted by one or more offers. Remove the targets first."
    );
  }

  await prisma.collection.delete({
    where: { id },
  });

  await writeAudit({
    actorId: staff.id,
    action: "collection.delete",
    entity: "Collection",
    entityId: id,
    meta: { before: existing },
  });

  revalidatePath("/admin/collections");
  revalidatePath("/shop");

  return { success: true };
}

export async function setProductCollections(productId: string, collectionIds: string[]) {
  const staff = await requireStaff();

  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new Error(`Product with ID "${productId}" does not exist`);
    }

    if (collectionIds.length > 0) {
      const validCollections = await tx.collection.findMany({
        where: { id: { in: collectionIds } },
        select: { id: true },
      });
      if (validCollections.length !== collectionIds.length) {
        throw new Error("One or more specified collection IDs do not exist");
      }
    }

    await tx.productCollection.deleteMany({
      where: { productId },
    });

    if (collectionIds.length > 0) {
      await tx.productCollection.createMany({
        data: collectionIds.map((cId) => ({
          productId,
          collectionId: cId,
        })),
      });
    }
  });

  await writeAudit({
    actorId: staff.id,
    action: "product.setCollections",
    entity: "Product",
    entityId: productId,
    meta: { collectionIds },
  });

  revalidatePath("/admin/products");
  revalidatePath("/admin/collections");
  revalidatePath("/shop");

  return { success: true };
}

export async function setCollectionProducts(collectionId: string, productIds: string[]) {
  const staff = await requireStaff();

  await prisma.$transaction(async (tx) => {
    const collection = await tx.collection.findUnique({
      where: { id: collectionId },
    });
    if (!collection) {
      throw new Error(`Collection with ID "${collectionId}" does not exist`);
    }

    if (productIds.length > 0) {
      const validProducts = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (validProducts.length !== productIds.length) {
        throw new Error("One or more specified product IDs do not exist");
      }
    }

    await tx.productCollection.deleteMany({
      where: { collectionId },
    });

    if (productIds.length > 0) {
      await tx.productCollection.createMany({
        data: productIds.map((pId) => ({
          productId: pId,
          collectionId,
        })),
      });
    }
  });

  await writeAudit({
    actorId: staff.id,
    action: "collection.setProducts",
    entity: "Collection",
    entityId: collectionId,
    meta: { productIds },
  });

  revalidatePath("/admin/collections");
  revalidatePath("/admin/products");
  revalidatePath("/shop");

  return { success: true };
}
