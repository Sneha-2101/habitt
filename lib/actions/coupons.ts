"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";

export async function validateCoupon(code: string, subtotal: number) {
  if (!code?.trim()) {
    throw new Error("Please enter a coupon code.");
  }

  try {
    const reqHeaders = await headers();
    const ip = getClientIp(reqHeaders);
    const rl = await limit("couponCheck", ip);
    if (!rl.ok) {
      throw new Error("Too many coupon checks. Please wait a minute before trying again.");
    }
  } catch (e: any) {
    if (e?.message?.includes("Too many coupon checks")) {
      throw e;
    }
    // Headers might not be available in non-request contexts
  }

  const normalizedCode = code.trim().toUpperCase();

  // Find active coupon
  const coupon = await prisma.coupon.findUnique({
    where: { code: normalizedCode },
  });

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
