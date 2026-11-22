import { describe, it, expect } from "vitest";
import {
  extractInclusiveTax,
  splitTax,
  allocateLargestRemainder,
  computeInvoiceLines,
} from "@/lib/gst/tax";
import { normalizeState, isSameState } from "@/lib/gst/states";
import { getIndianFinancialYear } from "@/lib/gst/financial-year";
import { formatInvoiceNumber, formatCreditNoteNumber } from "@/lib/gst/numbering";

describe("GST Pure Calculation Engine", () => {
  describe("1. Inclusive Tax Extraction", () => {
    it("extracts tax from Rs 1999 at 5%", () => {
      // 199900 paise at 5% GST
      // taxable = round(199900 * 100 / 105) = 190381
      // tax = 199900 - 190381 = 9519
      const { taxablePaise, taxPaise } = extractInclusiveTax(199900, 5);
      expect(taxablePaise).toBe(190381);
      expect(taxPaise).toBe(9519);
      expect(taxablePaise + taxPaise).toBe(199900);
    });

    it("extracts tax from Rs 1999 at 18%", () => {
      // 199900 paise at 18% GST
      // taxable = round(199900 * 100 / 118) = 169407
      // tax = 199900 - 169407 = 30493
      const { taxablePaise, taxPaise } = extractInclusiveTax(199900, 18);
      expect(taxablePaise).toBe(169407);
      expect(taxPaise).toBe(30493);
      expect(taxablePaise + taxPaise).toBe(199900);
    });

    it("handles zero amount or zero rate", () => {
      expect(extractInclusiveTax(0, 18)).toEqual({ taxablePaise: 0, taxPaise: 0 });
      expect(extractInclusiveTax(10000, 0)).toEqual({ taxablePaise: 10000, taxPaise: 0 });
    });
  });

  describe("2. CGST / SGST / IGST Splitting", () => {
    it("splits odd paise with extra paisa going to CGST", () => {
      // 9519 tax: CGST = ceil(9519 / 2) = 4760, SGST = 9519 - 4760 = 4759
      const { cgstPaise, sgstPaise, igstPaise } = splitTax(9519, false);
      expect(cgstPaise).toBe(4760);
      expect(sgstPaise).toBe(4759);
      expect(igstPaise).toBe(0);
      expect(cgstPaise + sgstPaise).toBe(9519);
    });

    it("splits even paise equally between CGST and SGST", () => {
      const { cgstPaise, sgstPaise, igstPaise } = splitTax(10000, false);
      expect(cgstPaise).toBe(5000);
      expect(sgstPaise).toBe(5000);
      expect(igstPaise).toBe(0);
    });

    it("allocates full tax to IGST for inter-state orders", () => {
      const { cgstPaise, sgstPaise, igstPaise } = splitTax(9519, true);
      expect(cgstPaise).toBe(0);
      expect(sgstPaise).toBe(0);
      expect(igstPaise).toBe(9519);
    });
  });

  describe("3. Largest Remainder Allocation", () => {
    it("preserves sum invariant across uneven shares", () => {
      const distributed = allocateLargestRemainder(100, [33, 33, 33]);
      expect(distributed.reduce((a, b) => a + b, 0)).toBe(100);
      expect(distributed).toEqual([34, 33, 33]);
    });

    it("handles zero weights", () => {
      const distributed = allocateLargestRemainder(10, [0, 0]);
      expect(distributed.reduce((a, b) => a + b, 0)).toBe(10);
      expect(distributed).toEqual([5, 5]);
    });
  });

  describe("4. State Normalization and Comparison", () => {
    it("normalizes state abbreviations, codes, and names", () => {
      expect(normalizeState("DL")?.name).toBe("Delhi");
      expect(normalizeState("delhi")?.code).toBe("DL");
      expect(normalizeState("07")?.name).toBe("Delhi");
      expect(normalizeState("Maharashtra")?.tin).toBe("27");
      expect(normalizeState("MH")?.name).toBe("Maharashtra");
      expect(normalizeState("KA")?.name).toBe("Karnataka");
    });

    it("identifies same state vs inter-state correctly", () => {
      expect(isSameState("DL", "Delhi")).toBe(true);
      expect(isSameState("07", "delhi")).toBe(true);
      expect(isSameState("MH", "Maharashtra")).toBe(true);
      expect(isSameState("DL", "MH")).toBe(false);
      expect(isSameState("Delhi", "Karnataka")).toBe(false);
      expect(isSameState("UnknownState", "Delhi")).toBe(false);
    });
  });

  describe("5. Financial Year Boundaries", () => {
    it("calculates FY correctly in IST across March 31 / April 1 boundary", () => {
      // 31 March 2026 23:59:00 IST -> FY 2025-26
      // 2026-03-31T23:59:00+05:30 is 2026-03-31T18:29:00.000Z
      const mar31 = new Date("2026-03-31T18:29:00.000Z");
      expect(getIndianFinancialYear(mar31)).toBe("2025-26");

      // 1 April 2026 00:01:00 IST -> FY 2026-27
      // 2026-04-01T00:01:00+05:30 is 2026-03-31T18:31:00.000Z
      const apr01 = new Date("2026-03-31T18:31:00.000Z");
      expect(getIndianFinancialYear(apr01)).toBe("2026-27");
    });
  });

  describe("6. Number Formatting", () => {
    it("formats invoice and credit note numbers with 5-digit padding", () => {
      expect(formatInvoiceNumber("HB", "2026-27", 1)).toBe("HB/2026-27/00001");
      expect(formatInvoiceNumber("HB", "2026-27", 42)).toBe("HB/2026-27/00042");
      expect(formatCreditNoteNumber("HB", "2026-27", 1)).toBe("HB/CN/2026-27/00001");
    });
  });

  describe("7. Invoice Line Computation Scenarios", () => {
    it("gift lines appear at 0 value with 0 tax", () => {
      const res = computeInvoiceLines({
        items: [
          {
            description: "Free Socks",
            qty: 1,
            unitPricePaise: 20000,
            discountPaise: 0,
            isGift: true,
          },
        ],
        shippingFeePaise: 0,
        codFeePaise: 0,
        feeMode: "COMPOSITE",
        buyerState: "Delhi",
        businessState: "Delhi",
      });

      expect(res.lines).toHaveLength(1);
      const giftLine = res.lines[0];
      expect(giftLine.isGift).toBe(true);
      expect(giftLine.totalPaise).toBe(0);
      expect(giftLine.taxablePaise).toBe(0);
      expect(giftLine.cgstPaise).toBe(0);
      expect(giftLine.sgstPaise).toBe(0);
      expect(giftLine.igstPaise).toBe(0);
    });

    it("handles COMPOSITE fee spread and post-discount lines with exact total match", () => {
      // Product: 100000 unit, discount 20000 -> net goods 80000
      // Shipping: 9900
      // In COMPOSITE mode: fee is spread to goods line -> total 89900
      const res = computeInvoiceLines({
        items: [
          {
            description: "Premium Linen Shirt",
            qty: 1,
            unitPricePaise: 100000,
            discountPaise: 20000,
            isGift: false,
          },
        ],
        shippingFeePaise: 9900,
        codFeePaise: 0,
        feeMode: "COMPOSITE",
        fallbackGstRatePercent: 12,
        buyerState: "Delhi",
        businessState: "Delhi",
      });

      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].totalPaise).toBe(89900);
      expect(res.totals.totalPaise).toBe(89900);
      expect(res.totals.taxablePaise + res.totals.cgstPaise + res.totals.sgstPaise).toBe(89900);
    });

    it("handles SEPARATE fee mode with dedicated fee lines", () => {
      const res = computeInvoiceLines({
        items: [
          {
            description: "Oversized Tee",
            qty: 2,
            unitPricePaise: 50000,
            discountPaise: 0,
          },
        ],
        shippingFeePaise: 9900,
        codFeePaise: 5000,
        feeMode: "SEPARATE",
        feeRatePercent: 18,
        fallbackGstRatePercent: 5,
        buyerState: "Maharashtra",
        businessState: "Delhi", // Inter-state
      });

      expect(res.isInterState).toBe(true);
      expect(res.lines).toHaveLength(3); // 1 product + 1 shipping + 1 cod fee
      expect(res.totals.totalPaise).toBe(100000 + 9900 + 5000);
      expect(res.totals.cgstPaise).toBe(0);
      expect(res.totals.sgstPaise).toBe(0);
      expect(res.totals.igstPaise).toBeGreaterThan(0);
      expect(res.totals.taxablePaise + res.totals.igstPaise).toBe(res.totals.totalPaise);
    });

    it("defaults to IGST with a warning for unknown buyer state", () => {
      const res = computeInvoiceLines({
        items: [
          {
            description: "Cap",
            qty: 1,
            unitPricePaise: 49900,
            discountPaise: 0,
          },
        ],
        shippingFeePaise: 0,
        codFeePaise: 0,
        feeMode: "COMPOSITE",
        fallbackGstRatePercent: 5,
        buyerState: "NonExistentState123",
        businessState: "Delhi",
      });

      expect(res.isInterState).toBe(true);
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.totals.igstPaise).toBeGreaterThan(0);
      expect(res.totals.cgstPaise).toBe(0);
      expect(res.totals.sgstPaise).toBe(0);
    });
  });

  describe("8. Property Loop: 200 Random Orders", () => {
    it("maintains sum invariants and non-negativity across 200 random carts", () => {
      const states = ["Delhi", "Maharashtra", "Karnataka", "Tamil Nadu", "Gujarat", "DL", "MH", "Unknown"];
      const feeModes: ("COMPOSITE" | "SEPARATE")[] = ["COMPOSITE", "SEPARATE"];
      const rates = [0, 5, 12, 18, 28];

      for (let i = 0; i < 200; i++) {
        const numItems = Math.floor(Math.random() * 5) + 1;
        const items = [];
        let expectedTotal = 0;

        for (let j = 0; j < numItems; j++) {
          const isGift = Math.random() < 0.2;
          const qty = Math.floor(Math.random() * 4) + 1;
          const unitPricePaise = isGift ? 0 : Math.floor(Math.random() * 200000) + 1000;
          const discountPaise = isGift ? 0 : Math.min(unitPricePaise * qty, Math.floor(Math.random() * (unitPricePaise * qty)));
          items.push({
            description: `Item ${j}`,
            qty,
            unitPricePaise,
            discountPaise,
            isGift,
          });
          expectedTotal += isGift ? 0 : (unitPricePaise * qty - discountPaise);
        }

        const shippingFeePaise = Math.random() < 0.5 ? 9900 : 0;
        const codFeePaise = Math.random() < 0.3 ? 5000 : 0;
        expectedTotal += shippingFeePaise + codFeePaise;

        const buyerState = states[Math.floor(Math.random() * states.length)];
        const businessState = "Delhi";
        const feeMode = feeModes[Math.floor(Math.random() * feeModes.length)];
        const fallbackRate = rates[Math.floor(Math.random() * rates.length)];

        const result = computeInvoiceLines({
          items,
          shippingFeePaise,
          codFeePaise,
          feeMode,
          fallbackGstRatePercent: fallbackRate,
          buyerState,
          businessState,
        });

        // 1. Sum of line totals strictly equals order total
        expect(result.totals.totalPaise).toBe(expectedTotal);
        const sumLineTotals = result.lines.reduce((acc, l) => acc + l.totalPaise, 0);
        expect(sumLineTotals).toBe(expectedTotal);

        // 2. Taxable + taxes equals total for every line
        for (const l of result.lines) {
          expect(l.totalPaise).toBeGreaterThanOrEqual(0);
          expect(l.taxablePaise).toBeGreaterThanOrEqual(0);
          expect(l.cgstPaise).toBeGreaterThanOrEqual(0);
          expect(l.sgstPaise).toBeGreaterThanOrEqual(0);
          expect(l.igstPaise).toBeGreaterThanOrEqual(0);
          expect(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise).toBe(l.totalPaise);
        }

        // 3. Totals sum invariant
        expect(
          result.totals.taxablePaise +
            result.totals.cgstPaise +
            result.totals.sgstPaise +
            result.totals.igstPaise
        ).toBe(expectedTotal);
      }
    });
  });

  describe("9. Regression: Barcode Tee & Decode Hoodie stay GOODS next to real COD fee", () => {
    it("ensures items with 'cod' in their name are explicitly classified as GOODS and not COD", () => {
      const res = computeInvoiceLines({
        items: [
          {
            description: "Barcode Tee",
            qty: 1,
            unitPricePaise: 99900,
            discountPaise: 0,
          },
          {
            description: "Decode Hoodie",
            qty: 1,
            unitPricePaise: 199900,
            discountPaise: 0,
          },
        ],
        shippingFeePaise: 9900,
        codFeePaise: 5000,
        feeMode: "SEPARATE",
        feeRatePercent: 18,
        fallbackGstRatePercent: 5,
        buyerState: "Punjab",
        businessState: "Punjab",
      });

      expect(res.lines).toHaveLength(4);
      expect(res.lines[0].description).toBe("Barcode Tee");
      expect(res.lines[0].kind).toBe("GOODS");
      expect(res.lines[1].description).toBe("Decode Hoodie");
      expect(res.lines[1].kind).toBe("GOODS");
      expect(res.lines[2].kind).toBe("SHIPPING");
      expect(res.lines[3].kind).toBe("COD");
    });
  });
});
