import { describe, it, expect } from "vitest";
import {
  rupeesToPaise,
  paiseToRupees,
  percentOffConfigSchema,
  flatOffConfigSchema,
  tierConfigSchema,
  comboAnyConfigSchema,
  comboSlotsConfigSchema,
  giftConfigSchema,
  offerInputSchema,
  describeOffer,
} from "./schema";

describe("lib/offers/schema.ts unit tests", () => {
  describe("rupeesToPaise and paiseToRupees money helpers", () => {
    it("converts integer rupees to paise", () => {
      expect(rupeesToPaise(100)).toBe(10000);
      expect(rupeesToPaise("100")).toBe(10000);
      expect(rupeesToPaise(0)).toBe(0);
    });

    it("converts decimal rupees to paise with correct rounding", () => {
      expect(rupeesToPaise(10.5)).toBe(1050);
      expect(rupeesToPaise("10.50")).toBe(1050);
      expect(rupeesToPaise(99.99)).toBe(9999);
      expect(rupeesToPaise(0.01)).toBe(1);
      expect(rupeesToPaise(10.555)).toBe(1056);
      expect(rupeesToPaise("  499.50  ")).toBe(49950);
    });

    it("throws on NaN or invalid inputs", () => {
      expect(() => rupeesToPaise(NaN)).toThrow();
      expect(() => rupeesToPaise("abc")).toThrow();
      expect(() => rupeesToPaise(Infinity)).toThrow();
    });

    it("converts paise to rupees accurately", () => {
      expect(paiseToRupees(10000)).toBe(100);
      expect(paiseToRupees(1050)).toBe(10.5);
      expect(paiseToRupees(9999)).toBe(99.99);
      expect(paiseToRupees(0)).toBe(0);
      expect(() => paiseToRupees(NaN)).toThrow();
    });
  });

  describe("PERCENT_OFF config schema", () => {
    it("accepts valid percent values 1..100", () => {
      expect(percentOffConfigSchema.safeParse({ percent: 15 }).success).toBe(true);
      expect(percentOffConfigSchema.safeParse({ percent: 1 }).success).toBe(true);
      expect(percentOffConfigSchema.safeParse({ percent: 100 }).success).toBe(true);
    });

    it("rejects invalid percent values", () => {
      expect(percentOffConfigSchema.safeParse({ percent: 0 }).success).toBe(false);
      expect(percentOffConfigSchema.safeParse({ percent: 101 }).success).toBe(false);
      expect(percentOffConfigSchema.safeParse({ percent: -5 }).success).toBe(false);
      expect(percentOffConfigSchema.safeParse({ percent: 15.5 }).success).toBe(false);
    });
  });

  describe("FLAT_OFF config schema", () => {
    it("accepts valid amountPaise > 0", () => {
      expect(flatOffConfigSchema.safeParse({ amountPaise: 5000 }).success).toBe(true);
      expect(flatOffConfigSchema.safeParse({ amountPaise: 1 }).success).toBe(true);
    });

    it("rejects 0, negative, or non-integer values", () => {
      expect(flatOffConfigSchema.safeParse({ amountPaise: 0 }).success).toBe(false);
      expect(flatOffConfigSchema.safeParse({ amountPaise: -100 }).success).toBe(false);
      expect(flatOffConfigSchema.safeParse({ amountPaise: 50.5 }).success).toBe(false);
    });
  });

  describe("TIER config schema", () => {
    it("accepts valid strictly ascending tiers up to 6 tiers", () => {
      const valid = {
        tiers: [
          { minQty: 2, type: "PERCENT", value: 10 },
          { minQty: 4, type: "FLAT_PER_UNIT", value: 5000 },
          { minQty: 6, type: "PERCENT", value: 25 },
        ],
      };
      expect(tierConfigSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects non-ascending minQty", () => {
      const invalid = {
        tiers: [
          { minQty: 3, type: "PERCENT", value: 10 },
          { minQty: 2, type: "PERCENT", value: 20 },
        ],
      };
      expect(tierConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects duplicate minQty", () => {
      const invalid = {
        tiers: [
          { minQty: 2, type: "PERCENT", value: 10 },
          { minQty: 2, type: "PERCENT", value: 20 },
        ],
      };
      expect(tierConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects minQty < 2", () => {
      const invalid = {
        tiers: [{ minQty: 1, type: "PERCENT", value: 10 }],
      };
      expect(tierConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects PERCENT value > 100", () => {
      const invalid = {
        tiers: [{ minQty: 2, type: "PERCENT", value: 120 }],
      };
      expect(tierConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects more than 6 tiers", () => {
      const invalid = {
        tiers: [
          { minQty: 2, type: "PERCENT", value: 5 },
          { minQty: 3, type: "PERCENT", value: 10 },
          { minQty: 4, type: "PERCENT", value: 15 },
          { minQty: 5, type: "PERCENT", value: 20 },
          { minQty: 6, type: "PERCENT", value: 25 },
          { minQty: 7, type: "PERCENT", value: 30 },
          { minQty: 8, type: "PERCENT", value: 35 },
        ],
      };
      expect(tierConfigSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("COMBO_ANY config schema", () => {
    it("accepts valid COMBO_ANY settings", () => {
      expect(
        comboAnyConfigSchema.safeParse({
          quantity: 3,
          fixedPricePaise: 99900,
          repeatable: true,
        }).success
      ).toBe(true);
    });

    it("rejects quantity < 2 or non-positive price", () => {
      expect(
        comboAnyConfigSchema.safeParse({
          quantity: 1,
          fixedPricePaise: 99900,
          repeatable: true,
        }).success
      ).toBe(false);
      expect(
        comboAnyConfigSchema.safeParse({
          quantity: 2,
          fixedPricePaise: 0,
          repeatable: true,
        }).success
      ).toBe(false);
    });
  });

  describe("COMBO_SLOTS config schema", () => {
    it("accepts valid COMBO_SLOTS with 2 or more slots", () => {
      const valid = {
        slots: [
          { label: "Top", quantity: 1, selector: { type: "category", id: "cat1" } },
          { label: "Bottom", quantity: 1, selector: { type: "product", id: "prod1" } },
        ],
        fixedPricePaise: 199900,
        repeatable: true,
      };
      expect(comboSlotsConfigSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects fewer than 2 slots", () => {
      const invalid = {
        slots: [{ label: "Single", quantity: 1, selector: { type: "category", id: "cat1" } }],
        fixedPricePaise: 99900,
        repeatable: true,
      };
      expect(comboSlotsConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects invalid slot selectors or non-positive price", () => {
      const invalid = {
        slots: [
          { label: "Top", quantity: 0, selector: { type: "category", id: "cat1" } },
          { label: "Bottom", quantity: 1, selector: { type: "product", id: "" } },
        ],
        fixedPricePaise: 199900,
        repeatable: true,
      };
      expect(comboSlotsConfigSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("GIFT config schema", () => {
    it("accepts valid VARIANT and TEXT gifts", () => {
      expect(
        giftConfigSchema.safeParse({
          buyQty: 2,
          giftQty: 1,
          gift: { type: "VARIANT", variantId: "var_123" },
        }).success
      ).toBe(true);

      expect(
        giftConfigSchema.safeParse({
          buyQty: 0,
          giftQty: 1,
          gift: { type: "TEXT", text: "Free Minimalist Tote Bag" },
        }).success
      ).toBe(true);
    });

    it("rejects negative buyQty or giftQty < 1", () => {
      expect(
        giftConfigSchema.safeParse({
          buyQty: -1,
          giftQty: 1,
          gift: { type: "TEXT", text: "Tote" },
        }).success
      ).toBe(false);

      expect(
        giftConfigSchema.safeParse({
          buyQty: 2,
          giftQty: 0,
          gift: { type: "TEXT", text: "Tote" },
        }).success
      ).toBe(false);
    });

    it("rejects empty text or text > 200 characters", () => {
      expect(
        giftConfigSchema.safeParse({
          buyQty: 1,
          giftQty: 1,
          gift: { type: "TEXT", text: "" },
        }).success
      ).toBe(false);

      expect(
        giftConfigSchema.safeParse({
          buyQty: 1,
          giftQty: 1,
          gift: { type: "TEXT", text: "A".repeat(201) },
        }).success
      ).toBe(false);
    });
  });

  describe("offerInputSchema cross-field validation", () => {
    it("uppercases and enforces regex on coupon code", () => {
      const valid = offerInputSchema.safeParse({
        name: "Test Offer",
        kind: "PERCENT_OFF",
        code: "  summer-20_sale  ",
        config: { percent: 20 },
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.code).toBe("SUMMER-20_SALE");
      }

      // Invalid code characters
      expect(
        offerInputSchema.safeParse({
          name: "Test Offer",
          kind: "PERCENT_OFF",
          code: "SUMMER 20",
          config: { percent: 20 },
        }).success
      ).toBe(false);

      // Too short
      expect(
        offerInputSchema.safeParse({
          name: "Test Offer",
          kind: "PERCENT_OFF",
          code: "AB",
          config: { percent: 20 },
        }).success
      ).toBe(false);
    });

    it("enforces endsAt > startsAt", () => {
      const invalid = offerInputSchema.safeParse({
        name: "Test Offer",
        kind: "PERCENT_OFF",
        startsAt: new Date("2026-06-02"),
        endsAt: new Date("2026-06-01"),
        config: { percent: 10 },
      });
      expect(invalid.success).toBe(false);

      const equal = offerInputSchema.safeParse({
        name: "Test Offer",
        kind: "PERCENT_OFF",
        startsAt: new Date("2026-06-01T10:00:00Z"),
        endsAt: new Date("2026-06-01T10:00:00Z"),
        config: { percent: 10 },
      });
      expect(equal.success).toBe(false);

      const valid = offerInputSchema.safeParse({
        name: "Test Offer",
        kind: "PERCENT_OFF",
        startsAt: new Date("2026-06-01"),
        endsAt: new Date("2026-06-02"),
        config: { percent: 10 },
      });
      expect(valid.success).toBe(true);
    });

    it("COMBO_SLOTS rejects offer-level targets", () => {
      const res = offerInputSchema.safeParse({
        name: "Combo Slots Offer",
        kind: "COMBO_SLOTS",
        config: {
          slots: [
            { label: "Top", quantity: 1, selector: { type: "category", id: "c1" } },
            { label: "Bottom", quantity: 1, selector: { type: "category", id: "c2" } },
          ],
          fixedPricePaise: 199900,
          repeatable: true,
        },
        targets: [{ type: "category", id: "c1" }],
      });
      expect(res.success).toBe(false);
    });

    it("deduplicates targets by type:id", () => {
      const res = offerInputSchema.safeParse({
        name: "Target Dedupe",
        kind: "PERCENT_OFF",
        config: { percent: 10 },
        targets: [
          { type: "category", id: "c1" },
          { type: "category", id: "c1" },
          { type: "product", id: "p1" },
          { type: "category", id: "c2" },
          { type: "product", id: "p1" },
        ],
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.targets).toHaveLength(3);
        expect(res.data.targets).toEqual([
          { type: "category", id: "c1" },
          { type: "product", id: "p1" },
          { type: "category", id: "c2" },
        ]);
      }
    });
  });

  describe("describeOffer helper", () => {
    it("formats PERCENT_OFF correctly", () => {
      expect(describeOffer({ kind: "PERCENT_OFF", config: { percent: 20 } })).toBe("20% off");
      expect(
        describeOffer({ kind: "PERCENT_OFF", config: { percent: 15 }, minCartPaise: 100000 })
      ).toBe("15% off (min cart ₹1000)");
    });

    it("formats FLAT_OFF correctly", () => {
      expect(describeOffer({ kind: "FLAT_OFF", config: { amountPaise: 50000 } })).toBe("₹500 off");
    });

    it("formats TIER correctly", () => {
      expect(
        describeOffer({
          kind: "TIER",
          config: {
            tiers: [
              { minQty: 2, type: "PERCENT", value: 10 },
              { minQty: 3, type: "PERCENT", value: 20 },
            ],
          },
        })
      ).toBe("Tiered: Buy 2+ (10%), 3+ (20%)");
    });

    it("formats COMBO_ANY correctly", () => {
      expect(
        describeOffer({
          kind: "COMBO_ANY",
          config: { quantity: 3, fixedPricePaise: 199900 },
        })
      ).toBe("Any 3 for ₹1999");
    });

    it("formats COMBO_SLOTS correctly", () => {
      expect(
        describeOffer({
          kind: "COMBO_SLOTS",
          config: {
            slots: [
              { label: "Shirt", quantity: 1, selector: { type: "category", id: "c1" } },
              { label: "Trouser", quantity: 1, selector: { type: "category", id: "c2" } },
            ],
            fixedPricePaise: 249900,
          },
        })
      ).toBe("Bundle: 1x Shirt + 1x Trouser for ₹2499");
    });

    it("formats GIFT correctly", () => {
      expect(
        describeOffer({
          kind: "GIFT",
          config: { buyQty: 2, giftQty: 1, gift: { type: "VARIANT", variantId: "v1" } },
        })
      ).toBe("Buy 2, get 1 free gift item");

      expect(
        describeOffer({
          kind: "GIFT",
          config: { buyQty: 0, giftQty: 1, gift: { type: "TEXT", text: "Minimalist Tote" } },
        })
      ).toBe("Free \"Minimalist Tote\" with order");
    });
  });
});
