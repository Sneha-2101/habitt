import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  createTestOrder,
  cleanupM1TestRows,
} from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T24 & T25: HTTP Output Safety (HTML Invoice XSS & CSV Injection)", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T24 invoice: line1 with <script>alert(1)</script> renders escaped (&lt;script&gt;) and response contains CSP header", async () => {
    const owner = await createTestUser();
    const otherUser = await createTestUser();
    const ownerSession = await createSessionCookie(owner.id);
    const otherSession = await createSessionCookie(otherUser.id);

    const { product, variants } = await createTestProduct({ price: 299900 });
    const order = await createTestOrder({
      userId: owner.id,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 299900 }],
      status: "PAID",
      shippingAddress: {
        line1: "<script>alert(1)</script>",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
    });

    // 1. Unauthenticated request should be rejected (401)
    const unauthRes = await fetch(`${BASE_URL}/api/orders/${order.id}/invoice`);
    expect(unauthRes.status).toBe(401);

    // 2. Non-owner customer should be forbidden (403)
    const forbiddenRes = await fetch(`${BASE_URL}/api/orders/${order.id}/invoice`, {
      headers: { Cookie: otherSession.headerValue },
    });
    expect(forbiddenRes.status).toBe(403);

    // 3. Owner request succeeds (200)
    const res = await fetch(`${BASE_URL}/api/orders/${order.id}/invoice`, {
      headers: { Cookie: ownerSession.headerValue },
    });
    expect(res.status).toBe(200);

    // Verify Security Headers
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");

    const nosniff = res.headers.get("x-content-type-options");
    expect(nosniff).toBe("nosniff");

    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/html");

    // Verify HTML escaping of line1
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("T25 csv: customer name starting with =cmd| is prefixed with single quote", async () => {
    const staffUser = await createTestUser({ role: "STAFF" });
    const regularUser = await createTestUser({ role: "CUSTOMER" });
    const staffSession = await createSessionCookie(staffUser.id, "STAFF");
    const regularSession = await createSessionCookie(regularUser.id, "CUSTOMER");

    const maliciousName = "=cmd|' /C calc'!A0";
    const { product, variants } = await createTestProduct({ price: 150000 });
    await createTestOrder({
      userId: staffUser.id,
      customerName: maliciousName,
      items: [{ productId: product.id, variantId: variants[0].id, qty: 1, unitPrice: 150000 }],
      status: "PAID",
    });

    // 1. Customer cannot export CSV (403)
    const customerRes = await fetch(`${BASE_URL}/api/admin/orders/export`, {
      headers: { Cookie: regularSession.headerValue },
    });
    expect(customerRes.status).toBe(403);

    // 2. Staff user can export CSV (200)
    const staffRes = await fetch(`${BASE_URL}/api/admin/orders/export`, {
      headers: { Cookie: staffSession.headerValue },
    });
    expect(staffRes.status).toBe(200);
    expect(staffRes.headers.get("content-type")).toContain("text/csv");

    const csvText = await staffRes.text();
    // Formula trigger must be sanitized with leading single quote: "'=cmd|"
    expect(csvText).toContain("\"'=cmd|' /C calc'!A0\"");
  });
});

