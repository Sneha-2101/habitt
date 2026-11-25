import { describe, it, expect } from "vitest";
import {
  computeCreditNoteAmounts,
  type CreditNoteInvoiceLineInput,
  type CreditNoteExistingNoteInput,
  type CreditNoteOrderItemInput,
} from "@/lib/gst/credit-note";

describe("credit-note-rounding using computeCreditNoteAmounts", () => {
  it("(a) COMPOSITE: shipping 10001 paise over 3 items, partial then partial then final sums to invoice total with remainder on final note", () => {
    // 3 items of 100000 paise each, shipping 10001 paise -> total 310001 paise
    // In COMPOSITE mode, shipping is absorbed into goods lines:
    // item 1: 103334, item 2: 103334, item 3: 103333 (sum = 310001)
    const orderItems: CreditNoteOrderItemInput[] = [
      { id: "oi-1", unitPrice: 100000, discountPaise: 0, qty: 1 },
      { id: "oi-2", unitPrice: 100000, discountPaise: 0, qty: 1 },
      { id: "oi-3", unitPrice: 100000, discountPaise: 0, qty: 1 },
    ];
    const invoiceLines: CreditNoteInvoiceLineInput[] = [
      { id: "il-1", orderItemId: "oi-1", kind: "GOODS", description: "Item 1", qty: 1, unitPaise: 103334, discountPaise: 0, netPaise: 103334, ratePercent: 5 },
      { id: "il-2", orderItemId: "oi-2", kind: "GOODS", description: "Item 2", qty: 1, unitPaise: 103334, discountPaise: 0, netPaise: 103334, ratePercent: 5 },
      { id: "il-3", orderItemId: "oi-3", kind: "GOODS", description: "Item 3", qty: 1, unitPaise: 103333, discountPaise: 0, netPaise: 103333, ratePercent: 5 },
    ];
    const invoiceTotalPaise = 310001;
    const existing: CreditNoteExistingNoteInput[] = [];

    // Partial return 1: item 1 -> item price only (100000)
    const cn1 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: existing,
      orderItems,
      refundedItems: [{ orderItemId: "oi-1", qty: 1 }],
    });
    expect(cn1).not.toBeNull();
    expect(cn1!.totalPaise).toBe(100000);
    existing.push({ totalPaise: cn1!.totalPaise, lines: cn1!.lines });

    // Partial return 2: item 2 -> item price only (100000)
    const cn2 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: existing,
      orderItems,
      refundedItems: [{ orderItemId: "oi-2", qty: 1 }],
    });
    expect(cn2).not.toBeNull();
    expect(cn2!.totalPaise).toBe(100000);
    existing.push({ totalPaise: cn2!.totalPaise, lines: cn2!.lines });

    // Final return 3: item 3 -> sweeps remaining balance including all shipping & rounding remainder (110001)
    const cn3 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: existing,
      orderItems,
      refundedItems: [{ orderItemId: "oi-3", qty: 1 }],
    });
    expect(cn3).not.toBeNull();
    expect(cn3!.totalPaise).toBe(110001);

    expect(cn1!.totalPaise + cn2!.totalPaise + cn3!.totalPaise).toBe(invoiceTotalPaise);
  });

  it("(b) COD fee + discount present in COMPOSITE mode", () => {
    // 2 items @ 100000 each, 10000 discount on item 1, COD fee 5000, shipping 9900
    // Net goods: (90000 + 100000) = 190000; fees = 14900; total = 204900
    const orderItems: CreditNoteOrderItemInput[] = [
      { id: "oi-1", unitPrice: 100000, discountPaise: 10000, qty: 1 },
      { id: "oi-2", unitPrice: 100000, discountPaise: 0, qty: 1 },
    ];
    const invoiceLines: CreditNoteInvoiceLineInput[] = [
      { id: "il-1", orderItemId: "oi-1", kind: "GOODS", description: "Item 1", qty: 1, unitPaise: 100000, discountPaise: 10000, netPaise: 97058, ratePercent: 5 },
      { id: "il-2", orderItemId: "oi-2", kind: "GOODS", description: "Item 2", qty: 1, unitPaise: 100000, discountPaise: 0, netPaise: 107842, ratePercent: 5 },
    ];
    const invoiceTotalPaise = 204900;

    const cn1 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [],
      orderItems,
      refundedItems: [{ orderItemId: "oi-1", qty: 1 }],
    });
    expect(cn1!.totalPaise).toBe(90000); // item 1 net after discount, no fees

    const cn2 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [{ totalPaise: cn1!.totalPaise, lines: cn1!.lines }],
      orderItems,
      refundedItems: [{ orderItemId: "oi-2", qty: 1 }],
    });
    expect(cn2!.totalPaise).toBe(114900); // item 2 + remaining fees
    expect(cn1!.totalPaise + cn2!.totalPaise).toBe(invoiceTotalPaise);
  });

  it("(c) odd-paise tax totals: per-note tax split sums to the note total", () => {
    const invoiceLines: CreditNoteInvoiceLineInput[] = [
      { id: "il-1", orderItemId: "oi-1", kind: "GOODS", description: "Odd Item", qty: 1, unitPaise: 100001, discountPaise: 0, netPaise: 100001, ratePercent: 5 },
    ];
    // Intra-state (CGST + SGST)
    const cnIntra = computeCreditNoteAmounts({
      invoiceTotalPaise: 100001,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [],
      orderItems: [{ id: "oi-1", unitPrice: 100001, discountPaise: 0, qty: 1 }],
      refundedItems: [{ orderItemId: "oi-1", qty: 1 }],
    });
    expect(cnIntra).not.toBeNull();
    expect(cnIntra!.taxablePaise + cnIntra!.cgstPaise + cnIntra!.sgstPaise + cnIntra!.igstPaise).toBe(cnIntra!.totalPaise);
    expect(cnIntra!.igstPaise).toBe(0);

    // Inter-state (IGST)
    const cnInter = computeCreditNoteAmounts({
      invoiceTotalPaise: 100001,
      isInterState: true,
      invoiceLines,
      existingCreditNotes: [],
      orderItems: [{ id: "oi-1", unitPrice: 100001, discountPaise: 0, qty: 1 }],
      refundedItems: [{ orderItemId: "oi-1", qty: 1 }],
    });
    expect(cnInter).not.toBeNull();
    expect(cnInter!.taxablePaise + cnInter!.igstPaise).toBe(cnInter!.totalPaise);
    expect(cnInter!.cgstPaise).toBe(0);
    expect(cnInter!.sgstPaise).toBe(0);
  });

  it("(d) SEPARATE mode: partial return excludes fees, final return includes fee lines", () => {
    const invoiceLines: CreditNoteInvoiceLineInput[] = [
      { id: "il-1", orderItemId: "oi-1", kind: "GOODS", description: "Item 1", qty: 1, unitPaise: 100000, discountPaise: 0, netPaise: 100000, ratePercent: 5 },
      { id: "il-2", orderItemId: "oi-2", kind: "GOODS", description: "Item 2", qty: 1, unitPaise: 120000, discountPaise: 0, netPaise: 120000, ratePercent: 5 },
      { id: "il-ship", orderItemId: null, kind: "SHIPPING", description: "Shipping", qty: 1, unitPaise: 9900, discountPaise: 0, netPaise: 9900, ratePercent: 18 },
    ];
    const invoiceTotalPaise = 229900;

    // Partial return: item 1 only
    const cn1 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [],
      refundedItems: [{ orderItemId: "oi-1", qty: 1 }],
      includeFeeShare: false,
    });
    expect(cn1!.totalPaise).toBe(100000);

    // Final return: item 2 + shipping fee
    const cn2 = computeCreditNoteAmounts({
      invoiceTotalPaise,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [{ totalPaise: cn1!.totalPaise, lines: cn1!.lines }],
      refundedItems: [{ orderItemId: "oi-2", qty: 1 }],
      includeFeeShare: true,
    });
    expect(cn2!.totalPaise).toBe(129900);
    expect(cn1!.totalPaise + cn2!.totalPaise).toBe(invoiceTotalPaise);
  });

  it("(e) single-item order fully returned", () => {
    const invoiceLines: CreditNoteInvoiceLineInput[] = [
      { id: "il-1", orderItemId: "oi-1", kind: "GOODS", description: "Single Item", qty: 2, unitPaise: 50000, discountPaise: 0, netPaise: 109900, ratePercent: 5 },
    ];
    const cn = computeCreditNoteAmounts({
      invoiceTotalPaise: 109900,
      isInterState: false,
      invoiceLines,
      existingCreditNotes: [],
      orderItems: [{ id: "oi-1", unitPrice: 50000, discountPaise: 0, qty: 2 }],
      refundedItems: [{ orderItemId: "oi-1", qty: 2 }],
    });
    expect(cn).not.toBeNull();
    expect(cn!.totalPaise).toBe(109900);
    expect(cn!.lines).toHaveLength(1);
    expect(cn!.lines[0].qty).toBe(2);
  });
});
