"use server";

import crypto from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getClientIp } from "@/lib/client-ip";
import { limit } from "@/lib/ratelimit";
import { enqueueOutbox } from "@/lib/outbox/enqueue";

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

  const settings = await getSettings();
  const welcomePercent = settings.welcomeCouponPercent ?? 10;
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const code = `WELCOME-${randomSuffix}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const created = await tx.newsletterSubscriber.createMany({
      data: [
        {
          email: normalizedEmail,
          consentedAt: now,
          source: "website",
        },
      ],
      skipDuplicates: true,
    });

    if (created.count === 0) {
      await tx.newsletterSubscriber.update({
        where: { email: normalizedEmail },
        data: { consentedAt: now },
      });
      return;
    }

    const offer = await tx.offer.create({
      data: {
        name: `Welcome ${welcomePercent}% Off`,
        kind: "PERCENT_OFF",
        code,
        active: true,
        startsAt: new Date(),
        endsAt: expiresAt,
        audience: "FIRST_ORDER",
        maxUsesTotal: 1,
        maxUsesPerCustomer: 1,
        priority: 100,
        config: { percent: welcomePercent },
      },
    });

    await enqueueOutbox(
      {
        type: "WELCOME_COUPON",
        channel: "EMAIL",
        payload: {
          email: normalizedEmail,
          couponCode: offer.code!,
        },
        dedupeKey: `welcome-coupon:${offer.id}`,
      },
      tx
    );
  });

  return { success: true };
}
