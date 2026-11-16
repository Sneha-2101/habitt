import { describe, it, expect } from "vitest";
import { mergeCarts } from "@/lib/cart/merge";

describe("T49: Cart merge logic", () => {
  // Note: Updated for M2b-fix cart merge semantics: takes per-variant maximum rather than sum
  it("takes the per-variant maximum across server and local items", () => {
    const validVariants = new Set(["v1", "v2"]);
    const serverItems = [{ variantId: "v1", qty: 2, productId: "p1" }];
    const localItems = [
      { variantId: "v1", qty: 3, productId: "p1" },
      { variantId: "v2", qty: 4, productId: "p2" },
    ];

    const result = mergeCarts(serverItems, localItems, validVariants);
    expect(result.dropped).toBe(0);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ variantId: "v1", productId: "p1", qty: 3 });
    expect(result.items[1]).toEqual({ variantId: "v2", productId: "p2", qty: 4 });
  });

  it("caps each line qty at 10", () => {
    const validVariants = new Set(["v1"]);
    const serverItems = [{ variantId: "v1", qty: 7, productId: "p1" }];
    const localItems = [{ variantId: "v1", qty: 12, productId: "p1" }];

    const result = mergeCarts(serverItems, localItems, validVariants);
    expect(result.items[0].qty).toBe(10);
  });

  it("drops variants not in validVariantIds and counts them as dropped", () => {
    const validVariants = new Set(["v1"]);
    const serverItems = [{ variantId: "v1", qty: 2, productId: "p1" }];
    const localItems = [{ variantId: "v_unknown", qty: 1, productId: "p_unknown" }];

    const result = mergeCarts(serverItems, localItems, validVariants);
    expect(result.dropped).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].variantId).toBe("v1");
  });

  it("rejects non-integer, negative, or zero quantities", () => {
    const validVariants = new Set(["v1", "v2", "v3"]);
    const localItems = [
      { variantId: "v1", qty: 0, productId: "p1" },
      { variantId: "v2", qty: -2, productId: "p2" },
      { variantId: "v3", qty: 2.5, productId: "p3" },
    ];

    const result = mergeCarts([], localItems, validVariants);
    expect(result.dropped).toBe(3);
    expect(result.items).toHaveLength(0);
  });

  it("enforces server-first ordering followed by local lines", () => {
    const validVariants = new Set(["v_server1", "v_server2", "v_local1"]);
    const serverItems = [
      { variantId: "v_server1", qty: 1, productId: "p1" },
      { variantId: "v_server2", qty: 1, productId: "p2" },
    ];
    const localItems = [
      { variantId: "v_local1", qty: 1, productId: "p3" },
      { variantId: "v_server1", qty: 1, productId: "p1" },
    ];

    const result = mergeCarts(serverItems, localItems, validVariants);
    expect(result.items.map((i) => i.variantId)).toEqual(["v_server1", "v_server2", "v_local1"]);
  });

  it("caps cart at 20 lines maximum and counts excess as dropped", () => {
    const validVariants = new Set<string>();
    const serverItems = [];
    for (let i = 1; i <= 25; i++) {
      const vid = `v_${i}`;
      validVariants.add(vid);
      serverItems.push({ variantId: vid, qty: 1, productId: `p_${i}` });
    }

    const result = mergeCarts(serverItems, [], validVariants);
    expect(result.items).toHaveLength(20);
    expect(result.dropped).toBe(5);
  });
});

