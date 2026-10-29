"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { sendNewsletterWelcomeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";

const emailSchema = z.string().email("Please enter a valid email address.");

export async function subscribeNewsletter(email: string): Promise<{ success: boolean }> {
  const parseResult = emailSchema.safeParse(email?.trim());
  if (!parseResult.success) {
    throw new Error("Please enter a valid email address.");
  }
  const normalizedEmail = parseResult.data.toLowerCase();

  let ip = "unknown";
  try {
    const reqHeaders = await headers();
    ip = getClientIp(reqHeaders);
  } catch {
    // direct call outside request context (e.g. unit testing)
  }

  // Rate limit: newsletterIp (3 per hour)
  const ipLimit = await limit("newsletterIp", ip);
  if (!ipLimit.ok) {
    throw new Error("Too many subscription requests from this IP. Please try again later.");
  }

  // Rate limit: newsletterEmail (1 per day)
  const emailLimit = await limit("newsletterEmail", normalizedEmail);
  if (!emailLimit.ok) {
    throw new Error("Too many requests for this email address. Please try again later.");
  }

  const existing = await prisma.newsletterSubscriber.findUnique({
    where: { email: normalizedEmail },
  });

  await prisma.newsletterSubscriber.upsert({
    where: { email: normalizedEmail },
    update: { consentedAt: new Date() },
    create: {
      email: normalizedEmail,
      consentedAt: new Date(),
      source: "website",
    },
  });

  if (existing) {
    return { success: true };
  }

  const settings = await getSettings();
  const welcomePercent = settings.welcomeCouponPercent ?? 10;
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const code = `WELCOME-${randomSuffix}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const coupon = await prisma.coupon.create({
    data: {
      code,
      discountType: "PERCENT",
      value: welcomePercent,
      usageLimit: 1,
      expiresAt,
    },
  });

  await sendNewsletterWelcomeEmail(normalizedEmail, coupon.code);

  return { success: true };
}
