import { describe, it, expect } from "vitest";
import { formatReturnRefundMethodDescription } from "@/lib/returns/refund-email";

describe("returns/refund-email", () => {
  it("formats single-method refunds as before", () => {
    expect(formatReturnRefundMethodDescription("STORE_CREDIT")).toBe(
      "credited to your Store Credit wallet"
    );
    expect(formatReturnRefundMethodDescription("RAZORPAY")).toBe(
      "initiated to your original payment method"
    );
    expect(
      formatReturnRefundMethodDescription("RAZORPAY", {
        gatewayAmountPaise: 60000,
        walletAmountPaise: 0,
      })
    ).toBe("initiated to your original payment method");
  });

  it("formats split gateway + wallet refunds with both amounts", () => {
    const text = formatReturnRefundMethodDescription("RAZORPAY", {
      gatewayAmountPaise: 60000,
      walletAmountPaise: 40000,
    });
    expect(text).toContain("₹600.00");
    expect(text).toContain("original payment method");
    expect(text).toContain("₹400.00");
    expect(text).toContain("Store Credit wallet");
  });
});
