import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestCoupon,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { failOrder } from "@/lib/orders/fail-order";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T8, T9 & T10: Store Credit, Coupons & COD Integrity", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T8 store credit: parallel race debiting credit -> one 200, one 409, balance never negative", async () => {
    const user = await createTestUser({ storeCreditBalance: 50000 }); // Rs 500
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    const payload1 = {
      idempotencyKey: crypto.randomUUID(),
      items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
      customerName: "Credit User",
      customerPhone: "9876543210",
      shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
      paymentMethod: "RAZORPAY",
      useStoreCredit: true,
    };

    const payload2 = {
      ...payload1,
      idempotencyKey: crypto.randomUUID(),
    };

    // Fire both create-orders in parallel
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify(payload1),
      }),
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify(payload2),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const failedRes = res1.status === 409 ? res1 : res2;
    const failedBody = await failedRes.json();
    expect(failedBody.error).toContain("Store credit changed");

    // Balance must be 0, never negative
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.storeCreditBalance).toBe(0);

    // Exactly one StoreCreditTransaction
    const txs = await prisma.storeCreditTransaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe(-50000);
  });

  it("T9 coupon: usageLimit 1 race, and usageLimit null reuse after fail/cancel", async () => {
    const user1 = await createTestUser();
    const session1 = await createSessionCookie(user1.id);

    const user2 = await createTestUser();
    const session2 = await createSessionCookie(user2.id);

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    // Part A: Coupon with usageLimit = 1
    const couponLimit1 = await createTestCoupon({ usageLimit: 1, value: 10 });

    const [resA1, resA2] = await Promise.all([
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
          customerName: "User 1",
          customerPhone: "9876543210",
          shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
          paymentMethod: "RAZORPAY",
          useStoreCredit: false,
          couponCode: couponLimit1.code,
        }),
      }),
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
          customerName: "User 2",
          customerPhone: "9876543211",
          shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
          paymentMethod: "RAZORPAY",
          useStoreCredit: false,
          couponCode: couponLimit1.code,
        }),
      }),
    ]);

    const statusesA = [resA1.status, resA2.status].sort();
    expect(statusesA).toEqual([200, 409]);

    const checkedCoupon1 = await prisma.coupon.findUnique({ where: { id: couponLimit1.id } });
    expect(checkedCoupon1?.timesUsed).toBe(1);

    // Part B: Coupon with usageLimit = null
    const couponUnlimited = await createTestCoupon({ usageLimit: null, value: 10 });

    // First order by user1 -> succeeds
    const resB1 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
        customerName: "User 1",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
        couponCode: couponUnlimited.code,
      }),
    });
    expect(resB1.status).toBe(200);
    const dataB1 = await resB1.json();

    const checkedCouponB1 = await prisma.coupon.findUnique({ where: { id: couponUnlimited.id } });
    expect(checkedCouponB1?.timesUsed).toBe(1);

    // Second order by same user with same coupon -> 409
    const resB2 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
        customerName: "User 1",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
        couponCode: couponUnlimited.code,
      }),
    });
    expect(resB2.status).toBe(409);
    const bodyB2 = await resB2.json();
    expect(bodyB2.error).toContain("You have already used this coupon code");

    // Fail the first order via failOrder
    const orderToFail = await prisma.order.findUnique({
      where: { id: dataB1.orderId },
      include: { items: true },
    });
    await prisma.$transaction(async (tx) => {
      await failOrder(tx, orderToFail!);
    });

    // Check that timesUsed decreased to 0
    const checkedCouponB2 = await prisma.coupon.findUnique({ where: { id: couponUnlimited.id } });
    expect(checkedCouponB2?.timesUsed).toBe(0);

    // User can now use the coupon again -> 200
    const resB3 = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
        customerName: "User 1",
        customerPhone: "9876543210",
        shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
        paymentMethod: "RAZORPAY",
        useStoreCredit: false,
        couponCode: couponUnlimited.code,
      }),
    });
    expect(resB3.status).toBe(200);

    const checkedCouponB3 = await prisma.coupon.findUnique({ where: { id: couponUnlimited.id } });
    expect(checkedCouponB3?.timesUsed).toBe(1);
  });

  it("T10 COD: eligibility check, cap check, and parallel race with stock deduction", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    const basePayload = {
      idempotencyKey: crypto.randomUUID(),
      items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
      customerName: "COD Customer",
      customerPhone: "9876543210",
      shippingAddress: { line1: "Street", city: "Mumbai", state: "MH", pincode: "400001" },
      paymentMethod: "COD",
      useStoreCredit: false,
    };

    // 1. Customer with no DELIVERED order choosing COD -> 400
    const noDeliveredRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify(basePayload),
    });
    expect(noDeliveredRes.status).toBe(400);
    const noDeliveredBody = await noDeliveredRes.json();
    expect(noDeliveredBody.error).toContain("first delivered order");

    // Give user one DELIVERED order
    await createTestOrder({
      userId: user.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      paymentMethod: "COD",
      stockDeducted: true,
    });

    // 2. Customer with one DELIVERED order -> COD order created (PENDING, stockDeducted true, stock reduced)
    const stockBefore = variant.stock;
    const codOkRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...basePayload,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(codOkRes.status).toBe(200);
    const codOkData = await codOkRes.json();
    expect(codOkData.isCod).toBe(true);

    const codOrder = await prisma.order.findUnique({ where: { id: codOkData.orderId } });
    expect(codOrder?.status).toBe("PENDING");
    expect(codOrder?.stockDeducted).toBe(true);
    expect(codOrder?.paymentMethod).toBe("COD");

    const variantAfterCod = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(variantAfterCod?.stock).toBe(stockBefore - 1);

    // 3. COD above codOrderCap -> 400
    // Create an expensive product (₹6000 in paise = 600000 > default cap 500000)
    const { product: expProd, variants: expVars } = await createTestProduct({
      price: 600000,
      variants: [{ size: "M", stock: 5 }],
    });
    const capRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...basePayload,
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: expProd.id, variantId: expVars[0].id, qty: 1 }],
      }),
    });
    expect(capRes.status).toBe(400);
    const capBody = await capRes.json();
    expect(capBody.error).toContain("COD is available on orders up to");

    // 4. Stock 1 with two parallel COD orders -> one 200, one 409, stock never negative
    const user2 = await createTestUser();
    const session2 = await createSessionCookie(user2.id);
    await createTestOrder({
      userId: user2.id,
      items: [{ variantId: variant.id, productId: product.id, qty: 1, unitPrice: 100000 }],
      status: "DELIVERED",
      paymentMethod: "COD",
      stockDeducted: true,
    });

    const { product: singleProd, variants: singleVars } = await createTestProduct({
      price: 100000,
      variants: [{ size: "M", stock: 1 }],
    });
    const singleVariant = singleVars[0];

    const [codRace1, codRace2] = await Promise.all([
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify({
          ...basePayload,
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: singleProd.id, variantId: singleVariant.id, qty: 1 }],
        }),
      }),
      fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
        body: JSON.stringify({
          ...basePayload,
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: singleProd.id, variantId: singleVariant.id, qty: 1 }],
        }),
      }),
    ]);

    const raceStatuses = [codRace1.status, codRace2.status].sort();
    expect(raceStatuses).toEqual([200, 409]);

    const finalSingleVar = await prisma.productVariant.findUnique({ where: { id: singleVariant.id } });
    expect(finalSingleVar?.stock).toBe(0);
  });
});
