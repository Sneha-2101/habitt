export interface QueuedPixelEvent {
  eventName: string;
  data?: Record<string, unknown>;
  options?: { eventID?: string };
  purchaseOrderId?: string;
  dedupeKey?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type FbqTrackFn = (
  command: string,
  eventName: string,
  params?: Record<string, unknown>,
  eventData?: { eventID?: string }
) => void;

const pendingQueue: QueuedPixelEvent[] = [];
const pendingPurchaseOrderIds = new Set<string>();

export function queuePixelEvent(
  evt: QueuedPixelEvent,
  storage?: Pick<StorageLike, "getItem"> | null
): boolean {
  if (evt.purchaseOrderId) {
    if (pendingPurchaseOrderIds.has(evt.purchaseOrderId)) {
      return false;
    }
    if (evt.dedupeKey && storage) {
      try {
        if (storage.getItem(evt.dedupeKey) === "1") {
          return false;
        }
      } catch {
        // ignore storage read errors
      }
    }
    pendingPurchaseOrderIds.add(evt.purchaseOrderId);
  }

  pendingQueue.push(evt);
  return true;
}

export function flushPixelQueue(
  fbq: FbqTrackFn,
  storage?: StorageLike | null
): number {
  const items = pendingQueue.splice(0, pendingQueue.length);
  let sentCount = 0;

  for (const evt of items) {
    if (evt.purchaseOrderId) {
      pendingPurchaseOrderIds.delete(evt.purchaseOrderId);
      if (evt.dedupeKey && storage) {
        try {
          if (storage.getItem(evt.dedupeKey) === "1") {
            continue;
          }
        } catch {
          // ignore storage read errors
        }
      }
    }

    fbq("track", evt.eventName, evt.data, evt.options);
    sentCount++;

    if (evt.purchaseOrderId && evt.dedupeKey && storage) {
      try {
        storage.setItem(evt.dedupeKey, "1");
      } catch {
        // ignore storage write errors
      }
    }
  }

  return sentCount;
}

export function hasPendingPurchase(orderId: string): boolean {
  return pendingPurchaseOrderIds.has(orderId);
}

export function resetPixelQueueForTests(): void {
  pendingQueue.length = 0;
  pendingPurchaseOrderIds.clear();
}
