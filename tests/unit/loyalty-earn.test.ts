import { describe, it, expect } from "vitest";
import { computeLoyaltyEarn } from "@/lib/rewards/loyalty";

describe("rewards/loyalty", () => {
  it("computes flat percentage of non-wallet net goods in integer paise", () => {
    // 100000 goods, 0 refunded, 0 wallet, 200 bps (2%) -> 2000
    expect(
      computeLoyaltyEarn({
        goodsNetPaise: 100000,
        refundedGoodsPaise: 0,
        storeCreditApplied: 0,
        bps: 200,
      })
    ).toEqual({ basePaise: 100000, earnedPaise: 2000 });
  });

  it("excludes wallet share and refunded goods from base", () => {
    // 100000 goods - 30000 refunded - 40000 wallet = 30000 base * 500 bps (5%) = 1500
    expect(
      computeLoyaltyEarn({
        goodsNetPaise: 100000,
        refundedGoodsPaise: 30000,
        storeCreditApplied: 40000,
        bps: 500,
      })
    ).toEqual({ basePaise: 30000, earnedPaise: 1500 });
  });

  it("earns 0 on wallet-only orders, full returns, or 0 bps, and floors fractional paise", () => {
    expect(
      computeLoyaltyEarn({
        goodsNetPaise: 100000,
        refundedGoodsPaise: 0,
        storeCreditApplied: 120000,
        bps: 200,
      })
    ).toEqual({ basePaise: 0, earnedPaise: 0 });

    expect(
      computeLoyaltyEarn({
        goodsNetPaise: 100000,
        refundedGoodsPaise: 100000,
        storeCreditApplied: 0,
        bps: 200,
      })
    ).toEqual({ basePaise: 0, earnedPaise: 0 });

    expect(
      computeLoyaltyEarn({
        goodsNetPaise: 999,
        refundedGoodsPaise: 0,
        storeCreditApplied: 0,
        bps: 200,
      })
    ).toEqual({ basePaise: 999, earnedPaise: 19 });
  });
});
