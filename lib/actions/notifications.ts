"use server";

import { prisma } from "@/lib/prisma";

export async function requestStockNotification(email: string, productId: string, variantId: string) {
  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const notification = await prisma.stockNotification.upsert({
      where: {
        email_variantId: { email: normalizedEmail, variantId },
      },
      update: { notified: false },
      create: {
        email: normalizedEmail,
        productId,
        variantId,
        notified: false,
      },
    });
    return notification;
  } catch (err) {
    console.error("Error creating stock notification:", err);
    throw new Error("Could not save notification request.");
  }
}
