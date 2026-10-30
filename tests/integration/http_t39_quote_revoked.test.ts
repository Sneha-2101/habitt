import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestUser, createTestProduct, cleanupM1TestRows } from "../helpers/fixtures";
import { createSessionCookie } from "../helpers/session";
import { revokeSession } from "@/lib/sessions";
import { Size } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("T39: HTTP quote revoked session check", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("revoked-session cookie gets 401 on /api/checkout/quote; a valid one does not", async () => {
    const user = await createTestUser();
    const session = await createSessionCookie(user.id);
    const { product, variants } = await createTestProduct({
      price: 100000,
      variants: [{ size: Size.M, stock: 5 }],
    });
    const items = [{ productId: product.id, variantId: variants[0].id, qty: 1 }];

    // 1. Valid session should pass authentication (status 200)
    const validRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.headerValue,
      },
      body: JSON.stringify({ items }),
    });

    expect(validRes.status).toBe(200);

    // 2. Revoke the session in the DB
    await revokeSession(session.sid);

    // 3. Same cookie with revoked session must receive 401 Unauthorized
    const revokedRes = await fetch(`${BASE_URL}/api/checkout/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.headerValue,
      },
      body: JSON.stringify({ items }),
    });

    expect(revokedRes.status).toBe(401);
    const data = await revokedRes.json();
    expect(data.error).toBe("Unauthorized");
  });
});

