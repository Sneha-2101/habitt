import { describe, it, expect } from "vitest";
import { canTransition, nextStatusOptions, LEGAL_TRANSITIONS } from "@/lib/orders/transitions";

describe("Order Transitions Matrix", () => {
  describe("canTransition", () => {
    it("allows legal transitions for RAZORPAY", () => {
      expect(canTransition("RAZORPAY", "PENDING", "PAID")).toBe(true);
      expect(canTransition("RAZORPAY", "PENDING", "FAILED")).toBe(true);
      expect(canTransition("RAZORPAY", "PENDING", "CANCELLED")).toBe(true);
      expect(canTransition("RAZORPAY", "PAID", "SHIPPED")).toBe(true);
      expect(canTransition("RAZORPAY", "PAID", "CANCELLED")).toBe(true);
      expect(canTransition("RAZORPAY", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("RAZORPAY", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal transitions for RAZORPAY", () => {
      expect(canTransition("RAZORPAY", "PENDING", "SHIPPED")).toBe(false);
      expect(canTransition("RAZORPAY", "DELIVERED", "PAID")).toBe(false);
      expect(canTransition("RAZORPAY", "CANCELLED", "PENDING")).toBe(false);
      expect(canTransition("RAZORPAY", "CANCELLED", "PAID")).toBe(false);
      expect(canTransition("RAZORPAY", "SHIPPED", "CANCELLED")).toBe(false);
    });

    it("allows legal transitions for COD", () => {
      expect(canTransition("COD", "PENDING", "SHIPPED")).toBe(true);
      expect(canTransition("COD", "PENDING", "CANCELLED")).toBe(true);
      expect(canTransition("COD", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("COD", "SHIPPED", "CANCELLED")).toBe(true);
      expect(canTransition("COD", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal transitions for COD", () => {
      expect(canTransition("COD", "PENDING", "PAID")).toBe(false);
      expect(canTransition("COD", "DELIVERED", "SHIPPED")).toBe(false);
      expect(canTransition("COD", "CANCELLED", "SHIPPED")).toBe(false);
    });

    it("allows legal transitions for STORE_CREDIT", () => {
      expect(canTransition("STORE_CREDIT", "PAID", "SHIPPED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "PAID", "CANCELLED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "SHIPPED", "DELIVERED")).toBe(true);
      expect(canTransition("STORE_CREDIT", "DELIVERED", "CANCELLED")).toBe(true);
    });

    it("rejects illegal transitions for STORE_CREDIT", () => {
      expect(canTransition("STORE_CREDIT", "PAID", "FAILED")).toBe(false);
      expect(canTransition("STORE_CREDIT", "DELIVERED", "PAID")).toBe(false);
    });
  });

  describe("nextStatusOptions", () => {
    it("never includes PAID, PENDING, or FAILED in admin manual options", () => {
      const options = nextStatusOptions({ paymentMethod: "RAZORPAY", status: "PENDING" });
      expect(options).not.toContain("PAID");
      expect(options).not.toContain("PENDING");
      expect(options).not.toContain("FAILED");
      expect(options).toContain("CANCELLED");
    });

    it("does not allow CANCELLED directly from DELIVERED in admin dropdown (approved return only)", () => {
      const options = nextStatusOptions({ paymentMethod: "RAZORPAY", status: "DELIVERED" });
      expect(options).not.toContain("CANCELLED");
    });
  });
});

