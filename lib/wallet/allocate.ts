export interface AllocatableLot {
  id: string;
  remainingPaise: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface LotAllocation {
  lotId: string;
  amountPaise: number;
  newRemainingPaise: number;
}

export interface AllocateResult {
  allocations: LotAllocation[];
  totalAllocatedPaise: number;
  shortfallPaise: number;
}

/**
 * Compute total active (non-expired, remainingPaise > 0) balance in paise.
 */
export function computeActiveWalletBalance(
  lots: ReadonlyArray<Pick<AllocatableLot, "remainingPaise" | "expiresAt">>,
  now: Date = new Date()
): number {
  const nowMs = now.getTime();
  let total = 0;
  for (const lot of lots) {
    if (lot.remainingPaise <= 0) continue;
    if (lot.expiresAt !== null && lot.expiresAt.getTime() <= nowMs) continue;
    total += lot.remainingPaise;
  }
  return total;
}

/**
 * Pure FIFO / earliest-expiry-first allocation across wallet lots.
 * Expiring lots are consumed before non-expiring lots (expiresAt ASC, nulls last),
 * then oldest createdAt ASC, then id ASC.
 */
export function allocateWalletDebit(
  lots: ReadonlyArray<AllocatableLot>,
  amountPaise: number,
  now: Date = new Date()
): AllocateResult {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("Debit amount must be a positive integer (paise).");
  }

  const nowMs = now.getTime();
  const eligible = lots
    .filter(
      (lot) =>
        lot.remainingPaise > 0 &&
        (lot.expiresAt === null || lot.expiresAt.getTime() > nowMs)
    )
    .slice()
    .sort((a, b) => {
      if (a.expiresAt !== null && b.expiresAt !== null) {
        const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
        if (diff !== 0) return diff;
      } else if (a.expiresAt !== null) {
        return -1;
      } else if (b.expiresAt !== null) {
        return 1;
      }

      const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdDiff !== 0) return createdDiff;

      return a.id.localeCompare(b.id);
    });

  let remainingToAllocate = amountPaise;
  const allocations: LotAllocation[] = [];

  for (const lot of eligible) {
    if (remainingToAllocate <= 0) break;
    const take = Math.min(lot.remainingPaise, remainingToAllocate);
    allocations.push({
      lotId: lot.id,
      amountPaise: take,
      newRemainingPaise: lot.remainingPaise - take,
    });
    remainingToAllocate -= take;
  }

  return {
    allocations,
    totalAllocatedPaise: amountPaise - remainingToAllocate,
    shortfallPaise: remainingToAllocate,
  };
}
