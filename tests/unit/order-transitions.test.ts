import { describe, it, expect } from "vitest";
import {
  canPaymentTransition,
  canTransition,
  nextStatusOptions,
} from "@/lib/orders/transitions";

describe("Order Transitions Matrix (New Model)", () => {
  describe("canFulfilmentTransition / canTransition", () => {
    it("allows legal fulfilment transitions for RAZORPAY", () => {
      expect(canTransition("RAZORPAY", "CREATED", "CANCELLED")).toBe(true);
      expect(canTransition("RAZORPAY", "PLACED", "SHIPPED")).toBe(true);
      expect(canTransition("RAZORPAY", "PLACED", "CANCELLED")).toBe(true);
      expect(canTransition("RAZORPAY", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("RAZORPAY", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal fulfilment transitions for RAZORPAY", () => {
      expect(canTransition("RAZORPAY", "CREATED", "SHIPPED")).toBe(false);
      expect(canTransition("RAZORPAY", "CREATED", "DELIVERED")).toBe(false);
      expect(canTransition("RAZORPAY", "DELIVERED", "SHIPPED")).toBe(false);
      expect(canTransition("RAZORPAY", "CANCELLED", "CREATED")).toBe(false);
      expect(canTransition("RAZORPAY", "CANCELLED", "PLACED")).toBe(false);
      expect(canTransition("RAZORPAY", "SHIPPED", "CANCELLED")).toBe(false);
    });

    it("allows legal fulfilment transitions for COD", () => {
      expect(canTransition("COD", "PLACED", "SHIPPED")).toBe(true);
      expect(canTransition("COD", "PLACED", "CANCELLED")).toBe(true);
      expect(canTransition("COD", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("COD", "SHIPPED", "CANCELLED")).toBe(true);
      expect(canTransition("COD", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal fulfilment transitions for COD", () => {
      expect(canTransition("COD", "CREATED", "SHIPPED")).toBe(false);
      expect(canTransition("COD", "DELIVERED", "SHIPPED")).toBe(false);
      expect(canTransition("COD", "CANCELLED", "SHIPPED")).toBe(false);
    });

    it("allows legal fulfilment transitions for STORE_CREDIT", () => {
      expect(canTransition("STORE_CREDIT", "PLACED", "SHIPPED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "PLACED", "CANCELLED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal fulfilment transitions for STORE_CREDIT", () => {
      expect(canTransition("STORE_CREDIT", "CREATED", "PLACED")).toBe(false);
      expect(canTransition("STORE_CREDIT", "DELIVERED", "PLACED")).toBe(false);
      expect(canTransition("STORE_CREDIT", "SHIPPED", "CANCELLED")).toBe(false);
    });
  });

  describe("canPaymentTransition", () => {
    it("allows legal payment transitions", () => {
      expect(canPaymentTransition("PENDING", "PAID")).toBe(true);
      expect(canPaymentTransition("PENDING", "FAILED")).toBe(true);
      expect(canPaymentTransition("FAILED", "PAID")).toBe(true);
      expect(canPaymentTransition("COD_PENDING", "COD_COLLECTED")).toBe(true);
      expect(canPaymentTransition("PAID", "PARTIALLY_REFUNDED")).toBe(true);
      expect(canPaymentTransition("PAID", "REFUNDED")).toBe(true);
      expect(canPaymentTransition("COD_COLLECTED", "PARTIALLY_REFUNDED")).toBe(true);
      expect(canPaymentTransition("COD_COLLECTED", "REFUNDED")).toBe(true);
      expect(canPaymentTransition("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
    });

    it("rejects illegal payment transitions", () => {
      expect(canPaymentTransition("PAID", "PENDING")).toBe(false);
      expect(canPaymentTransition("FAILED", "PENDING")).toBe(false);
      expect(canPaymentTransition("REFUNDED", "PAID")).toBe(false);
      expect(canPaymentTransition("COD_COLLECTED", "COD_PENDING")).toBe(false);
      expect(canPaymentTransition("PENDING", "REFUNDED")).toBe(false);
    });
  });

  describe("nextStatusOptions", () => {
    it("never includes payment states in admin manual options", () => {
      const options = nextStatusOptions({ paymentMethod: "RAZORPAY", fulfilmentStatus: "PLACED" });
      expect(options).toContain("SHIPPED");
      expect(options).toContain("CANCELLED");
      expect(options).not.toContain("PAID" as never);
      expect(options).not.toContain("PENDING" as never);
      expect(options).not.toContain("FAILED" as never);
    });

    it("does not allow CANCELLED directly from DELIVERED in admin dropdown (approved return only)", () => {
      const options = nextStatusOptions({ paymentMethod: "RAZORPAY", fulfilmentStatus: "DELIVERED" });
      expect(options).not.toContain("CANCELLED");
      expect(options).toEqual([]);
    });

    it("allows COD PLACED -> SHIPPED, CANCELLED and SHIPPED -> DELIVERED, CANCELLED", () => {
      const placedOpts = nextStatusOptions({ paymentMethod: "COD", fulfilmentStatus: "PLACED" });
      expect(placedOpts).toEqual(["SHIPPED", "CANCELLED"]);

      const shippedOpts = nextStatusOptions({ paymentMethod: "COD", fulfilmentStatus: "SHIPPED" });
      expect(shippedOpts).toEqual(["DELIVERED", "CANCELLED"]);
    });
  });
});
