"use server";

import { prisma } from "@/lib/prisma";

export async function validateCoupon(code: string, subtotal: number) {
  if (!code?.trim()) {
    throw new Error("Please enter a coupon code.");
  }

  const normalizedCode = code.trim().toUpperCase();

  // Find active coupon
  let coupon = await prisma.coupon.findUnique({
    where: { code: normalizedCode },
  });

  // Default auto-creation for WELCOME10 if first time
  if (!coupon && normalizedCode === "WELCOME10") {
    coupon = await prisma.coupon.create({
      data: {
        code: "WELCOME10",
        discountType: "PERCENT",
        value: 10, // 10% off
      },
    });
  }

  if (!coupon) {
    throw new Error("Invalid coupon code.");
  }

  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    throw new Error("This coupon code has expired.");
  }

  if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
    throw new Error("This coupon usage limit has been reached.");
  }

  let discountAmount = 0;
  if (coupon.discountType === "PERCENT") {
    discountAmount = Math.round((subtotal * coupon.value) / 100);
  } else {
    discountAmount = Math.min(coupon.value, subtotal);
  }

  return {
    valid: true,
    code: coupon.code,
    discountType: coupon.discountType,
    value: coupon.value,
    discountAmount,
  };
}
