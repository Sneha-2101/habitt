import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, genId } from "../helpers/fixtures";

const mockSendWelcome = vi.fn().mockResolvedValue({ success: true });

vi.mock("@/lib/email", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...orig,
    sendNewsletterWelcomeEmail: (...args: unknown[]) => mockSendWelcome(...args),
  };
});
vi.mock("@/lib/ratelimit", () => ({
  limit: vi.fn().mockResolvedValue({ ok: true }),
}));

import { subscribeNewsletter } from "@/lib/actions/newsletter";
import { processOutboxBatch } from "@/lib/outbox/process";

describe("T116: Welcome Coupon Email via Outbox", () => {
  beforeEach(async () => {
    mockSendWelcome.mockClear();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("enqueues one WELCOME_COUPON outbox message on subscribe, dedupes repeat subscribe, and sends via processor", async () => {
    const email = `${genId("m1test_sub")}@example.test`;
    let couponCode: string | undefined;
    let outboxIds: string[] = [];

    try {
      const res1 = await subscribeNewsletter(email);
      expect(res1).toEqual({ success: true });
      expect(mockSendWelcome).not.toHaveBeenCalled();

      const outboxRows = await prisma.eventOutbox.findMany({
        where: { type: "WELCOME_COUPON", payload: { path: ["email"], equals: email } },
      });
      outboxIds = outboxRows.map((r) => r.id);
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0].status).toBe("PENDING");
      couponCode = (outboxRows[0].payload as { couponCode?: string }).couponCode;

      // Second subscribe is neutral and creates no second outbox row
      const res2 = await subscribeNewsletter(email);
      expect(res2).toEqual({ success: true });
      const outboxRowsAfter = await prisma.eventOutbox.findMany({
        where: { type: "WELCOME_COUPON", payload: { path: ["email"], equals: email } },
      });
      outboxIds = outboxRowsAfter.map((r) => r.id);
      expect(outboxRowsAfter).toHaveLength(1);

      const batchRes = await processOutboxBatch(25);
      expect(batchRes.sent).toBeGreaterThanOrEqual(1);
      const callsForEmail = mockSendWelcome.mock.calls.filter(
        (args) => args[0] === email
      );
      expect(callsForEmail).toHaveLength(1);

      const processedRow = await prisma.eventOutbox.findUnique({ where: { id: outboxRows[0].id } });
      expect(processedRow?.status).toBe("SENT");
    } finally {
      // Clean up non-m1test-prefixed offer and outbox rows created by subscribeNewsletter
      if (couponCode) {
        await prisma.offer.deleteMany({ where: { code: couponCode } });
      }
      if (outboxIds.length > 0) {
        await prisma.eventOutbox.deleteMany({ where: { id: { in: outboxIds } } });
      }
    }
  });

  it("handles concurrent double-submit for the same email atomically with 1 subscriber, 1 offer, and 1 outbox row", async () => {
    const email = `${genId("m1test_race")}@example.test`;
    let couponCode: string | undefined;
    let outboxIds: string[] = [];

    try {
      const [r1, r2] = await Promise.all([
        subscribeNewsletter(email),
        subscribeNewsletter(email),
      ]);
      expect(r1).toEqual({ success: true });
      expect(r2).toEqual({ success: true });

      const subscribers = await prisma.newsletterSubscriber.findMany({ where: { email } });
      expect(subscribers).toHaveLength(1);

      const outboxRows = await prisma.eventOutbox.findMany({
        where: { type: "WELCOME_COUPON", payload: { path: ["email"], equals: email } },
      });
      outboxIds = outboxRows.map((r) => r.id);
      expect(outboxRows).toHaveLength(1);

      couponCode = (outboxRows[0].payload as { couponCode?: string }).couponCode;
      const offers = couponCode
        ? await prisma.offer.findMany({ where: { code: couponCode } })
        : [];
      expect(offers).toHaveLength(1);
    } finally {
      if (couponCode) {
        await prisma.offer.deleteMany({ where: { code: couponCode } });
      }
      if (outboxIds.length > 0) {
        await prisma.eventOutbox.deleteMany({ where: { id: { in: outboxIds } } });
      }
    }
  });
});
