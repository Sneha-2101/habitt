import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { enqueueOutbox } from "@/lib/outbox/enqueue";
import { processOutboxBatch } from "@/lib/outbox/process";
import { withCronRun } from "@/lib/cron/run-log";
import { GET as outboxCron } from "@/app/api/cron/outbox/route";

const mockSendShipmentEmail = vi.fn().mockResolvedValue({});
const mockSendDeliveredEmail = vi.fn().mockResolvedValue({});
const mockSendOutForDeliveryEmail = vi.fn().mockResolvedValue({});

vi.mock("@/lib/email", () => ({
  sendShipmentNotificationEmail: (orderId: string) => mockSendShipmentEmail(orderId),
  sendDeliveredEmail: (orderId: string, note?: string) => mockSendDeliveredEmail(orderId, note),
  sendOutForDeliveryEmail: (orderId: string) => mockSendOutForDeliveryEmail(orderId),
  sendReviewRequestEmail: vi.fn().mockResolvedValue({}),
}));

describe("T89: Event Outbox & Cron Run Log Integration", () => {
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await cleanupM1TestRows();
  });

  afterAll(async () => {
    await cleanupM1TestRows();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    await prisma.eventOutbox.deleteMany({});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("1. enqueueOutbox idempotency: dedupeKey prevents duplicate rows", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct();
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    const dedupeKey = `m1test_dedupe_${Date.now()}`;

    const res1 = await enqueueOutbox({
      orderId: order.id,
      channel: "EMAIL",
      type: "ORDER_SHIPPED",
      payload: { orderId: order.id },
      dedupeKey,
    });
    expect(res1).not.toBeNull();

    const res2 = await enqueueOutbox({
      orderId: order.id,
      channel: "EMAIL",
      type: "ORDER_SHIPPED",
      payload: { orderId: order.id },
      dedupeKey,
    });
    expect(res2).not.toBeNull();
    expect(res2.id).toBe(res1.id);

    const outboxRows = await prisma.eventOutbox.findMany({
      where: { dedupeKey },
    });
    expect(outboxRows).toHaveLength(1);
  });

  it("2. processOutboxBatch sends email once and marks SENT", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct();
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    const dedupeKey = `m1test_email_${Date.now()}`;
    await enqueueOutbox({
      orderId: order.id,
      channel: "EMAIL",
      type: "ORDER_SHIPPED",
      payload: { orderId: order.id },
      dedupeKey,
    });

    const batchRes = await processOutboxBatch(10);
    expect(batchRes.processed).toBeGreaterThanOrEqual(1);

    expect(mockSendShipmentEmail).toHaveBeenCalledTimes(1);
    expect(mockSendShipmentEmail).toHaveBeenCalledWith(order.id);

    const item = await prisma.eventOutbox.findUnique({ where: { dedupeKey } });
    expect(item!.status).toBe("SENT");
    expect(item!.sentAt).not.toBeNull();
    expect(item!.attempts).toBe(1);

    // Second run processes 0 (no double sending)
    const secondBatch = await processOutboxBatch(10);
    expect(secondBatch.processed).toBe(0);
    expect(mockSendShipmentEmail).toHaveBeenCalledTimes(1);
  });

  it("3. Failing sender retries with backoff and marks FAILED after 5 attempts", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct();
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    mockSendDeliveredEmail.mockRejectedValue(new Error("Email provider network timeout"));

    const dedupeKey = `m1test_fail_${Date.now()}`;
    const outboxItem = await enqueueOutbox({
      orderId: order.id,
      channel: "EMAIL",
      type: "ORDER_DELIVERED",
      payload: { orderId: order.id },
      dedupeKey,
    });

    // Run 1st attempt: fails, increments attempt, computes backoff nextAttemptAt
    await processOutboxBatch(10);
    let item = await prisma.eventOutbox.findUnique({ where: { id: outboxItem.id } });
    expect(item!.status).toBe("PENDING");
    expect(item!.attempts).toBe(1);
    expect(item!.lastError).toContain("Email provider network timeout");
    expect(item!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);

    // Simulate 4 more attempts by bumping attempts to 4 and nextAttemptAt to now
    await prisma.eventOutbox.update({
      where: { id: outboxItem.id },
      data: { attempts: 4, nextAttemptAt: new Date(Date.now() - 1000) },
    });

    // 5th attempt: should mark FAILED
    await processOutboxBatch(10);
    item = await prisma.eventOutbox.findUnique({ where: { id: outboxItem.id } });
    expect(item!.status).toBe("FAILED");
    expect(item!.attempts).toBe(5);
  });

  it("4. WHATSAPP marked SKIPPED when WHATSAPP_MESSAGES_LIVE !== 'true'", async () => {
    delete process.env.WHATSAPP_MESSAGES_LIVE;

    const user = await createTestUser();
    const { product, variants } = await createTestProduct();
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    const dedupeKey = `m1test_wa_${Date.now()}`;
    const outboxItem = await enqueueOutbox({
      orderId: order.id,
      channel: "WHATSAPP",
      type: "ORDER_SHIPPED",
      payload: { orderId: order.id },
      dedupeKey,
    });

    await processOutboxBatch(10);
    const item = await prisma.eventOutbox.findUnique({ where: { id: outboxItem.id } });
    expect(item!.status).toBe("SKIPPED");
    expect(item!.lastError).toContain("WHATSAPP_MESSAGES_LIVE flag is disabled");
  });

  it("5. Parallel processors do not double-send (atomic claim)", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct();
    const order = await createTestOrder({
      userId: user.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 100000 }],
    });

    const dedupeKey = `m1test_parallel_${Date.now()}`;
    await enqueueOutbox({
      orderId: order.id,
      channel: "EMAIL",
      type: "OUT_FOR_DELIVERY",
      payload: { orderId: order.id },
      dedupeKey,
    });

    // Run 2 parallel batch processors
    const [res1, res2] = await Promise.all([
      processOutboxBatch(10),
      processOutboxBatch(10),
    ]);

    // Total processed for this item must be exactly 1
    expect(mockSendOutForDeliveryEmail).toHaveBeenCalledTimes(1);
    expect(res1.processed + res2.processed).toBe(1);

    const item = await prisma.eventOutbox.findUnique({ where: { dedupeKey } });
    expect(item!.status).toBe("SENT");
    expect(item!.attempts).toBe(1);
  });

  it("6. Cron routes enforce CRON_SECRET (401 unauthorized, 500 when unset) & write CronRun records", async () => {
    process.env.CRON_SECRET = "test_cron_secret_123";

    // 6a: Missing or wrong secret -> 401
    const unauthReq = new Request("http://localhost:3000/api/cron/outbox", {
      headers: { authorization: "Bearer wrong_secret" },
    });
    const unauthRes = await outboxCron(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 6b: Secret unset in env -> 500
    delete process.env.CRON_SECRET;
    const noSecretReq = new Request("http://localhost:3000/api/cron/outbox", {
      headers: { authorization: "Bearer any" },
    });
    const noSecretRes = await outboxCron(noSecretReq);
    expect(noSecretRes.status).toBe(500);

    // 6c: Valid secret -> 200 and records CronRun
    process.env.CRON_SECRET = "test_cron_secret_123";
    const authReq = new Request("http://localhost:3000/api/cron/outbox", {
      headers: { authorization: "Bearer test_cron_secret_123" },
    });
    const authRes = await outboxCron(authReq);
    expect(authRes.status).toBe(200);

    const latestRun = await prisma.cronRun.findFirst({
      where: { job: "outbox" },
      orderBy: { startedAt: "desc" },
    });
    expect(latestRun).not.toBeNull();
    expect(latestRun!.ok).toBe(true);
    expect(latestRun!.finishedAt).not.toBeNull();

    // 6d: withCronRun wrapper records failures
    await expect(
      withCronRun("m1test_failing_job", async () => {
        throw new Error("Simulated cron task failure");
      })
    ).rejects.toThrow("Simulated cron task failure");

    const failedRun = await prisma.cronRun.findFirst({
      where: { job: "m1test_failing_job" },
      orderBy: { startedAt: "desc" },
    });
    expect(failedRun).not.toBeNull();
    expect(failedRun!.ok).toBe(false);
    expect(failedRun!.error).toContain("Simulated cron task failure");
  });
});
