import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  queuePixelEvent,
  flushPixelQueue,
  hasPendingPurchase,
  resetPixelQueueForTests,
  type StorageLike,
} from "@/lib/consent/pixel-queue";
import { purchaseDedupeKey, shouldLoadPixel } from "@/lib/consent/consent";

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("consent/pixel-queue", () => {
  beforeEach(() => {
    resetPixelQueueForTests();
  });

  it("flushes queued events in order once fbq exists", () => {
    const storage = createMemoryStorage();
    const fbq = vi.fn();

    queuePixelEvent({ eventName: "ViewContent", data: { content_ids: ["p1"] } });
    queuePixelEvent({ eventName: "AddToCart", data: { content_ids: ["v1"] } });

    const count = flushPixelQueue(fbq, storage);
    expect(count).toBe(2);
    expect(fbq).toHaveBeenNthCalledWith(1, "track", "ViewContent", { content_ids: ["p1"] }, undefined);
    expect(fbq).toHaveBeenNthCalledWith(2, "track", "AddToCart", { content_ids: ["v1"] }, undefined);
  });

  it("gates pixel loading when consent is unset", () => {
    expect(shouldLoadPixel({ pixelId: "12345", consent: "unset" })).toBe(false);
  });

  it("never queues the same Purchase orderId twice and writes dedupe key only at flush time", () => {
    const storage = createMemoryStorage();
    const key = purchaseDedupeKey("ord_101");

    const first = queuePixelEvent(
      {
        eventName: "Purchase",
        data: { value: 1999, currency: "INR", order_id: "ord_101" },
        options: { eventID: "ord_101" },
        purchaseOrderId: "ord_101",
        dedupeKey: key,
      },
      storage
    );
    const second = queuePixelEvent(
      {
        eventName: "Purchase",
        data: { value: 1999, currency: "INR", order_id: "ord_101" },
        options: { eventID: "ord_101" },
        purchaseOrderId: "ord_101",
        dedupeKey: key,
      },
      storage
    );

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(hasPendingPurchase("ord_101")).toBe(true);
    // Dedupe key must NOT be written at queue time
    expect(storage.getItem(key)).toBeNull();

    const fbq = vi.fn();
    const sent = flushPixelQueue(fbq, storage);
    expect(sent).toBe(1);
    expect(fbq).toHaveBeenCalledWith(
      "track",
      "Purchase",
      { value: 1999, currency: "INR", order_id: "ord_101" },
      { eventID: "ord_101" }
    );
    expect(storage.getItem(key)).toBe("1");

    // A second Purchase for an order whose key already exists queues and sends nothing
    const third = queuePixelEvent(
      {
        eventName: "Purchase",
        data: { value: 1999, currency: "INR", order_id: "ord_101" },
        options: { eventID: "ord_101" },
        purchaseOrderId: "ord_101",
        dedupeKey: key,
      },
      storage
    );
    expect(third).toBe(false);
  });

  it("does not send or write dedupe key if fbq never appears", () => {
    const storage = createMemoryStorage();
    const key = purchaseDedupeKey("ord_never");

    queuePixelEvent(
      {
        eventName: "Purchase",
        data: { value: 500, currency: "INR", order_id: "ord_never" },
        options: { eventID: "ord_never" },
        purchaseOrderId: "ord_never",
        dedupeKey: key,
      },
      storage
    );

    // Without flush, key is never written
    expect(storage.getItem(key)).toBeNull();
    resetPixelQueueForTests();
    expect(storage.getItem(key)).toBeNull();
  });
});
