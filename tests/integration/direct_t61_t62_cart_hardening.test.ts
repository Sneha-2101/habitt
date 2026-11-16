import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import { syncCartAction, saveCartAction, loadCartAction } from "@/lib/actions/cart";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";
import * as ratelimitModule from "@/lib/ratelimit";
import { Size } from "@prisma/client";

describe("T61, T62: Cart Server Hardening", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T61: when limit returns ok:false (mock), sync/save/load throw friendly message and write nothing", async () => {
    const user = await createTestUser({ email: `${genId("m1test_rl")}@habitt.test` });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    const { variants } = await createTestProduct({
      status: "ACTIVE",
      variants: [{ size: Size.M, stock: 10 }],
    });
    const v = variants[0];

    // Mock limit returning ok: false for cartSync
    vi.spyOn(ratelimitModule, "limit").mockResolvedValue({
      ok: false,
      retryAfterSec: 30,
    });

    const expectedMsg = "Too many requests. Please try again shortly.";

    // 1. syncCartAction should throw friendly error
    await expect(
      syncCartAction([{ variantId: v.id, qty: 1 }])
    ).rejects.toThrow(expectedMsg);

    // 2. saveCartAction should throw friendly error
    await expect(
      saveCartAction([{ variantId: v.id, qty: 1 }])
    ).rejects.toThrow(expectedMsg);

    // 3. loadCartAction should throw friendly error
    await expect(loadCartAction()).rejects.toThrow(expectedMsg);

    // Verify DB wrote nothing
    const cartCount = await prisma.cart.count({
      where: { userId: user.id },
    });
    expect(cartCount).toBe(0);

    const itemsCount = await prisma.cartItem.count({
      where: { cart: { userId: user.id } },
    });
    expect(itemsCount).toBe(0);
  });

  it("T62: five concurrent syncCartAction calls for a brand-new user: none throw, exactly one Cart, no duplicate CartItem", async () => {
    const user = await createTestUser({ email: `${genId("m1test_concur")}@habitt.test` });
    const { sid } = await createSession({ userId: user.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: "CUSTOMER",
      email: user.email,
      phone: user.phone ?? null,
      name: user.name,
      sid,
      stepUpAt: null,
    });

    const { variants } = await createTestProduct({
      status: "ACTIVE",
      variants: [
        { size: Size.M, stock: 20 },
        { size: Size.L, stock: 20 },
      ],
    });
    const v1 = variants[0];
    const v2 = variants[1];

    // Ensure limiter succeeds
    vi.spyOn(ratelimitModule, "limit").mockResolvedValue({
      ok: true,
      retryAfterSec: 0,
    });

    const inputItems = [
      { variantId: v1.id, qty: 2 },
      { variantId: v2.id, qty: 1 },
    ];

    // Fire 5 concurrent sync calls
    const results = await Promise.all([
      syncCartAction(inputItems),
      syncCartAction(inputItems),
      syncCartAction(inputItems),
      syncCartAction(inputItems),
      syncCartAction(inputItems),
    ]);

    // All should succeed without throwing
    expect(results).toHaveLength(5);
    for (const res of results) {
      expect(res.dropped).toBe(0);
      expect(res.items.length).toBe(2);
    }

    // Exactly 1 Cart in DB
    const carts = await prisma.cart.findMany({
      where: { userId: user.id },
    });
    expect(carts.length).toBe(1);

    // Cart items must not have duplicates
    const dbItems = await prisma.cartItem.findMany({
      where: { cartId: carts[0].id },
    });
    expect(dbItems.length).toBe(2);

    const v1Item = dbItems.find((i) => i.variantId === v1.id);
    const v2Item = dbItems.find((i) => i.variantId === v2.id);
    expect(v1Item).toBeDefined();
    expect(v2Item).toBeDefined();
    expect(v1Item?.qty).toBe(2);
    expect(v2Item?.qty).toBe(1);
  });
});
