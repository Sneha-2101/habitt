import { describe, it, expect } from "vitest";
import { evaluateOffers, OfferShape, CartLineInput } from "@/lib/offers/evaluate";

describe("lib/offers/evaluate pure engine", () => {
  const baseNow = new Date("2026-11-20T12:00:00Z");

  const createLine = (opts: Partial<CartLineInput> & { lineId: string; unitPricePaise: number; qty: number }): CartLineInput => ({
    lineId: opts.lineId,
    productId: opts.productId || `prod_${opts.lineId}`,
    variantId: opts.variantId || `var_${opts.lineId}`,
    categoryId: opts.categoryId || null,
    collectionIds: opts.collectionIds || [],
    unitPricePaise: opts.unitPricePaise,
    qty: opts.qty,
    costPaise: opts.costPaise,
  });

  const createOffer = (opts: Partial<OfferShape> & { id: string; kind: OfferShape["kind"] }): OfferShape => ({
    id: opts.id,
    name: opts.name || `Offer ${opts.id}`,
    kind: opts.kind,
    code: opts.code !== undefined ? opts.code : null,
    active: opts.active !== undefined ? opts.active : true,
    startsAt: opts.startsAt !== undefined ? opts.startsAt : null,
    endsAt: opts.endsAt !== undefined ? opts.endsAt : null,
    minCartPaise: opts.minCartPaise !== undefined ? opts.minCartPaise : 0,
    maxUsesTotal: opts.maxUsesTotal !== undefined ? opts.maxUsesTotal : null,
    maxUsesPerCustomer: opts.maxUsesPerCustomer !== undefined ? opts.maxUsesPerCustomer : null,
    priority: opts.priority !== undefined ? opts.priority : 100,
    audience: opts.audience || "ALL",
    config: opts.config || {},
    targets: opts.targets || [],
  });

  describe("Rule 1: Eligibility per offer", () => {
    it("rejects inactive offer or offer outside startsAt/endsAt window", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const inactiveOffer = createOffer({ id: "o1", kind: "PERCENT_OFF", active: false, config: { percent: 20 } });
      const expiredOffer = createOffer({
        id: "o2",
        kind: "PERCENT_OFF",
        endsAt: new Date("2026-11-19T00:00:00Z"),
        config: { percent: 20 },
      });
      const futureOffer = createOffer({
        id: "o3",
        kind: "PERCENT_OFF",
        startsAt: new Date("2026-11-25T00:00:00Z"),
        config: { percent: 20 },
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [inactiveOffer, expiredOffer, futureOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.applied).toHaveLength(0);
      expect(res.totalDiscountPaise).toBe(0);
    });

    it("respects audience conditions (FIRST_ORDER, BIRTHDAY)", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const welcomeOffer = createOffer({ id: "w1", kind: "PERCENT_OFF", audience: "FIRST_ORDER", config: { percent: 10 } });
      const bdayOffer = createOffer({ id: "b1", kind: "PERCENT_OFF", audience: "BIRTHDAY", config: { percent: 15 } });

      // Non-eligible audience
      const resIneligible = evaluateOffers({
        lines: [line],
        offers: [welcomeOffer, bdayOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resIneligible.applied).toHaveLength(0);

      // Eligible audience
      const resEligible = evaluateOffers({
        lines: [line],
        offers: [welcomeOffer, bdayOffer],
        audienceContext: { isFirstOrder: true, isBirthdayWindow: true },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resEligible.applied.length).toBeGreaterThanOrEqual(1);
    });

    it("enforces minCartPaise and usage limits (total and by customer)", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 5000, qty: 1 });
      const minCartOffer = createOffer({ id: "m1", kind: "PERCENT_OFF", minCartPaise: 10000, config: { percent: 10 } });
      const limitedOffer = createOffer({
        id: "lim1",
        kind: "PERCENT_OFF",
        maxUsesTotal: 5,
        maxUsesPerCustomer: 1,
        config: { percent: 10 },
      });

      // Cart 5000 < minCart 10000
      const resMin = evaluateOffers({
        lines: [line],
        offers: [minCartOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resMin.applied).toHaveLength(0);

      // Usage limit exceeded
      const usageMap = new Map([["lim1", { total: 5, byCustomer: 0 }]]);
      const resLimit = evaluateOffers({
        lines: [line],
        offers: [limitedOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: usageMap,
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resLimit.applied).toHaveLength(0);
    });

    it("matches targets correctly on category, product, or collection", () => {
      const lineMatched = createLine({
        lineId: "L1",
        productId: "p1",
        categoryId: "c1",
        collectionIds: ["col1"],
        unitPricePaise: 10000,
        qty: 1,
      });
      const lineUnmatched = createLine({
        lineId: "L2",
        productId: "p2",
        categoryId: "c2",
        collectionIds: ["col2"],
        unitPricePaise: 10000,
        qty: 1,
      });

      const offerProductTarget = createOffer({
        id: "tp",
        kind: "PERCENT_OFF",
        config: { percent: 10 },
        targets: [{ productId: "p1" }],
      });

      const res = evaluateOffers({
        lines: [lineMatched, lineUnmatched],
        offers: [offerProductTarget],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.lines.find((l) => l.lineId === "L1")?.discountPaise).toBe(1000);
      expect(res.lines.find((l) => l.lineId === "L2")?.discountPaise).toBe(0);
      expect(res.totalDiscountPaise).toBe(1000);
    });
  });

  describe("Rule 2: Automatic offers stacking & unit exclusion", () => {
    it("applies automatic offers in ascending priority order", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const offerP1 = createOffer({ id: "op1", kind: "PERCENT_OFF", priority: 10, config: { percent: 10 } });
      const offerP2 = createOffer({ id: "op2", kind: "PERCENT_OFF", priority: 20, config: { percent: 10 } });

      const res = evaluateOffers({
        lines: [line],
        offers: [offerP2, offerP1], // Passed out of order
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.applied[0].offerId).toBe("op1");
      expect(res.applied[1].offerId).toBe("op2");
    });

    it("excludes units consumed by combo from subsequent automatic discounts", () => {
      // 3 units of p1 at 10000 each.
      // Combo consumes 2 units for fixed price 15000 (saving 5000).
      // Remaining 1 unit gets 10% percent-off = 1000 discount.
      // Total discount = 5000 + 1000 = 6000.
      const line = createLine({ lineId: "L1", productId: "p1", unitPricePaise: 10000, qty: 3 });
      const comboOffer = createOffer({
        id: "c1",
        kind: "COMBO_ANY",
        priority: 10,
        config: { quantity: 2, fixedPricePaise: 15000, repeatable: false },
      });
      const percentOffer = createOffer({
        id: "p1",
        kind: "PERCENT_OFF",
        priority: 20,
        config: { percent: 10 },
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [comboOffer, percentOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.applied).toHaveLength(2);
      expect(res.applied.find((a) => a.offerId === "c1")?.amountPaise).toBe(5000);
      expect(res.applied.find((a) => a.offerId === "p1")?.amountPaise).toBe(1000);
      expect(res.totalDiscountPaise).toBe(6000);
    });
  });

  describe("Rule 3: TIER offers", () => {
    it("applies PERCENT tier at boundary and highest matching tier", () => {
      const tierOffer = createOffer({
        id: "t1",
        kind: "TIER",
        config: {
          tiers: [
            { minQty: 2, type: "PERCENT", value: 10 },
            { minQty: 5, type: "PERCENT", value: 20 },
          ],
        },
      });

      // 1 unit: 0% discount
      const res1 = evaluateOffers({
        lines: [createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 })],
        offers: [tierOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(res1.totalDiscountPaise).toBe(0);

      // 2 units (boundary): 10% of 20000 = 2000
      const res2 = evaluateOffers({
        lines: [createLine({ lineId: "L1", unitPricePaise: 10000, qty: 2 })],
        offers: [tierOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(res2.totalDiscountPaise).toBe(2000);

      // 5 units (upper boundary): 20% of 50000 = 10000
      const res5 = evaluateOffers({
        lines: [createLine({ lineId: "L1", unitPricePaise: 10000, qty: 5 })],
        offers: [tierOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(res5.totalDiscountPaise).toBe(10000);
    });

    it("applies FLAT_PER_UNIT tier correctly", () => {
      const tierOffer = createOffer({
        id: "t2",
        kind: "TIER",
        config: {
          tiers: [{ minQty: 3, type: "FLAT_PER_UNIT", value: 2000 }],
        },
      });

      // 3 units at 10000 each: discount is 3 * 2000 = 6000
      const res = evaluateOffers({
        lines: [createLine({ lineId: "L1", unitPricePaise: 10000, qty: 3 })],
        offers: [tierOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(res.totalDiscountPaise).toBe(6000);
    });
  });

  describe("Rule 4: FLAT_OFF offers", () => {
    it("spreads flat discount proportionally across eligible lines and caps at subtotal", () => {
      const l1 = createLine({ lineId: "L1", unitPricePaise: 3000, qty: 1 });
      const l2 = createLine({ lineId: "L2", unitPricePaise: 7000, qty: 1 });
      const flatOffer = createOffer({ id: "f1", kind: "FLAT_OFF", config: { amountPaise: 5000 } });

      const res = evaluateOffers({
        lines: [l1, l2],
        offers: [flatOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(5000);
      const d1 = res.lines.find((l) => l.lineId === "L1")?.discountPaise;
      const d2 = res.lines.find((l) => l.lineId === "L2")?.discountPaise;
      expect(d1! + d2!).toBe(5000);
      expect(d1).toBe(1500); // 30% of 5000
      expect(d2).toBe(3500); // 70% of 5000
    });

    it("does not discount above eligible line subtotal", () => {
      const l1 = createLine({ lineId: "L1", unitPricePaise: 2000, qty: 1 });
      const excessiveFlat = createOffer({ id: "f2", kind: "FLAT_OFF", config: { amountPaise: 50000 } });

      const res = evaluateOffers({
        lines: [l1],
        offers: [excessiveFlat],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(2000);
      expect(res.lines[0].discountPaise).toBe(2000);
    });
  });

  describe("Rule 5: COMBO_ANY offers", () => {
    it("forms groups choosing most-expensive units first to maximize customer savings", () => {
      // 3 items: 10000, 8000, 4000.
      // Combo quantity = 2, fixedPrice = 12000.
      // Most expensive pair: 10000 + 8000 = 18000 -> fixedPrice 12000 saves 6000.
      // Cheapest pair: 8000 + 4000 = 12000 -> fixedPrice 12000 saves 0!
      // Must choose most-expensive first, customer saves 6000!
      const l1 = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const l2 = createLine({ lineId: "L2", unitPricePaise: 8000, qty: 1 });
      const l3 = createLine({ lineId: "L3", unitPricePaise: 4000, qty: 1 });

      const combo = createOffer({
        id: "cmb1",
        kind: "COMBO_ANY",
        config: { quantity: 2, fixedPricePaise: 12000, repeatable: false },
      });

      const res = evaluateOffers({
        lines: [l1, l2, l3],
        offers: [combo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(6000);
      expect(res.applied[0].amountPaise).toBe(6000);
    });

    it("skips combo if group list price is less than fixedPrice (no saving)", () => {
      const l1 = createLine({ lineId: "L1", unitPricePaise: 3000, qty: 2 });
      // List price 6000 < fixedPrice 8000 -> 0 discount
      const badCombo = createOffer({
        id: "bad_cmb",
        kind: "COMBO_ANY",
        config: { quantity: 2, fixedPricePaise: 8000, repeatable: true },
      });

      const res = evaluateOffers({
        lines: [l1],
        offers: [badCombo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(0);
      expect(res.applied).toHaveLength(0);
    });

    it("respects repeatable flag for COMBO_ANY", () => {
      const l1 = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 4 });
      // 4 units, quantity 2, fixedPrice 15000.
      // Non-repeatable: 1 group saves 5000.
      const nonRepCombo = createOffer({
        id: "c_nr",
        kind: "COMBO_ANY",
        config: { quantity: 2, fixedPricePaise: 15000, repeatable: false },
      });
      const resNR = evaluateOffers({
        lines: [l1],
        offers: [nonRepCombo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resNR.totalDiscountPaise).toBe(5000);

      // Repeatable: 2 groups save 10000.
      const repCombo = createOffer({
        id: "c_r",
        kind: "COMBO_ANY",
        config: { quantity: 2, fixedPricePaise: 15000, repeatable: true },
      });
      const resR = evaluateOffers({
        lines: [l1],
        offers: [repCombo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });
      expect(resR.totalDiscountPaise).toBe(10000);
    });
  });

  describe("Rule 6: COMBO_SLOTS offers", () => {
    it("fulfills slots matching selector, choosing most expensive units first", () => {
      // Slot 1: Shirt (p_shirt, 15000)
      // Slot 2: Pant (p_pant, 25000)
      // Bundle fixed price: 30000 (total list = 40000, saving = 10000)
      const shirt = createLine({ lineId: "L1", productId: "p_shirt", unitPricePaise: 15000, qty: 1 });
      const pant = createLine({ lineId: "L2", productId: "p_pant", unitPricePaise: 25000, qty: 1 });

      const slotsCombo = createOffer({
        id: "cmb_slots",
        kind: "COMBO_SLOTS",
        config: {
          fixedPricePaise: 30000,
          repeatable: false,
          slots: [
            { label: "Shirt", quantity: 1, selector: { type: "product", id: "p_shirt" } },
            { label: "Pant", quantity: 1, selector: { type: "product", id: "p_pant" } },
          ],
        },
      });

      const res = evaluateOffers({
        lines: [shirt, pant],
        offers: [slotsCombo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(10000);
      expect(res.applied[0].amountPaise).toBe(10000);
    });

    it("does not allow units to fill multiple slots simultaneously", () => {
      // Only 1 shirt available, but slot 1 and slot 2 both need a shirt -> combo cannot form
      const shirt = createLine({ lineId: "L1", productId: "p_shirt", unitPricePaise: 15000, qty: 1 });
      const doubleSlotCombo = createOffer({
        id: "cmb_double",
        kind: "COMBO_SLOTS",
        config: {
          fixedPricePaise: 20000,
          repeatable: false,
          slots: [
            { label: "Shirt 1", quantity: 1, selector: { type: "product", id: "p_shirt" } },
            { label: "Shirt 2", quantity: 1, selector: { type: "product", id: "p_shirt" } },
          ],
        },
      });

      const res = evaluateOffers({
        lines: [shirt],
        offers: [doubleSlotCombo],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(0);
      expect(res.applied).toHaveLength(0);
    });
  });

  describe("Rule 7: GIFT offers", () => {
    it("returns variant and text gift specifications", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const variantGiftOffer = createOffer({
        id: "g_var",
        kind: "GIFT",
        config: { buyQty: 0, giftQty: 1, gift: { type: "VARIANT", variantId: "gift_var_1" } },
      });
      const textGiftOffer = createOffer({
        id: "g_txt",
        kind: "GIFT",
        config: { buyQty: 0, giftQty: 2, gift: { type: "TEXT", text: "Free Stickers Pack" } },
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [variantGiftOffer, textGiftOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.gifts).toHaveLength(2);
      expect(res.gifts.find((g) => g.type === "VARIANT")?.variantId).toBe("gift_var_1");
      expect(res.gifts.find((g) => g.type === "TEXT")?.text).toBe("Free Stickers Pack");
      expect(res.gifts.find((g) => g.type === "TEXT")?.qty).toBe(2);
    });

    it("respects minCartPaise for gift offers", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 5000, qty: 1 });
      const giftOffer = createOffer({
        id: "g_min",
        kind: "GIFT",
        minCartPaise: 10000,
        config: { buyQty: 0, giftQty: 1, gift: { type: "TEXT", text: "Special Tote Bag" } },
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [giftOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.gifts).toHaveLength(0);
    });
  });

  describe("Rule 8: Exclusive coupon better-of", () => {
    it("applies coupon when coupon discount is strictly greater than automatic offers", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const autoOffer = createOffer({ id: "auto", kind: "PERCENT_OFF", config: { percent: 10 } }); // 1000 paise
      const couponOffer = createOffer({ id: "cpn", kind: "PERCENT_OFF", code: "SAVE20", config: { percent: 20 } }); // 2000 paise

      const res = evaluateOffers({
        lines: [line],
        offers: [autoOffer],
        couponOffer,
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.couponResult?.accepted).toBe(true);
      expect(res.totalDiscountPaise).toBe(2000);
      expect(res.applied).toHaveLength(1);
      expect(res.applied[0].offerId).toBe("cpn");
    });

    it("rejects coupon with COUPON_NOT_BETTER when automatic offers give equal or better discount", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      const autoOffer = createOffer({ id: "auto", kind: "PERCENT_OFF", config: { percent: 25 } }); // 2500 paise
      const couponOffer = createOffer({ id: "cpn", kind: "PERCENT_OFF", code: "SAVE15", config: { percent: 15 } }); // 1500 paise

      const res = evaluateOffers({
        lines: [line],
        offers: [autoOffer],
        couponOffer,
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.couponResult?.accepted).toBe(false);
      expect(res.couponResult?.rejectionCode).toBe("COUPON_NOT_BETTER");
      expect(res.totalDiscountPaise).toBe(2500);
      expect(res.applied[0].offerId).toBe("auto");
    });

    it("rejects 0-effect coupon with COUPON_NO_EFFECT", () => {
      const line = createLine({ lineId: "L1", productId: "p1", unitPricePaise: 10000, qty: 1 });
      // Coupon targeted to p2 only -> 0 effect on cart
      const couponTargeted = createOffer({
        id: "cpn_none",
        kind: "PERCENT_OFF",
        code: "ONLYP2",
        config: { percent: 20 },
        targets: [{ productId: "p2" }],
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [],
        couponOffer: couponTargeted,
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.couponResult?.accepted).toBe(false);
      expect(res.couponResult?.rejectionCode).toBe("COUPON_NO_EFFECT");
      expect(res.totalDiscountPaise).toBe(0);
    });
  });

  describe("Rule 9: Global discount cap", () => {
    it("clamps total discount to global discountCapPercent", () => {
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1 });
      // 80% discount offer, but site cap is 50%
      const bigOffer = createOffer({ id: "big", kind: "PERCENT_OFF", config: { percent: 80 } });

      const res = evaluateOffers({
        lines: [line],
        offers: [bigOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: 50 },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(5000);
      expect(res.lines[0].discountPaise).toBe(5000);
      expect(res.warnings.some((w) => w.code === "CAP_APPLIED")).toBe(true);
    });
  });

  describe("Rule 10: Cost floor without leaking cost", () => {
    it("ensures line discount never reduces unit price below costPaise", () => {
      // Unit price 10000, cost 7000. Max allowable discount is 3000.
      const line = createLine({ lineId: "L1", unitPricePaise: 10000, qty: 1, costPaise: 7000 });
      const bigOffer = createOffer({ id: "huge", kind: "PERCENT_OFF", config: { percent: 50 } }); // Wants 5000

      const res = evaluateOffers({
        lines: [line],
        offers: [bigOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(3000);
      expect(res.lines[0].discountPaise).toBe(3000);
      expect(res.warnings.some((w) => w.code === "COST_FLOOR_APPLIED")).toBe(true);

      // Verify no cost property leaked in output
      const jsonString = JSON.stringify(res);
      expect(jsonString).not.toContain("7000");
      expect(jsonString).not.toContain("cost");
    });
  });

  describe("Rule 11: Largest remainder sum invariant", () => {
    it("guarantees sum(line discounts) === totalDiscountPaise exactly on odd divisions", () => {
      // 3 lines with odd prices, flat discount 1000
      const l1 = createLine({ lineId: "L1", unitPricePaise: 3333, qty: 1 });
      const l2 = createLine({ lineId: "L2", unitPricePaise: 3333, qty: 1 });
      const l3 = createLine({ lineId: "L3", unitPricePaise: 3334, qty: 1 });
      const flat = createOffer({ id: "flat_odd", kind: "FLAT_OFF", config: { amountPaise: 1000 } });

      const res = evaluateOffers({
        lines: [l1, l2, l3],
        offers: [flat],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      const lineSum = res.lines.reduce((s, l) => s + l.discountPaise, 0);
      expect(lineSum).toBe(1000);
      expect(res.totalDiscountPaise).toBe(1000);
    });
  });

  describe("Rule 12: Dangling IDs handled gracefully", () => {
    it("handles targets pointing to non-existent category, collection, or product without crashing", () => {
      const line = createLine({ lineId: "L1", productId: "p1", categoryId: "c1", unitPricePaise: 10000, qty: 1 });
      const danglingOffer = createOffer({
        id: "dangling",
        kind: "PERCENT_OFF",
        config: { percent: 15 },
        targets: [
          { productId: "non_existent_prod" },
          { categoryId: "non_existent_cat" },
          { collectionId: "non_existent_col" },
        ],
      });

      const res = evaluateOffers({
        lines: [line],
        offers: [danglingOffer],
        audienceContext: { isFirstOrder: false, isBirthdayWindow: false },
        usageCounts: new Map(),
        settings: { discountCapPercent: null },
        now: baseNow,
      });

      expect(res.totalDiscountPaise).toBe(0);
      expect(res.applied).toHaveLength(0);
    });
  });

  describe("Property Test: 200 random carts", () => {
    it("preserves sum invariant, non-negativity, and cap invariant across 200 random configurations", () => {
      const rng = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

      for (let run = 0; run < 200; run++) {
        const lineCount = rng(1, 5);
        const lines: CartLineInput[] = [];
        let cartSubtotal = 0;

        for (let i = 0; i < lineCount; i++) {
          const unitPricePaise = rng(500, 20000);
          const qty = rng(1, 4);
          cartSubtotal += unitPricePaise * qty;
          lines.push(
            createLine({
              lineId: `L_${run}_${i}`,
              productId: `prod_${i}`,
              categoryId: `cat_${rng(1, 3)}`,
              collectionIds: [`col_${rng(1, 2)}`],
              unitPricePaise,
              qty,
            })
          );
        }

        const capPercent = run % 2 === 0 ? rng(20, 60) : null;
        const autoOffers: OfferShape[] = [
          createOffer({
            id: `o_pct_${run}`,
            kind: "PERCENT_OFF",
            priority: 10,
            config: { percent: rng(5, 30) },
          }),
          createOffer({
            id: `o_flt_${run}`,
            kind: "FLAT_OFF",
            priority: 20,
            config: { amountPaise: rng(500, 5000) },
          }),
        ];

        const res = evaluateOffers({
          lines,
          offers: autoOffers,
          audienceContext: { isFirstOrder: run % 3 === 0, isBirthdayWindow: run % 4 === 0 },
          usageCounts: new Map(),
          settings: { discountCapPercent: capPercent },
          now: baseNow,
        });

        // 1. Invariant: sum(lines.discountPaise) === totalDiscountPaise
        const lineSum = res.lines.reduce((s, l) => s + l.discountPaise, 0);
        expect(lineSum).toBe(res.totalDiscountPaise);

        // 2. Invariant: no line below 0 and no line above its line total
        for (const line of lines) {
          const dl = res.lines.find((l) => l.lineId === line.lineId);
          expect(dl).toBeDefined();
          expect(dl!.discountPaise).toBeGreaterThanOrEqual(0);
          expect(dl!.discountPaise).toBeLessThanOrEqual(line.unitPricePaise * line.qty);
        }

        // 3. Invariant: total discount never exceeds cart subtotal
        expect(res.totalDiscountPaise).toBeLessThanOrEqual(cartSubtotal);

        // 4. Invariant: cap respected if set
        if (capPercent !== null) {
          const maxAllowed = Math.floor((cartSubtotal * capPercent) / 100);
          expect(res.totalDiscountPaise).toBeLessThanOrEqual(maxAllowed);
        }
      }
    });
  });
});
