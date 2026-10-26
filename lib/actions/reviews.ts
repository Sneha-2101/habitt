"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function submitReview(productId: string, rating: number, comment: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in to submit a review.");
  }

  const userId = session.user.id;

  if (rating < 1 || rating > 5) {
    throw new Error("Rating must be between 1 and 5.");
  }

  if (!comment || comment.trim().length === 0) {
    throw new Error("Please provide a review comment.");
  }

  // Check if user already reviewed this product
  const existingReview = await prisma.review.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (existingReview) {
    throw new Error("You have already reviewed this product.");
  }

  // Verify purchase history
  const purchasedItem = await prisma.orderItem.findFirst({
    where: {
      productId,
      order: {
        userId,
        status: { in: ["PAID", "SHIPPED", "DELIVERED"] },
      },
    },
  });

  if (!purchasedItem) {
    throw new Error("You can only review products you have purchased.");
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });

  await prisma.review.create({
    data: {
      productId,
      userId,
      rating,
      comment: comment.trim(),
    },
  });

  if (product?.slug) {
    revalidatePath(`/product/${product.slug}`);
  }
}

export async function getReviewsForProduct(productId: string) {
  return prisma.review.findMany({
    where: { productId },
    include: {
      user: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAverageRating(productId: string) {
  const aggregate = await prisma.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return {
    average: aggregate._avg.rating ? Number(aggregate._avg.rating.toFixed(1)) : 0,
    count: aggregate._count.rating || 0,
  };
}
