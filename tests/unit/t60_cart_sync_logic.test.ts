import { describe, it, expect, beforeEach } from "vitest";
import { resolveCartSync, decideCartSync } from "@/lib/cart/merge";
import { handleStaleCartOwner } from "@/components/CartSync";
import { useCartStore } from "@/lib/cart-store";

describe("T60: Cart sync logic, decideCartSync, and resolveCartSync pure helper", () => {
  beforeEach(() => {
    useCartStore.getState().clear();
    useCartStore.getState().setOwner(null);
  });

  describe("decideCartSync pure function", () => {
    it("decision 'wait': when status === 'loading'", () => {
      const decision = decideCartSync({
        status: "loading",
        userId: "user-1",
        ownerId: "user-1",
      });
      expect(decision).toBe("wait");

      const decisionGuest = decideCartSync({
        status: "loading",
        userId: null,
        ownerId: null,
      });
      expect(decisionGuest).toBe("wait");
    });

    it("decision 'clear': signed out + ownerId set -> clear + owner null", () => {
      const decision = decideCartSync({
        status: "unauthenticated",
        userId: null,
        ownerId: "stale-owner-123",
      });
      expect(decision).toBe("clear");
    });

    it("decision 'merge': ownerId null (guest) -> merge with per-variant MAX, then save", () => {
      const decision = decideCartSync({
        status: "authenticated",
        userId: "user-abc",
        ownerId: null,
        prevUserId: null,
      });
      expect(decision).toBe("merge");
    });

    it("decision 'load': ownerId === userId -> LOAD from server and replace local (no merge)", () => {
      const decision = decideCartSync({
        status: "authenticated",
        userId: "user-abc",
        ownerId: "user-abc",
        prevUserId: null,
      });
      expect(decision).toBe("load");
    });

    it("decision 'switch-load': ownerId is another user -> clear, set owner, load", () => {
      const decision = decideCartSync({
        status: "authenticated",
        userId: "user-abc",
        ownerId: "user-different",
        prevUserId: null,
      });
      expect(decision).toBe("switch-load");
    });

    it("decision 'noop': signed out with null ownerId, or already synced same user", () => {
      // 1. Signed out guest with no owner
      const guestNoop = decideCartSync({
        status: "unauthenticated",
        userId: null,
        ownerId: null,
      });
      expect(guestNoop).toBe("noop");

      // 2. Already synced user within current session
      const syncedNoop = decideCartSync({
        status: "authenticated",
        userId: "user-1",
        ownerId: "user-1",
        prevUserId: "user-1",
      });
      expect(syncedNoop).toBe("noop");
    });

    it("same-user reload leaves quantities unchanged", () => {
      const serverItems = [
        { variantId: "vA", productId: "pA", qty: 2 },
        { variantId: "vB", productId: "pB", qty: 3 },
      ];
      const localItems = [
        { variantId: "vA", productId: "pA", qty: 2 },
        { variantId: "vB", productId: "pB", qty: 3 },
      ];

      // On same-user reload (ownerId === userId, initial mount prevUserId is null):
      const decision = decideCartSync({
        status: "authenticated",
        userId: "user-same",
        ownerId: "user-same",
        prevUserId: null,
      });
      expect(decision).toBe("load");

      // Mode is 'load', server cart replaces local cart without doubling quantities
      const res = resolveCartSync({
        ownerId: "user-same",
        userId: "user-same",
        serverItems,
        localItems,
      });
      expect(res.mode).toBe("load");
      expect(res.items).toEqual(serverItems);
      expect((res.items[0] as { qty: number }).qty).toBe(2);
      expect((res.items[1] as { qty: number }).qty).toBe(3);
    });
  });

  describe("resolveCartSync pure helper & stale cart owner", () => {
    it("resolves mode correctly for same user, guest, and different user", () => {
      const serverItems = [{ variantId: "vA", productId: "pA", qty: 2 }];
      const localItems = [{ variantId: "vB", productId: "pB", qty: 1 }];

      // 1. Same user -> mode 'load' (server wins, local ignored)
      const sameUser = resolveCartSync({
        ownerId: "user-123",
        userId: "user-123",
        serverItems,
        localItems,
      });
      expect(sameUser.mode).toBe("load");
      expect(sameUser.items).toEqual(serverItems);
      expect(sameUser.dropped).toBe(0);

      // 2. Guest (ownerId === null) -> mode 'merge'
      const guest = resolveCartSync({
        ownerId: null,
        userId: "user-123",
        serverItems,
        localItems,
      });
      expect(guest.mode).toBe("merge");
      expect(guest.items).toHaveLength(2);

      // 3. Different user -> mode 'load' (discard other user's items)
      const otherUser = resolveCartSync({
        ownerId: "user-456",
        userId: "user-123",
        serverItems,
        localItems,
      });
      expect(otherUser.mode).toBe("load");
      expect(otherUser.items).toEqual(serverItems);
      expect(otherUser.dropped).toBe(localItems.length);
    });

    it("reload idempotency: applying 'load' 5 times to server [A×2] with local [A×2] yields A×2 every time", () => {
      const serverItems = [{ variantId: "vA", productId: "pA", qty: 2 }];
      let localItems = [{ variantId: "vA", productId: "pA", qty: 2 }];

      for (let i = 0; i < 5; i++) {
        const res = resolveCartSync({
          ownerId: "user-1",
          userId: "user-1",
          serverItems,
          localItems,
        });
        expect(res.mode).toBe("load");
        expect(res.items).toEqual([{ variantId: "vA", productId: "pA", qty: 2 }]);
        expect(res.items[0].qty).toBe(2);
        localItems = res.items as typeof localItems;
      }
    });

    it("guest [A×2] with server [A×1, B×1] merges to [A×2, B×1] via max merge", () => {
      const serverItems = [
        { variantId: "vA", productId: "pA", qty: 1 },
        { variantId: "vB", productId: "pB", qty: 1 },
      ];
      const localItems = [{ variantId: "vA", productId: "pA", qty: 2 }];

      const res = resolveCartSync({
        ownerId: null,
        userId: "user-1",
        serverItems,
        localItems,
      });

      expect(res.mode).toBe("merge");
      expect(res.items).toHaveLength(2);
      const itemA = res.items.find((i) => i.variantId === "vA");
      const itemB = res.items.find((i) => i.variantId === "vB");
      expect(itemA?.qty).toBe(2); // max(1, 2)
      expect(itemB?.qty).toBe(1);
    });

    it("stale cart owner branch: when userId === null and ownerId !== null, clears items and sets owner to null", () => {
      useCartStore.setState({
        ownerId: "stale-user-123",
        items: [
          { productId: "p1", variantId: "v1", name: "Item 1", size: "M", unitPrice: 1000, qty: 2 },
        ],
      });

      expect(useCartStore.getState().ownerId).toBe("stale-user-123");
      expect(useCartStore.getState().items).toHaveLength(1);

      const handled = handleStaleCartOwner(null);
      expect(handled).toBe(true);

      const updated = useCartStore.getState();
      expect(updated.ownerId).toBeNull();
      expect(updated.items).toHaveLength(0);

      // When ownerId is already null, handleStaleCartOwner does nothing and returns false
      const handledAgain = handleStaleCartOwner(null);
      expect(handledAgain).toBe(false);
    });
  });
});
