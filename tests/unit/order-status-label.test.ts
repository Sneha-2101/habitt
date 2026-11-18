import { describe, it, expect } from "vitest";
import {
  legacyStage,
  getOrderStatusLabel,
  legacyEventStage,
} from "@/lib/orders/status-label";

describe("Order Status Label & Legacy Stage helper", () => {
  describe("legacyStage - backfill mapping combinations", () => {
    it("maps all RAZORPAY combinations correctly", () => {
      // 1. PENDING, CREATED -> PENDING
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PENDING",
          fulfilmentStatus: "CREATED",
        })
      ).toBe("PENDING");

      // 2. PAID, PLACED -> PAID
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PAID");

      // 3. PAID, SHIPPED -> SHIPPED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "SHIPPED",
        })
      ).toBe("SHIPPED");

      // 4. PAID, DELIVERED -> DELIVERED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "DELIVERED",
        })
      ).toBe("DELIVERED");

      // 5. FAILED, CREATED -> FAILED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "FAILED",
          fulfilmentStatus: "CREATED",
        })
      ).toBe("FAILED");

      // 6. PENDING, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PENDING",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // 7. PAID, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // 8. PARTIALLY_REFUNDED, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "PARTIALLY_REFUNDED",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // 9. REFUNDED, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "RAZORPAY",
          paymentStatus: "REFUNDED",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");
    });

    it("maps all COD combinations correctly", () => {
      // 1. COD_PENDING, PLACED -> PENDING
      expect(
        legacyStage({
          paymentMethod: "COD",
          paymentStatus: "COD_PENDING",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PENDING");

      // 2. COD_PENDING, SHIPPED -> SHIPPED
      expect(
        legacyStage({
          paymentMethod: "COD",
          paymentStatus: "COD_PENDING",
          fulfilmentStatus: "SHIPPED",
        })
      ).toBe("SHIPPED");

      // 3. COD_COLLECTED, DELIVERED -> DELIVERED
      expect(
        legacyStage({
          paymentMethod: "COD",
          paymentStatus: "COD_COLLECTED",
          fulfilmentStatus: "DELIVERED",
        })
      ).toBe("DELIVERED");

      // 4. COD_PENDING, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "COD",
          paymentStatus: "COD_PENDING",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");
    });

    it("maps all STORE_CREDIT combinations correctly", () => {
      // 1. PAID, PLACED -> PAID
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "PAID",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PAID");

      // 2. PAID, SHIPPED -> SHIPPED
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "PAID",
          fulfilmentStatus: "SHIPPED",
        })
      ).toBe("SHIPPED");

      // 3. PAID, DELIVERED -> DELIVERED
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "PAID",
          fulfilmentStatus: "DELIVERED",
        })
      ).toBe("DELIVERED");

      // 4. PAID, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "PAID",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // 5. PARTIALLY_REFUNDED, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "PARTIALLY_REFUNDED",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // 6. REFUNDED, CANCELLED -> CANCELLED
      expect(
        legacyStage({
          paymentMethod: "STORE_CREDIT",
          paymentStatus: "REFUNDED",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");
    });
  });

  describe("getOrderStatusLabel", () => {
    it("returns correct stage, chipClass, and adminClass for each state", () => {
      const paid = getOrderStatusLabel({
        paymentMethod: "RAZORPAY",
        paymentStatus: "PAID",
        fulfilmentStatus: "PLACED",
      });
      expect(paid.stage).toBe("PAID");
      expect(paid.chipClass).toContain("emerald");
      expect(paid.adminClass).toBe("text-moss");

      const shipped = getOrderStatusLabel({
        paymentMethod: "COD",
        paymentStatus: "COD_PENDING",
        fulfilmentStatus: "SHIPPED",
      });
      expect(shipped.stage).toBe("SHIPPED");
      expect(shipped.chipClass).toContain("blue");

      const cancelled = getOrderStatusLabel({
        paymentMethod: "RAZORPAY",
        paymentStatus: "FAILED",
        fulfilmentStatus: "CANCELLED",
      });
      expect(cancelled.stage).toBe("CANCELLED");
      expect(cancelled.adminClass).toBe("text-clay");
    });

    it("displays refund labels when refunded", () => {
      const refunded = getOrderStatusLabel({
        paymentMethod: "RAZORPAY",
        paymentStatus: "REFUNDED",
        fulfilmentStatus: "CANCELLED",
      });
      expect(refunded.label).toBe("Refunded");

      const partial = getOrderStatusLabel({
        paymentMethod: "RAZORPAY",
        paymentStatus: "PARTIALLY_REFUNDED",
        fulfilmentStatus: "CANCELLED",
      });
      expect(partial.label).toBe("Partially Refunded");
    });
  });

  describe("legacyEventStage", () => {
    it("handles backfilled events correctly", () => {
      // (null, "SHIPPED") -> "SHIPPED"
      expect(
        legacyEventStage({ paymentStatus: null, fulfilmentStatus: "SHIPPED" })
      ).toBe("SHIPPED");

      // (null, "DELIVERED") -> "DELIVERED"
      expect(
        legacyEventStage({ paymentStatus: null, fulfilmentStatus: "DELIVERED" })
      ).toBe("DELIVERED");

      // ("PAID", "PLACED") -> "PAID"
      expect(
        legacyEventStage({ paymentStatus: "PAID", fulfilmentStatus: "PLACED" })
      ).toBe("PAID");

      // ("FAILED", null) -> "FAILED"
      expect(
        legacyEventStage({ paymentStatus: "FAILED", fulfilmentStatus: null })
      ).toBe("FAILED");

      // (null, "CREATED") -> "PENDING"
      expect(
        legacyEventStage({ paymentStatus: null, fulfilmentStatus: "CREATED" })
      ).toBe("PENDING");

      // (null, "PLACED") -> "PENDING"
      expect(
        legacyEventStage({ paymentStatus: null, fulfilmentStatus: "PLACED" })
      ).toBe("PENDING");
    });

    it("handles new events correctly", () => {
      // ("COD_PENDING", "PLACED") -> "PENDING"
      expect(
        legacyEventStage({
          paymentStatus: "COD_PENDING",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PENDING");

      // ("PAID", "PLACED") -> "PAID"
      expect(
        legacyEventStage({
          paymentStatus: "PAID",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PAID");

      // ("PAID", "SHIPPED") -> "SHIPPED"
      expect(
        legacyEventStage({
          paymentStatus: "PAID",
          fulfilmentStatus: "SHIPPED",
        })
      ).toBe("SHIPPED");

      // ("COD_COLLECTED", "DELIVERED") -> "DELIVERED"
      expect(
        legacyEventStage({
          paymentStatus: "COD_COLLECTED",
          fulfilmentStatus: "DELIVERED",
        })
      ).toBe("DELIVERED");

      // ("REFUNDED", "CANCELLED") -> "CANCELLED"
      expect(
        legacyEventStage({
          paymentStatus: "REFUNDED",
          fulfilmentStatus: "CANCELLED",
        })
      ).toBe("CANCELLED");

      // ("PENDING", "CREATED") -> "PENDING"
      expect(
        legacyEventStage({
          paymentStatus: "PENDING",
          fulfilmentStatus: "CREATED",
        })
      ).toBe("PENDING");

      // ("PAID", "PLACED") address-edit event -> "PAID"
      expect(
        legacyEventStage({
          paymentStatus: "PAID",
          fulfilmentStatus: "PLACED",
        })
      ).toBe("PAID");
    });
  });
});
