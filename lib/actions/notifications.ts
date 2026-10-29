"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";

const emailSchema = z.string().email("Please enter a valid email address.");

export async function requestStockNotification(
  email: string,
  productId: string,
  variantId: string
) {
  const parsed = emailSchema.safeParse(email?.trim());
  if (!parsed.success) {
    throw new Error("Please enter a valid email address.");
  }
  const normalizedEmail = parsed.data.toLowerCase();

  // Rate limit: stockNotifyIp (10 per hour)
  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const rl = await limit("stockNotifyIp", ip);
    if (!rl.ok) {
      throw new Error("Too many stock notification requests. Please try again later.");
    }
  } catch (err: any) {
    if (err?.message?.includes("Too many stock notification requests")) {
      throw err;
    }
  }

  // Variant must exist, belong to product, and product must be ACTIVE
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: true },
  });

  if (!product || product.status !== "ACTIVE") {
    throw new Error("Product is no longer available.");
  }

  const variant = product.variants.find((v) => v.id === variantId);
  if (!variant) {
    throw new Error("Product variant is no longer available.");
  }

  // At most 5 open requests per email
  const openCount = await prisma.stockNotification.count({
    where: {
      email: normalizedEmail,
      notified: false,
    },
  });

  if (openCount >= 5) {
    throw new Error("Maximum of 5 open stock notification requests allowed per email.");
  }

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
