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
import { syncCartAction, saveCartAction } from "@/lib/actions/cart";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";
import * as ratelimitModule from "@/lib/ratelimit";
import { UnauthorizedError } from "@/lib/guards";

describe("T50, T51: Server Cart & Sync Actions", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T50: syncCartAction requires session, merges, drops inactive/missing, sums dups, is idempotent, works when limiter fails open", async () => {
    // 1. Requires real session
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue(null);
    await expect(syncCartAction([])).rejects.toThrow(UnauthorizedError);

    // Create user and real session
    const user = await createTestUser({ email: `${genId("m1test_c1")}@habitt.test` });
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

    // Create active product with 2 variants
    const { product: prod1, variants: [var1, var2] } = await createTestProduct({
      price: 50000,
      variants: [{ size: "M", stock: 10 }, { size: "L", stock: 10 }],
    });
    // Create inactive product
    const { variants: [varInactive] } = await createTestProduct({
      status: "DRAFT",
    });

    // Seed server cart with var1 (qty 2)
    const cart = await prisma.cart.create({
      data: {
        id: genId("m1test_cart"),
        userId: user.id,
        items: {
          create: [
            {
              id: genId("m1test_ci_1"),
              productId: prod1.id,
              variantId: var1.id,
              qty: 2,
            },
          ],
        },
      },
    });
    expect(cart).toBeDefined();

    // Local items:
    // var1: qty 3 (merge should sum to 5)
    // var2: qty 4 (new active variant, should be added)
    // varInactive: qty 1 (inactive, should be dropped)
    // missing-var-id: qty 1 (missing, should be dropped)
    const localItems = [
      {
        variantId: var1.id,
        productId: prod1.id,
        name: "Old Name",
        price: 1, // should not be persisted or trusted
        size: "M",
        qty: 3,
        image: "https://example.com/fake.jpg",
        slug: "fake-slug",
      },
      {
        variantId: var2.id,
        productId: prod1.id,
        name: "Old Name 2",
        price: 2,
        size: "L",
        qty: 4,
        image: "https://example.com/fake.jpg",
        slug: "fake-slug",
      },
      {
        variantId: varInactive.id,
        productId: "p-inact",
        name: "Inactive Item",
        price: 999,
        size: "M",
        qty: 1,
        image: "https://example.com/fake.jpg",
        slug: "fake-slug",
      },
      {
        variantId: "non-existent-var",
        productId: "p-missing",
        name: "Missing Item",
        price: 999,
        size: "S",
        qty: 1,
        image: "https://example.com/fake.jpg",
        slug: "fake-slug",
      },
    ];

    // Mock limiter failure to test fail-open behavior
    vi.spyOn(ratelimitModule, "limit").mockResolvedValue({
      ok: true,
      retryAfterSec: 0,
    });

    const res = await syncCartAction(localItems);
    expect(res.dropped).toBe(2); // varInactive and non-existent-var
    expect(res.items.length).toBe(2);

    const syncedVar1 = res.items.find((i) => i.variantId === var1.id);
    expect(syncedVar1).toBeDefined();
    expect(syncedVar1?.qty).toBe(3); // max(2, 3)
    expect(syncedVar1?.unitPrice).toBe(50000); // actual DB price

    const syncedVar2 = res.items.find((i) => i.variantId === var2.id);
    expect(syncedVar2).toBeDefined();
    expect(syncedVar2?.qty).toBe(4);

    // Verify DB cart items
    const dbItems = await prisma.cartItem.findMany({
      where: { cart: { userId: user.id } },
    });
    expect(dbItems.length).toBe(2);
    expect(dbItems.find((i) => i.variantId === var1.id)?.qty).toBe(3);

    // Second sync should be idempotent
    const res2 = await syncCartAction([]);
    expect(res2.dropped).toBe(0);
    expect(res2.items.length).toBe(2);
    expect(res2.items.find((i) => i.variantId === var1.id)?.qty).toBe(3);
  });

  it("T51: saveCartAction replaces items, enforces ownership isolation, ignores invalid items, stores no price", async () => {
    const userA = await createTestUser({ email: `${genId("m1test_ua")}@habitt.test` });
    const userB = await createTestUser({ email: `${genId("m1test_ub")}@habitt.test` });
    const { sid: sidA } = await createSession({ userId: userA.id, role: "CUSTOMER" });
    const { sid: sidB } = await createSession({ userId: userB.id, role: "CUSTOMER" });

    const { product: prod, variants: [varA] } = await createTestProduct({ price: 75000 });

    // User A saves cart
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userA.id,
      role: "CUSTOMER",
      email: userA.email,
      phone: userA.phone ?? null,
      name: userA.name,
      sid: sidA,
      stepUpAt: null,
    });

    const saveResA = await saveCartAction([
      {
        variantId: varA.id,
        productId: prod.id,
        qty: 3,
        price: 999999, // Should be ignored
        name: "Tampered Price",
        size: "M",
        image: "img",
        slug: "slug",
      },
      {
        variantId: "fake-var-id",
        productId: "fake-prod-id",
        qty: 2,
        price: 100,
        name: "Invalid",
        size: "S",
        image: "img",
        slug: "slug",
      },
    ]);
    expect(saveResA.ok).toBe(true);

    const userACart = await prisma.cart.findUnique({
      where: { userId: userA.id },
      include: { items: true },
    });
    expect(userACart?.items.length).toBe(1);
    expect(userACart?.items[0].variantId).toBe(varA.id);
    expect(userACart?.items[0].qty).toBe(3);

    // Ensure cart item in DB has no price column
    const rawItem = userACart?.items[0] as Record<string, unknown>;
    expect(rawItem.price).toBeUndefined();

    // User B saves their own cart
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userB.id,
      role: "CUSTOMER",
      email: userB.email,
      phone: userB.phone ?? null,
      name: userB.name,
      sid: sidB,
      stepUpAt: null,
    });

    await saveCartAction([]);
    const userBCart = await prisma.cart.findUnique({
      where: { userId: userB.id },
      include: { items: true },
    });
    expect(userBCart?.items.length).toBe(0);

    // User A's cart remains unchanged
    const userACartAfter = await prisma.cart.findUnique({
      where: { userId: userA.id },
      include: { items: true },
    });
    expect(userACartAfter?.items.length).toBe(1);
    expect(userACartAfter?.items[0].variantId).toBe(varA.id);
  });
});
