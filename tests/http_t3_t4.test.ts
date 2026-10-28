import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { prisma } from "./helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
} from "./helpers/fixtures";
import { createSessionCookie } from "./helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T3 & T4: HTTP Checkout Validation & Idempotency", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T3 validation: invalid inputs return 400/409 and create NO order rows", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 10 }] });
    const variant = variants[0];

    const validAddress = {
      line1: "123 Test Street",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    };

    const validPayload = {
      idempotencyKey: crypto.randomUUID(),
      items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
      customerName: "Valid Customer",
      customerPhone: "9876543210",
      shippingAddress: validAddress,
      paymentMethod: "RAZORPAY",
      useStoreCredit: false,
    };

    // 1. Invalid quantities: -1, 0, 1.5, 11, string qty
    const invalidQtys = [-1, 0, 1.5, 11, "two"];
    for (const badQty of invalidQtys) {
      const res = await fetch(`${BASE_URL}/api/checkout/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: session.headerValue },
        body: JSON.stringify({
          ...validPayload,
          idempotencyKey: crypto.randomUUID(),
          items: [{ productId: product.id, variantId: variant.id, qty: badQty }],
        }),
      });
      expect(res.status).toBe(400);
    }

    // 2. Empty items array
    const emptyItemsRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: [],
      }),
    });
    expect(emptyItemsRes.status).toBe(400);

    // 3. 21 lines in items
    const twentyOneItems = Array.from({ length: 21 }, () => ({
      productId: product.id,
      variantId: variant.id,
      qty: 1,
    }));
    const tooManyItemsRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: twentyOneItems,
      }),
    });
    expect(tooManyItemsRes.status).toBe(400);

    // 4. Missing address fields & bad pincode
    const badPincodeRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        shippingAddress: { ...validAddress, pincode: "12345" }, // 5 digits instead of 6
      }),
    });
    expect(badPincodeRes.status).toBe(400);

    const missingCityRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        shippingAddress: { line1: "Street", state: "State", pincode: "400001" }, // missing city
      }),
    });
    expect(missingCityRes.status).toBe(400);

    // 5. Bad phone
    const badPhoneRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        customerPhone: "12345", // too short
      }),
    });
    expect(badPhoneRes.status).toBe(400);

    // Verify NO order rows were created for any of the above 400s
    const ordersCountAfterBadInputs = await prisma.order.count({ where: { userId: user.id } });
    expect(ordersCountAfterBadInputs).toBe(0);

    // 6. Draft and archived products -> 409 and NO order created
    const { product: draftProduct, variants: draftVariants } = await createTestProduct({
      status: "DRAFT",
      variants: [{ size: "M", stock: 5 }],
    });
    const draftRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: draftProduct.id, variantId: draftVariants[0].id, qty: 1 }],
      }),
    });
    expect(draftRes.status).toBe(409);

    const { product: archivedProduct, variants: archivedVariants } = await createTestProduct({
      status: "ARCHIVED",
      variants: [{ size: "M", stock: 5 }],
    });
    const archivedRes = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: [{ productId: archivedProduct.id, variantId: archivedVariants[0].id, qty: 1 }],
      }),
    });
    expect(archivedRes.status).toBe(409);

    // 7. Duplicate lines 6+6 -> 400 (merged qty = 12 > 10)
    const dupLine6Res = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: [
          { productId: product.id, variantId: variant.id, qty: 6 },
          { productId: product.id, variantId: variant.id, qty: 6 },
        ],
      }),
    });
    expect(dupLine6Res.status).toBe(400);

    // 8. Duplicate lines 3+3 with stock 5 -> 409 (merged qty = 6 > 5)
    const { product: lowStockProd, variants: lowStockVars } = await createTestProduct({
      variants: [{ size: "M", stock: 5 }],
    });
    const dupLine3Res = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session.headerValue },
      body: JSON.stringify({
        ...validPayload,
        idempotencyKey: crypto.randomUUID(),
        items: [
          { productId: lowStockProd.id, variantId: lowStockVars[0].id, qty: 3 },
          { productId: lowStockProd.id, variantId: lowStockVars[0].id, qty: 3 },
        ],
      }),
    });
    expect(dupLine3Res.status).toBe(409);

    // Confirm absolutely no orders created for this user
    const finalOrdersCount = await prisma.order.count({ where: { userId: user.id } });
    expect(finalOrdersCount).toBe(0);
  });

  it("T4 idempotency: sequential replay, parallel calls, user mismatch, and expired checkout", async () => {
    const user1 = await createTestUser();
    const session1 = await createSessionCookie(user1.id);

    const user2 = await createTestUser();
    const session2 = await createSessionCookie(user2.id);

    const { product, variants } = await createTestProduct({ price: 100000, variants: [{ size: "M", stock: 20 }] });
    const variant = variants[0];
    const key = crypto.randomUUID();

    const payload = {
      idempotencyKey: key,
      items: [{ productId: product.id, variantId: variant.id, qty: 1 }],
      customerName: "Idempotent User",
      customerPhone: "9876543210",
      shippingAddress: {
        line1: "123 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      paymentMethod: "RAZORPAY",
      useStoreCredit: false,
    };

    // 1. Sequential calls with same key -> same orderId and razorpayOrderId
    const firstCall = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify(payload),
    });
    expect(firstCall.status).toBe(200);
    const firstData = await firstCall.json();

    const secondCall = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify(payload),
    });
    expect(secondCall.status).toBe(200);
    const secondData = await secondCall.json();

    expect(secondData.orderId).toBe(firstData.orderId);
    expect(secondData.razorpayOrderId).toBe(firstData.razorpayOrderId);

    // 2. Parallel requests with one fresh key -> exactly one Order row created
    const parallelKey = crypto.randomUUID();
    const parallelPayload = { ...payload, idempotencyKey: parallelKey };

    const parallelResponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${BASE_URL}/api/checkout/create-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
          body: JSON.stringify(parallelPayload),
        }).then((r) => r.json())
      )
    );

    // All should return the same orderId
    const firstOrderId = parallelResponses[0].orderId;
    for (const res of parallelResponses) {
      expect(res.orderId).toBe(firstOrderId);
    }

    const createdParallelOrders = await prisma.order.findMany({
      where: { idempotencyKey: parallelKey },
    });
    expect(createdParallelOrders).toHaveLength(1);

    // 3. A second user with the same key -> 409
    const secondUserCall = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session2.headerValue },
      body: JSON.stringify(parallelPayload),
    });
    expect(secondUserCall.status).toBe(409);
    const secondUserBody = await secondUserCall.json();
    expect(secondUserBody.error).toContain("Idempotency key belongs to another user");

    // 4. Same key after the order is FAILED -> 409 with retry: true
    await prisma.order.update({
      where: { idempotencyKey: parallelKey },
      data: { status: "FAILED" },
    });

    const failedRetryCall = await fetch(`${BASE_URL}/api/checkout/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session1.headerValue },
      body: JSON.stringify(parallelPayload),
    });
    expect(failedRetryCall.status).toBe(409);
    const failedRetryBody = await failedRetryCall.json();
    expect(failedRetryBody.retry).toBe(true);
    expect(failedRetryBody.error).toBe("This checkout expired");
  });
});
