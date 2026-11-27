import { describe, it, expect } from "vitest";
import { isCountableOrder, summarizeInfluencerOrders } from "@/lib/influencers/stats";

describe("influencers/stats", () => {
  it("isCountableOrder returns true for delivered/paid and false for cancelled or failed payment", () => {
    expect(isCountableOrder("DELIVERED", "PAID")).toBe(true);
    expect(isCountableOrder("PLACED", "COD_PENDING")).toBe(true);
    expect(isCountableOrder("CANCELLED", "PAID")).toBe(false);
    expect(isCountableOrder("CREATED", "FAILED")).toBe(false);
    expect(isCountableOrder("CANCELLED", "FAILED")).toBe(false);
    expect(isCountableOrder("RTO", "PAID")).toBe(false);
  });
  it("returns zeros for empty input", () => {
    expect(summarizeInfluencerOrders([])).toEqual({
      ordersPlaced: 0,
      ordersDelivered: 0,
      goodsSalesPaise: 0,
      refundedGoodsPaise: 0,
      netGoodsPaise: 0,
      couponOrders: 0,
      linkOrders: 0,
      selfOrders: 0,
    });
  });

  it("excludes cancelled/failed, computes goods = total - shipping - codFee, subtracts refunds, and clamps per-order net >= 0", () => {
    const summary = summarizeInfluencerOrders([
      {
        orderId: "o1",
        orderNumber: "HAB-1",
        createdAt: new Date(),
        paymentStatus: "PAID",
        fulfilmentStatus: "DELIVERED",
        totalPaise: 214900, // 200000 goods + 9900 shipping + 5000 cod
        shippingPaise: 9900,
        codFeePaise: 5000,
        refundedGoodsPaise: 50000,
        discountPaise: 0,
        source: "COUPON",
        isSelfOrder: false,
      },
      {
        orderId: "o2",
        orderNumber: "HAB-2",
        createdAt: new Date(),
        paymentStatus: "PAID",
        fulfilmentStatus: "SHIPPED",
        totalPaise: 100000,
        shippingPaise: 0,
        codFeePaise: 0,
        refundedGoodsPaise: 120000, // exceeds goods -> clamped to 0 net for this order
        discountPaise: 0,
        source: "LINK",
        isSelfOrder: true,
      },
      {
        orderId: "o3",
        orderNumber: "HAB-3",
        createdAt: new Date(),
        paymentStatus: "PAID",
        fulfilmentStatus: "CANCELLED",
        totalPaise: 500000,
        shippingPaise: 0,
        codFeePaise: 0,
        refundedGoodsPaise: 0,
        discountPaise: 0,
        source: "COUPON",
        isSelfOrder: false,
      },
      {
        orderId: "o4",
        orderNumber: "HAB-4",
        createdAt: new Date(),
        paymentStatus: "FAILED",
        fulfilmentStatus: "CREATED",
        totalPaise: 500000,
        shippingPaise: 0,
        codFeePaise: 0,
        refundedGoodsPaise: 0,
        discountPaise: 0,
        source: "LINK",
        isSelfOrder: false,
      },
    ]);

    expect(summary).toEqual({
      ordersPlaced: 2,
      ordersDelivered: 1,
      goodsSalesPaise: 300000,
      refundedGoodsPaise: 170000,
      netGoodsPaise: 150000, // o1: 150000, o2: 0
      couponOrders: 1,
      linkOrders: 1,
      selfOrders: 1,
    });
  });
});
