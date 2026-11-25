import { describe, it, expect } from "vitest";
import {
  allocateWalletDebit,
  computeActiveWalletBalance,
  type AllocatableLot,
} from "@/lib/wallet/allocate";

describe("wallet/allocate", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  const makeLot = (overrides: Partial<AllocatableLot>): AllocatableLot => ({
    id: "lot-1",
    remainingPaise: 10000,
    expiresAt: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    ...overrides,
  });

  it("excludes expired and empty lots when computing active balance", () => {
    const lots: AllocatableLot[] = [
      makeLot({ id: "expired-past", remainingPaise: 5000, expiresAt: new Date("2026-05-31T23:59:59.000Z") }),
      makeLot({ id: "expired-exact", remainingPaise: 5000, expiresAt: now }),
      makeLot({ id: "empty", remainingPaise: 0, expiresAt: null }),
      makeLot({ id: "active-promo", remainingPaise: 3000, expiresAt: new Date("2026-06-10T00:00:00.000Z") }),
      makeLot({ id: "active-refund", remainingPaise: 7000, expiresAt: null }),
    ];

    expect(computeActiveWalletBalance(lots, now)).toBe(10000);
  });

  it("allocates earliest-expiring lots first, then non-expiring by createdAt then id", () => {
    const lots: AllocatableLot[] = [
      makeLot({ id: "refund-b", remainingPaise: 5000, expiresAt: null, createdAt: new Date("2026-05-02T00:00:00.000Z") }),
      makeLot({ id: "promo-later", remainingPaise: 4000, expiresAt: new Date("2026-06-20T00:00:00.000Z"), createdAt: new Date("2026-05-05T00:00:00.000Z") }),
      makeLot({ id: "promo-soon", remainingPaise: 3000, expiresAt: new Date("2026-06-05T00:00:00.000Z"), createdAt: new Date("2026-05-10T00:00:00.000Z") }),
      makeLot({ id: "refund-a", remainingPaise: 5000, expiresAt: null, createdAt: new Date("2026-05-01T00:00:00.000Z") }),
    ];

    const res = allocateWalletDebit(lots, 9000, now);
    expect(res.shortfallPaise).toBe(0);
    expect(res.totalAllocatedPaise).toBe(9000);
    expect(res.allocations).toEqual([
      { lotId: "promo-soon", amountPaise: 3000, newRemainingPaise: 0 },
      { lotId: "promo-later", amountPaise: 4000, newRemainingPaise: 0 },
      { lotId: "refund-a", amountPaise: 2000, newRemainingPaise: 3000 },
    ]);
  });

  it("reports shortfall when requested debit exceeds active balance", () => {
    const lots: AllocatableLot[] = [
      makeLot({ id: "lot-a", remainingPaise: 2500 }),
    ];
    const res = allocateWalletDebit(lots, 4000, now);
    expect(res.totalAllocatedPaise).toBe(2500);
    expect(res.shortfallPaise).toBe(1500);
    expect(res.allocations).toEqual([
      { lotId: "lot-a", amountPaise: 2500, newRemainingPaise: 0 },
    ]);
  });

  it("rejects non-positive or non-integer debit amounts", () => {
    const lots: AllocatableLot[] = [makeLot({ remainingPaise: 5000 })];
    expect(() => allocateWalletDebit(lots, 0, now)).toThrow();
    expect(() => allocateWalletDebit(lots, -100, now)).toThrow();
    expect(() => allocateWalletDebit(lots, 12.5, now)).toThrow();
  });
});
