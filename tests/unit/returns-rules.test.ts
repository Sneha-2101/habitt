import { describe, it, expect } from "vitest";
import {
  isReturnWindowOpen,
  remainingReturnableQty,
  computeRefund,
} from "@/lib/returns/rules";
import { canTransition } from "@/lib/returns/transitions";

describe("Returns Rules & Transitions", () => {
  describe("isReturnWindowOpen", () => {
    it("returns true on Day 7 and false on Day 8 in IST", () => {
      // Delivered on Nov 1, 2026 at 10:00 IST
      const deliveredAt = new Date("2026-11-01T10:00:00+05:30");

      // Same day (Day 0)
      expect(isReturnWindowOpen(deliveredAt, new Date("2026-11-01T20:00:00+05:30"), 7)).toBe(true);

      // Day 7 in IST (Nov 8 at 23:30 IST) -> OPEN
      expect(isReturnWindowOpen(deliveredAt, new Date("2026-11-08T23:30:00+05:30"), 7)).toBe(true);

      // Day 8 in IST (Nov 9 at 00:01 IST) -> EXPIRED
      expect(isReturnWindowOpen(deliveredAt, new Date("2026-11-09T00:01:00+05:30"), 7)).toBe(false);

      // Null or invalid deliveredAt returns false
      expect(isReturnWindowOpen(null, new Date())).toBe(false);
      expect(isReturnWindowOpen(undefined, new Date())).toBe(false);
    });
  });

  describe("remainingReturnableQty", () => {
    it("returns remaining quantity and caps at 0", () => {
      expect(remainingReturnableQty({ qty: 5, isGift: false }, 2)).toBe(3);
      expect(remainingReturnableQty({ qty: 5, isGift: false }, 5)).toBe(0);
      expect(remainingReturnableQty({ qty: 5, isGift: false }, 6)).toBe(0);
    });

    it("excludes free gifts completely (always 0)", () => {
      expect(remainingReturnableQty({ qty: 1, isGift: true }, 0)).toBe(0);
      expect(remainingReturnableQty({ qty: 3, isGift: true }, 0)).toBe(0);
    });
  });

  describe("canTransition", () => {
    it("validates legal return lifecycle transitions", () => {
      // From REQUESTED
      expect(canTransition("REQUESTED", "APPROVED")).toBe(true);
      expect(canTransition("REQUESTED", "REJECTED")).toBe(true);
      expect(canTransition("REQUESTED", "CANCELLED")).toBe(true);
      expect(canTransition("REQUESTED", "RECEIVED")).toBe(false);
      expect(canTransition("REQUESTED", "REFUNDED")).toBe(false);

      // From APPROVED
      expect(canTransition("APPROVED", "RECEIVED")).toBe(true);
      expect(canTransition("APPROVED", "REJECTED")).toBe(false);
      expect(canTransition("APPROVED", "CANCELLED")).toBe(false);

      // From RECEIVED
      expect(canTransition("RECEIVED", "REFUNDED")).toBe(true);
      expect(canTransition("RECEIVED", "CANCELLED")).toBe(false);

      // From Terminal statuses
      expect(canTransition("REJECTED", "APPROVED")).toBe(false);
      expect(canTransition("CANCELLED", "REQUESTED")).toBe(false);
      expect(canTransition("REFUNDED", "REQUESTED")).toBe(false);
    });
  });

  describe("computeRefund", () => {
    it("ensures discounted line partial returns sum exactly to line net when fully returned", () => {
      // Line: qty 3, unitPrice 100000 (1000 Rs), discountPaise 10000 (100 Rs)
      // Total net = 3 * 100000 - 10000 = 290000 paise (2900 Rs)
      const item = {
        id: "item1",
        unitPrice: 100000,
        qty: 3,
        discountPaise: 10000,
      };

      // Return 1: 1 unit returned (existing: 0)
      const res1 = computeRefund({
        orderItems: [item],
        returningQtys: { item1: 1 },
        existingReturnedQtys: { item1: 0 },
        existingRefundedPaise: { item1: 0 },
      });
      expect(res1.itemRefunds.item1).toBe(96667);
      expect(res1.isCompleteReturn).toBe(false);

      // Return 2: 1 unit returned (existing: 1)
      const res2 = computeRefund({
        orderItems: [item],
        returningQtys: { item1: 1 },
        existingReturnedQtys: { item1: 1 },
        existingRefundedPaise: { item1: res1.itemRefunds.item1 },
      });
      expect(res2.itemRefunds.item1).toBe(96667);
      expect(res2.isCompleteReturn).toBe(false);

      // Return 3: 1 unit returned (existing: 2, final return!)
      const res3 = computeRefund({
        orderItems: [item],
        returningQtys: { item1: 1 },
        existingReturnedQtys: { item1: 2 },
        existingRefundedPaise: { item1: res1.itemRefunds.item1 + res2.itemRefunds.item1 },
      });
      expect(res3.itemRefunds.item1).toBe(96666);
      expect(res3.isCompleteReturn).toBe(true);

      // Sum of all 3 partial returns:
      const totalItemRefund =
        res1.itemRefunds.item1 + res2.itemRefunds.item1 + res3.itemRefunds.item1;
      expect(totalItemRefund).toBe(290000);
    });

    it("refunds shipping and COD fees only on final completion of all non-gift items", () => {
      const item1 = { id: "item1", unitPrice: 50000, qty: 1, isGift: false };
      const item2 = { id: "item2", unitPrice: 80000, qty: 1, isGift: false };
      const gift = { id: "gift1", unitPrice: 0, qty: 1, isGift: true };

      const shippingFee = 9900;
      const codFee = 5000;

      // Partial return: only item1
      const res1 = computeRefund({
        orderItems: [item1, item2, gift],
        returningQtys: { item1: 1 },
        existingReturnedQtys: { item1: 0, item2: 0, gift1: 0 },
        shippingFeePaise: shippingFee,
        codFeePaise: codFee,
      });

      expect(res1.isCompleteReturn).toBe(false);
      expect(res1.shippingFeeRefundPaise).toBe(0);
      expect(res1.codFeeRefundPaise).toBe(0);
      expect(res1.feesRefundPaise).toBe(0);
      expect(res1.totalRefundPaise).toBe(50000);

      // Final return: item2 returned (item1 already returned in res1)
      const res2 = computeRefund({
        orderItems: [item1, item2, gift],
        returningQtys: { item2: 1 },
        existingReturnedQtys: { item1: 1, item2: 0, gift1: 0 },
        shippingFeePaise: shippingFee,
        codFeePaise: codFee,
      });

      expect(res2.isCompleteReturn).toBe(true);
      expect(res2.shippingFeeRefundPaise).toBe(9900);
      expect(res2.codFeeRefundPaise).toBe(5000);
      expect(res2.feesRefundPaise).toBe(14900);
      expect(res2.totalRefundPaise).toBe(80000 + 14900);
    });

    it("property loop of 200 random orders: total refunded never exceeds paid and never negative", () => {
      for (let i = 0; i < 200; i++) {
        // Generate 1-4 random non-gift items
        const numItems = 1 + Math.floor(Math.random() * 4);
        const orderItems: Array<{ id: string; unitPrice: number; qty: number; discountPaise: number; isGift: boolean }> = [];
        let subtotal = 0;
        let totalDiscount = 0;

        for (let j = 0; j < numItems; j++) {
          const unitPrice = 1000 + Math.floor(Math.random() * 50000); // 10 to 500 Rs
          const qty = 1 + Math.floor(Math.random() * 5); // 1 to 5 qty
          const lineTotal = unitPrice * qty;
          const discountPaise = Math.floor(Math.random() * Math.min(lineTotal, 5000));
          orderItems.push({
            id: `item_${i}_${j}`,
            unitPrice,
            qty,
            discountPaise,
            isGift: false,
          });
          subtotal += lineTotal;
          totalDiscount += discountPaise;
        }

        const shippingFeePaise = Math.random() > 0.5 ? 9900 : 0;
        const codFeePaise = Math.random() > 0.5 ? 5000 : 0;
        const totalPaidPaise = subtotal - totalDiscount + shippingFeePaise + codFeePaise;

        // Simulate returning all items in random steps (1 to 3 batches)
        const returnedQtys: Record<string, number> = {};
        const refundedPaise: Record<string, number> = {};
        let cumRefunded = 0;
        let feesRefunded = false;

        const remainingToReturn: Record<string, number> = {};
        for (const itm of orderItems) {
          remainingToReturn[itm.id] = itm.qty;
          returnedQtys[itm.id] = 0;
          refundedPaise[itm.id] = 0;
        }

        while (Object.values(remainingToReturn).some((r) => r > 0)) {
          const returningInBatch: Record<string, number> = {};
          let anyReturned = false;

          for (const itm of orderItems) {
            const rem = remainingToReturn[itm.id];
            if (rem > 0) {
              const returning = 1 + Math.floor(Math.random() * rem);
              returningInBatch[itm.id] = returning;
              anyReturned = true;
            }
          }

          if (!anyReturned) break;

          const res = computeRefund({
            orderItems,
            returningQtys: returningInBatch,
            existingReturnedQtys: returnedQtys,
            existingRefundedPaise: refundedPaise,
            shippingFeePaise,
            codFeePaise,
            feesAlreadyRefunded: feesRefunded,
            totalPaidPaise,
            cumulativeRefundedPaise: cumRefunded,
          });

          // Invariant 1: Batch refund is never negative
          expect(res.totalRefundPaise).toBeGreaterThanOrEqual(0);

          cumRefunded += res.totalRefundPaise;

          // Invariant 2: Cumulative refund never exceeds amount paid
          expect(cumRefunded).toBeLessThanOrEqual(totalPaidPaise);

          if (res.feesRefundPaise > 0) {
            feesRefunded = true;
          }

          for (const [id, q] of Object.entries(returningInBatch)) {
            remainingToReturn[id] -= q;
            returnedQtys[id] += q;
            refundedPaise[id] = (refundedPaise[id] || 0) + (res.itemRefunds[id] || 0);
          }
        }

        // Invariant 3: When fully returned, cumulative refund equals total paid
        expect(cumRefunded).toBe(totalPaidPaise);
      }
    });
  });
});
