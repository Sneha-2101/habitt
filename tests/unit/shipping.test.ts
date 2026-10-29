import { describe, it, expect } from "vitest";
import { calcShippingAndFees } from "@/lib/pricing/shipping";

describe("calcShippingAndFees unit tests", () => {
  const baseSettings = {
    shippingFee: 100,
    freeShippingThreshold: 1000,
    freeShippingOnPrepaid: true,
    codFeeEnabled: true,
    codFee: 50,
  };

  it("prepaid (RAZORPAY) is free at any amount when freeShippingOnPrepaid is true", () => {
    const res = calcShippingAndFees({
      paymentMethod: "RAZORPAY",
      subtotal: 250,
      settings: baseSettings,
    });
    expect(res.shippingFee).toBe(0);
    expect(res.shippingNote).toBe("FREE_PREPAID");
    expect(res.codFee).toBe(0);
  });

  it("STORE_CREDIT counts as prepaid and is free at any amount when freeShippingOnPrepaid is true", () => {
    const res = calcShippingAndFees({
      paymentMethod: "STORE_CREDIT",
      subtotal: 100,
      settings: baseSettings,
    });
    expect(res.shippingFee).toBe(0);
    expect(res.shippingNote).toBe("FREE_PREPAID");
    expect(res.codFee).toBe(0);
  });

  it("COD under threshold charges shippingFee and adds COD fee if enabled", () => {
    const res = calcShippingAndFees({
      paymentMethod: "COD",
      subtotal: 500,
      settings: baseSettings,
    });
    expect(res.shippingFee).toBe(100);
    expect(res.shippingNote).toBe("CHARGED");
    expect(res.codFee).toBe(50);
  });

  it("COD over threshold gives free shipping (FREE_THRESHOLD) with COD fee if enabled", () => {
    const res = calcShippingAndFees({
      paymentMethod: "COD",
      subtotal: 1500,
      settings: baseSettings,
    });
    expect(res.shippingFee).toBe(0);
    expect(res.shippingNote).toBe("FREE_THRESHOLD");
    expect(res.codFee).toBe(50);
  });

  it("COD fee off returns codFee: 0", () => {
    const res = calcShippingAndFees({
      paymentMethod: "COD",
      subtotal: 500,
      settings: { ...baseSettings, codFeeEnabled: false },
    });
    expect(res.shippingFee).toBe(100);
    expect(res.codFee).toBe(0);
  });

  it("freeShippingOnPrepaid: false falls back to threshold rule for prepaid", () => {
    const settingsNoPrepaidFree = {
      ...baseSettings,
      freeShippingOnPrepaid: false,
    };

    // Under threshold -> charges shipping fee
    const under = calcShippingAndFees({
      paymentMethod: "RAZORPAY",
      subtotal: 500,
      settings: settingsNoPrepaidFree,
    });
    expect(under.shippingFee).toBe(100);
    expect(under.shippingNote).toBe("CHARGED");

    // Over threshold -> free shipping via threshold
    const over = calcShippingAndFees({
      paymentMethod: "RAZORPAY",
      subtotal: 1200,
      settings: settingsNoPrepaidFree,
    });
    expect(over.shippingFee).toBe(0);
    expect(over.shippingNote).toBe("FREE_THRESHOLD");
  });
});

