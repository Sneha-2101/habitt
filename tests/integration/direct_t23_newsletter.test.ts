import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows } from "../helpers/fixtures";
import { subscribeNewsletter } from "@/lib/actions/newsletter";
import { resetMemoryLimits } from "@/lib/ratelimit";

describe("T23: Newsletter Subscription & Coupon Generation", () => {
  const email = "m1test_newsletter_sub@example.test";

  beforeEach(async () => {
    resetMemoryLimits();
    await cleanupM1TestRows();
    await prisma.coupon.deleteMany({
      where: { code: { startsWith: "WELCOME-" } },
    });
  });

  afterEach(async () => {
    resetMemoryLimits();
    await prisma.coupon.deleteMany({
      where: { code: { startsWith: "WELCOME-" } },
    });
    await cleanupM1TestRows();
  });

  it("T23 newsletter: response contains no code; 2nd subscribe with same email creates no 2nd coupon; new coupon has usageLimit: 1", async () => {
    // 1. Initial subscribe
    const res1 = await subscribeNewsletter(email);

    // Response must strictly return { success: true } and contain no code
    expect(res1).toEqual({ success: true });
    expect((res1 as any).code).toBeUndefined();

    // Verify subscriber record created in database
    const subscriber = await prisma.newsletterSubscriber.findUnique({
      where: { email },
    });
    expect(subscriber).toBeDefined();
    expect(subscriber?.email).toBe(email);
    expect(subscriber?.consentedAt).toBeInstanceOf(Date);

    // Verify newly generated welcome coupon
    const couponsAfter1 = await prisma.coupon.findMany({
      where: { code: { startsWith: "WELCOME-" } },
    });
    expect(couponsAfter1.length).toBe(1);
    const welcomeCoupon = couponsAfter1[0];

    // New coupon has usageLimit: 1 and 30-day expiry
    expect(welcomeCoupon.usageLimit).toBe(1);
    expect(welcomeCoupon.timesUsed).toBe(0);
    expect(welcomeCoupon.expiresAt).not.toBeNull();
    const expiryDiffDays = (welcomeCoupon.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    expect(Math.round(expiryDiffDays)).toBeGreaterThanOrEqual(29);
    expect(Math.round(expiryDiffDays)).toBeLessThanOrEqual(31);

    // 2. Second subscribe with same email
    resetMemoryLimits(); // reset rate limit to isolate subscriber deduplication logic
    const res2 = await subscribeNewsletter(email);
    expect(res2).toEqual({ success: true });
    expect((res2 as any).code).toBeUndefined();

    // No second coupon must be created
    const couponsAfter2 = await prisma.coupon.findMany({
      where: { code: { startsWith: "WELCOME-" } },
    });
    expect(couponsAfter2.length).toBe(1);
    expect(couponsAfter2[0].id).toBe(welcomeCoupon.id);
  });
});

