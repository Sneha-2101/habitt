import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRefundCreate = vi.fn();
const mockFetchMultipleRefund = vi.fn();
const mockFetchRefund = vi.fn();

const mockOrderFindUnique = vi.fn();
const mockRefundFindUnique = vi.fn();
const mockRefundFindMany = vi.fn();
const mockRefundUpsert = vi.fn();
const mockRefundUpdate = vi.fn();
const mockOrderUpdate = vi.fn();
const mockOrderStatusEventCreate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockExecuteRaw = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/razorpay", () => ({
  getRazorpay: () => ({
    payments: {
      refund: mockRefundCreate,
      fetchMultipleRefund: mockFetchMultipleRefund,
      fetchRefund: mockFetchRefund,
    },
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    refund: {
      findUnique: (...args: unknown[]) => mockRefundFindUnique(...args),
      findMany: (...args: unknown[]) => mockRefundFindMany(...args),
      update: (...args: unknown[]) => mockRefundUpdate(...args),
    },
    order: {
      findUnique: (...args: unknown[]) => mockOrderFindUnique(...args),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        order: {
          findUnique: (...args: unknown[]) => mockOrderFindUnique(...args),
          update: (...args: unknown[]) => mockOrderUpdate(...args),
        },
        refund: {
          findUnique: (...args: unknown[]) => mockRefundFindUnique(...args),
          upsert: (...args: unknown[]) => mockRefundUpsert(...args),
          update: (...args: unknown[]) => mockRefundUpdate(...args),
        },
        orderStatusEvent: {
          create: (...args: unknown[]) => mockOrderStatusEventCreate(...args),
        },
        auditLog: {
          create: (...args: unknown[]) => mockAuditLogCreate(...args),
        },
      };
      return fn(tx);
    },
  },
}));

import { issueRefund } from "@/lib/refunds/issue-refund";
import {
  findMatchingGatewayRefund,
  INTERRUPTED_REFUND_FAILURE_REASON,
  recoverInterruptedRefunds,
} from "@/lib/refunds/recover-refunds";

describe("refund contract tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notes.refundId equal to refund.id and recovery matcher finds it", async () => {
    mockRefundFindUnique.mockResolvedValueOnce(null);
    mockOrderFindUnique.mockResolvedValue({
      id: "ord_1",
      displayId: "HB-1",
      total: 10000,
      fulfilmentStatus: "CANCELLED",
      razorpayPaymentId: "pay_1",
      refunds: [],
    });
    mockRefundUpsert.mockResolvedValue({
      id: "ref_contract_1",
      orderId: "ord_1",
      method: "RAZORPAY",
      status: "PENDING",
      amountPaise: 10000,
      idempotencyKey: "idem_1",
    });
    mockRefundCreate.mockResolvedValue({ id: "rfnd_gw_1" });
    mockRefundUpdate.mockResolvedValue({
      id: "ref_contract_1",
      status: "PROCESSED",
      providerRefundId: "rfnd_gw_1",
    });

    const res = await issueRefund({
      orderId: "ord_1",
      method: "RAZORPAY",
      amountPaise: 10000,
      idempotencyKey: "idem_1",
    });

    expect(res.success).toBe(true);
    expect(mockRefundCreate).toHaveBeenCalledWith("pay_1", {
      amount: 10000,
      notes: {
        orderId: "HB-1",
        refundId: "ref_contract_1",
        returnId: "",
      },
    });

    const sentNotes = mockRefundCreate.mock.calls[0][1].notes;
    const matched = findMatchingGatewayRefund(
      [{ id: "rfnd_gw_1", status: "processed", notes: sentNotes }],
      "ref_contract_1"
    );
    expect(matched?.id).toBe("rfnd_gw_1");
  });

  it("PROCESSED idempotent retry makes zero gateway calls", async () => {
    mockRefundFindUnique.mockResolvedValueOnce({
      id: "ref_done",
      status: "PROCESSED",
      amountPaise: 5000,
    });

    const res = await issueRefund({
      orderId: "ord_1",
      method: "RAZORPAY",
      amountPaise: 5000,
      idempotencyKey: "idem_done",
    });

    expect(res.success).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockFetchMultipleRefund).not.toHaveBeenCalled();
  });

  it("failed gateway lookup leaves a PENDING refund PENDING during recovery", async () => {
    mockRefundFindMany.mockResolvedValueOnce([{ id: "ref_pend" }]);
    mockQueryRaw.mockResolvedValueOnce([{ id: "ref_pend" }]);
    mockRefundFindUnique.mockResolvedValueOnce({
      id: "ref_pend",
      orderId: "ord_1",
      returnId: null,
      method: "RAZORPAY",
      status: "PENDING",
      amountPaise: 5000,
      providerRefundId: null,
      order: {
        id: "ord_1",
        total: 5000,
        fulfilmentStatus: "CANCELLED",
        razorpayPaymentId: "pay_1",
        refunds: [],
      },
    });
    mockFetchMultipleRefund.mockRejectedValueOnce(new Error("timeout"));

    const res = await recoverInterruptedRefunds(new Date());
    expect(res.stillPending).toBe(1);
    expect(res.markedFailed).toBe(0);
    expect(mockRefundUpdate).not.toHaveBeenCalled();
  });

  it("pre-retry lookup completes an interrupted FAILED refund when gateway refund exists", async () => {
    const existing = {
      id: "ref_int_1",
      orderId: "ord_1",
      returnId: null,
      method: "RAZORPAY",
      status: "FAILED",
      amountPaise: 10000,
      providerRefundId: null,
      failureReason: INTERRUPTED_REFUND_FAILURE_REASON,
      idempotencyKey: "idem_int_1",
    };
    mockRefundFindUnique.mockResolvedValueOnce(existing);
    mockOrderFindUnique.mockResolvedValueOnce({
      id: "ord_1",
      total: 10000,
      fulfilmentStatus: "CANCELLED",
      razorpayPaymentId: "pay_1",
      refunds: [existing],
    });
    mockFetchMultipleRefund.mockResolvedValueOnce({
      items: [{ id: "rfnd_existing", status: "processed", notes: { refundId: "ref_int_1" } }],
    });
    mockRefundUpdate.mockResolvedValueOnce({
      ...existing,
      status: "PROCESSED",
      providerRefundId: "rfnd_existing",
    });

    const res = await issueRefund({
      orderId: "ord_1",
      method: "RAZORPAY",
      amountPaise: 10000,
      idempotencyKey: "idem_int_1",
    });

    expect(res.success).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it("pre-retry lookup fails closed on lookup error without calling gateway refund", async () => {
    const existing = {
      id: "ref_int_2",
      orderId: "ord_1",
      returnId: null,
      method: "RAZORPAY",
      status: "FAILED",
      amountPaise: 10000,
      providerRefundId: null,
      failureReason: INTERRUPTED_REFUND_FAILURE_REASON,
      idempotencyKey: "idem_int_2",
    };
    mockRefundFindUnique.mockResolvedValueOnce(existing);
    mockOrderFindUnique.mockResolvedValueOnce({
      id: "ord_1",
      total: 10000,
      fulfilmentStatus: "CANCELLED",
      razorpayPaymentId: "pay_1",
      refunds: [existing],
    });
    mockFetchMultipleRefund.mockRejectedValueOnce(new Error("gateway 503"));

    const res = await issueRefund({
      orderId: "ord_1",
      method: "RAZORPAY",
      amountPaise: 10000,
      idempotencyKey: "idem_int_2",
    });

    expect(res.success).toBe(false);
    expect(res.refund.status).toBe("FAILED");
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });
});
