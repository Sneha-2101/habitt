import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "./helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "./helpers/fixtures";
import { webhookSignature } from "./helpers/razorpay";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T7: Razorpay Webhook Handling", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T7 webhook: signature verification, malformed JSON, deduplication, payment.failed, unknown event", async () => {
    const user = await createTestUser();
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];
    const rzpOrderId = `order_m1test_${crypto.randomBytes(6).toString("hex")}`;

    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      razorpayOrderId: rzpOrderId,
    });

    const validPayload = JSON.stringify({
      id: `m1test_evt_${crypto.randomBytes(6).toString("hex")}`,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_m1test_${crypto.randomBytes(6).toString("hex")}`,
            order_id: rzpOrderId,
          },
        },
      },
    });
    const validSig = webhookSignature(validPayload);

    // 1. Missing signature -> 400
    const missingSigRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: validPayload,
    });
    expect(missingSigRes.status).toBe(400);

    // 2. Wrong signature -> 400
    const wrongSigRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": "bad_signature_00000000000000000000000000000000000000000000000000000000",
      },
      body: validPayload,
    });
    expect(wrongSigRes.status).toBe(400);

    // 3. Malformed JSON with a valid signature -> 400
    const badJson = "{ invalid json payload: true ";
    const badJsonSig = webhookSignature(badJson);
    const badJsonRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": badJsonSig,
      },
      body: badJson,
    });
    expect(badJsonRes.status).toBe(400);

    // 4. Valid payment.captured with an event id -> 200 and one ProcessedWebhook row
    const eventId = `m1test_evt_${crypto.randomBytes(6).toString("hex")}`;
    const paymentId = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const capturePayload = JSON.stringify({
      id: eventId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: rzpOrderId,
          },
        },
      },
    });
    const captureSig = webhookSignature(capturePayload);

    const captureRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": captureSig,
        "x-razorpay-event-id": eventId,
      },
      body: capturePayload,
    });
    expect(captureRes.status).toBe(200);

    // Assert one ProcessedWebhook row
    const webhookRows = await prisma.processedWebhook.findMany({
      where: { id: eventId },
    });
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows[0].provider).toBe("RAZORPAY");

    // Order should be PAID and stock deducted
    const paidOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(paidOrder?.status).toBe("PAID");
    expect(paidOrder?.stockDeducted).toBe(true);

    // 5. Replay same event id again -> 200 and no second processing
    const replayRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": captureSig,
        "x-razorpay-event-id": eventId,
      },
      body: capturePayload,
    });
    expect(replayRes.status).toBe(200);

    // ProcessedWebhook rows still exactly 1
    const webhookRowsAfterReplay = await prisma.processedWebhook.findMany({
      where: { id: eventId },
    });
    expect(webhookRowsAfterReplay).toHaveLength(1);

    // 6. payment.failed -> 200, order status unchanged, a note event added
    const rzpOrderId2 = `order_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const order2 = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      razorpayOrderId: rzpOrderId2,
    });

    const failEventId = `m1test_evt_${crypto.randomBytes(6).toString("hex")}`;
    const failPayload = JSON.stringify({
      id: failEventId,
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: `pay_m1test_${crypto.randomBytes(6).toString("hex")}`,
            order_id: rzpOrderId2,
            error_description: "Bank server declined transaction",
          },
        },
      },
    });
    const failSig = webhookSignature(failPayload);

    const failRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": failSig,
        "x-razorpay-event-id": failEventId,
      },
      body: failPayload,
    });
    expect(failRes.status).toBe(200);

    // Order status must remain PENDING
    const unchangedOrder = await prisma.order.findUnique({ where: { id: order2.id } });
    expect(unchangedOrder?.status).toBe("PENDING");

    // Note event added
    const statusEvents = await prisma.orderStatusEvent.findMany({
      where: { orderId: order2.id },
    });
    expect(statusEvents.some((e) => e.note?.includes("Bank server declined transaction"))).toBe(true);

    // 7. Unknown event type -> 200
    const unknownEventPayload = JSON.stringify({
      id: `m1test_evt_${crypto.randomBytes(6).toString("hex")}`,
      event: "invoice.expired",
      payload: {},
    });
    const unknownSig = webhookSignature(unknownEventPayload);

    const unknownRes = await fetch(`${BASE_URL}/api/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": unknownSig,
      },
      body: unknownEventPayload,
    });
    expect(unknownRes.status).toBe(200);
  });
});
