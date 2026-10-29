"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { formatReviewerName } from "@/lib/reviews";

export async function submitReview(productId: string, rating: number, comment: string) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("You must be signed in to submit a review.");
  }

  const userId = session.user.id;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be an integer between 1 and 5.");
  }

  const trimmedComment = (comment || "").trim();
  if (trimmedComment.length < 10 || trimmedComment.length > 1000) {
    throw new Error("Review comment must be between 10 and 1000 characters.");
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
      comment: trimmedComment,
    },
  });

  if (product?.slug) {
    revalidatePath(`/product/${product.slug}`);
  }
}

export async function getReviewsForProduct(productId: string) {
  const reviews = await prisma.review.findMany({
    where: { productId },
    select: {
      id: true,
      productId: true,
      rating: true,
      comment: true,
      createdAt: true,
      user: {
        select: { name: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return reviews.map((r) => ({
    id: r.id,
    productId: r.productId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    user: {
      name: formatReviewerName(r.user?.name),
    },
  }));
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
