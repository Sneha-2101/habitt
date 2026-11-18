import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T70: Admin Orders CSV Export Status Filter", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("filters exported CSV rows correctly by status, status+q, and unknown status", async () => {
    const staffUser = await createTestUser({ role: "STAFF" });
    const staffSession = await createSessionCookie(staffUser.id, "STAFF");

    const { product, variants } = await createTestProduct({
      price: 100000,
      variants: [{ size: "M", stock: 50 }],
    });
    const variant = variants[0];

    const uniqueTag = `t70_${crypto.randomBytes(4).toString("hex")}`;
    const pendingName = `PendingCustomer_${uniqueTag}`;
    const paidName = `PaidCustomer_${uniqueTag}`;

    // 1. Create a PAID order
    const paidOrder = await createTestOrder({
      userId: staffUser.id,
      customerName: paidName,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "PAID",
      fulfilmentStatus: "PLACED",
      paymentMethod: "RAZORPAY",
      paidAt: new Date(),
    });

    // 2. Create a PENDING order (COD placed)
    const pendingOrder = await createTestOrder({
      userId: staffUser.id,
      customerName: pendingName,
      items: [{ productId: product.id, variantId: variant.id, qty: 1, unitPrice: 100000 }],
      paymentStatus: "COD_PENDING",
      fulfilmentStatus: "PLACED",
      paymentMethod: "COD",
    });

    // Request 1: GET /api/admin/orders/export?status=PAID
    const resPaid = await fetch(`${BASE_URL}/api/admin/orders/export?status=PAID`, {
      headers: { Cookie: staffSession.headerValue },
    });
    expect(resPaid.status).toBe(200);
    expect(resPaid.headers.get("content-type")).toContain("text/csv");
    const csvPaid = await resPaid.text();

    // Must contain paid order, must NOT contain pending order
    expect(csvPaid).toContain(paidOrder.displayId);
    expect(csvPaid).toContain(paidName);
    expect(csvPaid).not.toContain(pendingOrder.displayId);
    expect(csvPaid).not.toContain(pendingName);
    // Verify columns header and values
    expect(csvPaid).toContain('"Payment Status","Fulfilment Status"');
    expect(csvPaid).toContain('"PAID","PLACED"');

    // Request 2: GET /api/admin/orders/export?status=PENDING&q=<unique m1test name>
    const resPendingQ = await fetch(
      `${BASE_URL}/api/admin/orders/export?status=PENDING&q=${encodeURIComponent(pendingName)}`,
      {
        headers: { Cookie: staffSession.headerValue },
      }
    );
    expect(resPendingQ.status).toBe(200);
    expect(resPendingQ.headers.get("content-type")).toContain("text/csv");
    const csvPendingQ = await resPendingQ.text();

    expect(csvPendingQ).toContain(pendingOrder.displayId);
    expect(csvPendingQ).toContain(pendingName);
    expect(csvPendingQ).toContain('"COD_PENDING","PLACED"');
    expect(csvPendingQ).not.toContain(paidOrder.displayId);

    // Request 3: GET /api/admin/orders/export?status=BANANA
    const resBanana = await fetch(`${BASE_URL}/api/admin/orders/export?status=BANANA`, {
      headers: { Cookie: staffSession.headerValue },
    });
    expect(resBanana.status).toBe(200);
    expect(resBanana.headers.get("content-type")).toContain("text/csv");
    const csvBanana = await resBanana.text();

    // Unknown status acts like no filter -> contains both
    expect(csvBanana).toContain(paidOrder.displayId);
    expect(csvBanana).toContain(pendingOrder.displayId);
  });
});
