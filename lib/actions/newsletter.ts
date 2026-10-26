"use server";

import { sendNewsletterWelcomeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

export async function subscribeNewsletter(email: string) {
  if (!email || !email.includes("@")) {
    throw new Error("Please enter a valid email address.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const settings = await getSettings();
  const welcomeCode = settings.welcomeCouponCode;
  const welcomePercent = settings.welcomeCouponPercent;

  // Ensure welcome coupon exists
  let coupon = await prisma.coupon.findUnique({
    where: { code: welcomeCode },
  });

  if (!coupon) {
    coupon = await prisma.coupon.create({
      data: {
        code: welcomeCode,
        discountType: "PERCENT",
        value: welcomePercent,
      },
    });
  }

  // Send welcome email with coupon code
  await sendNewsletterWelcomeEmail(normalizedEmail, coupon.code);

  return { success: true, code: coupon.code };
}
