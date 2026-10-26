"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function toggleWishlist(productId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) {
    throw new Error("Unauthorized: Please sign in to save items to your Wantlist.");
  }

  const existing = await prisma.wishlistItem.findUnique({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
  });

  if (existing) {
    await prisma.wishlistItem.delete({
      where: { id: existing.id },
    });
    revalidatePath("/wantlist");
    revalidatePath("/shop");
    revalidatePath("/");
    return { saved: false };
  } else {
    await prisma.wishlistItem.create({
      data: {
        userId,
        productId,
      },
    });
    revalidatePath("/wantlist");
    revalidatePath("/shop");
    revalidatePath("/");
    return { saved: true };
  }
}

export async function getWishlistProductIds(): Promise<string[]> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  if (!userId) return [];

  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    select: { productId: true },
  });

  return items.map((i) => i.productId);
}
