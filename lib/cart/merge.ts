export interface CartLineInput {
  productId?: string;
  variantId: string;
  qty: number;
  [key: string]: unknown;
}

export interface MergedCartItem {
  productId: string;
  variantId: string;
  qty: number;
}

export interface MergeCartsResult {
  items: MergedCartItem[];
  dropped: number;
}

/**
 * Pure cart merge function:
 * - Takes per-variant MAX of server and local qty (capped at 10)
 * - Drops variants not present in validVariantIds
 * - Drops invalid quantities (non-integers or < 1)
 * - Retains server-first order, then local additions
 * - Caps the final cart at 20 distinct lines, dropping any excess
 */
export function mergeCarts(
  serverItems: CartLineInput[] = [],
  localItems: CartLineInput[] = [],
  validVariantIds: Set<string>
): MergeCartsResult {
  let dropped = 0;
  const orderedVariantIds: string[] = [];
  const variantMap = new Map<string, { productId: string; qty: number }>();

  function processItem(item: CartLineInput) {
    if (!item || typeof item !== "object") {
      dropped++;
      return;
    }

    const { variantId, qty, productId } = item;

    if (!variantId || typeof variantId !== "string") {
      dropped++;
      return;
    }

    // Check validity of variant
    if (!validVariantIds.has(variantId)) {
      dropped++;
      return;
    }

    // Qty must be integer >= 1
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) {
      dropped++;
      return;
    }

    const existing = variantMap.get(variantId);
    if (existing) {
      existing.qty = Math.max(existing.qty, qty);
      if (productId && !existing.productId) {
        existing.productId = productId;
      }
    } else {
      orderedVariantIds.push(variantId);
      variantMap.set(variantId, {
        productId: productId || "",
        qty,
      });
    }
  }

  // Server lines first
  for (const item of serverItems) {
    processItem(item);
  }

  // Local lines second
  for (const item of localItems) {
    processItem(item);
  }

  const allLines: MergedCartItem[] = [];

  for (const variantId of orderedVariantIds) {
    const entry = variantMap.get(variantId)!;
    allLines.push({
      variantId,
      productId: entry.productId,
      qty: Math.min(entry.qty, 10),
    });
  }

  // Max 20 distinct lines
  if (allLines.length > 20) {
    dropped += allLines.length - 20;
    return {
      items: allLines.slice(0, 20),
      dropped,
    };
  }

  return {
    items: allLines,
    dropped,
  };
}

export interface ResolveCartSyncInput<T extends CartLineInput = CartLineInput> {
  ownerId: string | null;
  userId: string;
  serverItems: T[];
  localItems: T[];
  validVariantIds?: Set<string>;
}

export interface ResolveCartSyncResult<T extends CartLineInput = CartLineInput> {
  mode: "load" | "merge";
  items: T[] | MergedCartItem[];
  dropped: number;
}

/**
 * Pure helper deciding sync mode:
 * - ownerId === userId -> "load" (server wins, local ignored)
 * - ownerId === null (true guest) -> "merge"
 * - ownerId set to a different user -> "load" (discard other person's local items)
 */
export function resolveCartSync<T extends CartLineInput = CartLineInput>({
  ownerId,
  userId,
  serverItems,
  localItems,
  validVariantIds,
}: ResolveCartSyncInput<T>): ResolveCartSyncResult<T> {
  if (ownerId === userId) {
    return {
      mode: "load",
      items: serverItems,
      dropped: 0,
    };
  }

  if (ownerId === null) {
    const validSet =
      validVariantIds ??
      new Set([
        ...serverItems.map((i) => i.variantId),
        ...localItems.map((i) => i.variantId),
      ]);
    const merged = mergeCarts(serverItems, localItems, validSet);
    return {
      mode: "merge",
      items: merged.items,
      dropped: merged.dropped,
    };
  }

  // ownerId is set to a different user -> discard local, server wins
  return {
    mode: "load",
    items: serverItems,
    dropped: localItems.length,
  };
}
