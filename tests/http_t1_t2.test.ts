import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "./helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
  genId,
} from "./helpers/fixtures";
import { createSessionCookie } from "./helpers/session";
import { verifySignature, webhookSignature } from "./helpers/razorpay";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T1 & T2: HTTP Checkout Happy Path & Concurrency", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T1 happy path: create-order with real Razorpay, verify with fabricated payment, idempotent replay", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 5 }] });
    const variant = variants[0];
    const idempotencyKey = crypto.randomUUID();

    // 1. Create Order: qty 2
    const createRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.headerValue,
      },
      body: JSON.stringify({
        idempotencyKey,
        items: [{ productId: product.id, variantId: variant.id, qty: 2 }],
        customerName: "T1 Tester",
        customerPhone: "9876543210",
        shippingAddress: {
          line1: "123 Marine Drive",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400001",
        },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
      }),
    });

    expect(createRes.status).toBe(200);
    const createData = await createRes.json();
    expect(createData.orderId).toBeDefined();
    expect(createData.razorpayOrderId).toBeDefined();
    // Subtotal = 200000, shipping = 9900 (under 299900 threshold), payable = 209900
    expect(createData.amount).toBe(209900);

    // Verify order in DB before payment
    const pendingOrder = await prisma.order.findUnique({
      where: { id: createData.orderId },
    });
    expect(pendingOrder).not.toBeNull();
    expect(pendingOrder?.status).toBe("PENDING");
    expect(pendingOrder?.stockDeducted).toBe(false);

    // Stock should not be deducted yet for Razorpay
    const variantBeforePay = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(variantBeforePay?.stock).toBe(5);

    // 2. Verify with fabricated payment ID and correct signature
    const fabricatedPaymentId = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const sig = verifySignature(createData.razorpayOrderId, fabricatedPaymentId);

    const verifyRes = await fetch(`${BASE_URL}/api/checkout/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.headerValue,
      },
      body: JSON.stringify({
        razorpay_order_id: createData.razorpayOrderId,
        razorpay_payment_id: fabricatedPaymentId,
        razorpay_signature: sig,
      }),
    });

    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();
    expect(verifyData.verified).toBe(true);

    // Check DB state after payment
    const paidOrder = await prisma.order.findUnique({
      where: { id: createData.orderId },
    });
    expect(paidOrder?.status).toBe("PAID");
    expect(paidOrder?.stockDeducted).toBe(true);
    expect(paidOrder?.razorpayPaymentId).toBe(fabricatedPaymentId);

    // Stock should be decremented from 5 to 3
    const variantAfterPay = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(variantAfterPay?.stock).toBe(3);

    // Exactly one SALE movement
    const movements = await prisma.stockMovement.findMany({
      where: { variantId: variant.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-2);
    expect(movements[0].reason).toBe("SALE");

    // 3. Replay verify -> still PAID, stock still 3, no second movement
    const replayRes = await fetch(`${BASE_URL}/api/checkout/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.headerValue,
      },
      body: JSON.stringify({
        razorpay_order_id: createData.razorpayOrderId,
        razorpay_payment_id: fabricatedPaymentId,
        razorpay_signature: sig,
      }),
    });

    expect(replayRes.status).toBe(200);
    const replayOrder = await prisma.order.findUnique({
      where: { id: createData.orderId },
    });
    expect(replayOrder?.status).toBe("PAID");

    const variantAfterReplay = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(variantAfterReplay?.stock).toBe(3);

    const movementsAfterReplay = await prisma.stockMovement.findMany({
      where: { variantId: variant.id },
    });
    expect(movementsAfterReplay).toHaveLength(1);
  });

  it("T2 concurrency: verify and webhook fired 10 times in parallel on one PENDING order", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];
    const rzpOrderId = `order_m1test_${crypto.randomBytes(6).toString("hex")}`;

    // Create a PENDING order with razorpayOrderId directly
    const order = await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 2, unitPrice: 100000 }],
      status: "PENDING",
      paymentMethod: "RAZORPAY",
      stockDeducted: false,
      razorpayOrderId: rzpOrderId,
    });

    const fabricatedPaymentId = `pay_m1test_${crypto.randomBytes(6).toString("hex")}`;
    const sig = verifySignature(rzpOrderId, fabricatedPaymentId);

    // Fire 5 verify calls and 5 webhook calls in parallel (10 total)
    const promises: Array<Promise<Response>> = [];

    // 5 verify calls
    for (let i = 0; i < 5; i++) {
      promises.push(
        fetch(`${BASE_URL}/api/checkout/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: session.headerValue,
          },
          body: JSON.stringify({
            razorpay_order_id: rzpOrderId,
            razorpay_payment_id: fabricatedPaymentId,
            razorpay_signature: sig,
          }),
        })
      );
    }

    // 5 webhook calls (each with unique event id)
    for (let i = 0; i < 5; i++) {
      const eventId = `m1test_evt_${crypto.randomBytes(6).toString("hex")}`;
      const payload = JSON.stringify({
        id: eventId,
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: fabricatedPaymentId,
              order_id: rzpOrderId,
            },
          },
        },
      });
      const whSig = webhookSignature(payload);

      promises.push(
        fetch(`${BASE_URL}/api/webhooks/razorpay`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-razorpay-signature": whSig,
            "x-razorpay-event-id": eventId,
          },
          body: payload,
        })
      );
    }

    const responses = await Promise.all(promises);
    for (const r of responses) {
      expect([200]).toContain(r.status);
    }

    // Assert final database state
    const finalOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(finalOrder?.status).toBe("PAID");
    expect(finalOrder?.stockDeducted).toBe(true);

    // Stock should be decremented exactly once: 10 - 2 = 8
    const finalVariant = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(finalVariant?.stock).toBe(8);

    // Exactly one SALE movement
    const movements = await prisma.stockMovement.findMany({
      where: { variantId: variant.id },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-2);
    expect(movements[0].reason).toBe("SALE");
  });
});
