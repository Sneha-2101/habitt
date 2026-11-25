import { prisma } from "@/lib/prisma";
import { getRazorpay } from "@/lib/razorpay";
import { refundToWallet } from "@/lib/wallet/service";
import type { Refund, RefundMethod } from "@prisma/client";

export interface IssueRefundInput {
  orderId: string;
  returnId?: string | null;
  method: RefundMethod;
  amountPaise: number;
  idempotencyKey: string;
  actorId?: string | null;
  recordOnly?: boolean;
  providerRefundId?: string | null;
  reason?: string;
}

export interface IssueRefundResult {
  success: boolean;
  refund: Refund;
  idempotent?: boolean;
  error?: string;
}

/**
 * Idempotent refund issuance service.
 * - Enforces cumulative refunded <= total order paid inside a transaction with row lock on Order.
 * - Razorpay: calls provider strictly AFTER the DB transaction commits, then updates status to PROCESSED or FAILED.
 * - Store Credit: credits wallet inside the transaction and marks PROCESSED.
 * - Record-only mode: writes a ledger row for already completed refunds (e.g. legacy/cancellation/COD-refusal).
 * - Updates Order.paymentStatus to PARTIALLY_REFUNDED / REFUNDED.
 * - Writes AuditLog on issuance, success, and failure.
 */
export async function issueRefund(input: IssueRefundInput): Promise<IssueRefundResult> {
  const {
    orderId,
    returnId,
    method,
    amountPaise,
    idempotencyKey,
    actorId,
    recordOnly = false,
    providerRefundId,
    reason,
  } = input;

  if (amountPaise <= 0) {
    throw new Error("Refund amount must be greater than 0");
  }

  // Check existing refund by idempotency key
  const existingRefund = await prisma.refund.findUnique({
    where: { idempotencyKey },
  });

  if (existingRefund) {
    if (existingRefund.status === "PROCESSED") {
      return { success: true, refund: existingRefund, idempotent: true };
    }
    if (existingRefund.status === "PENDING") {
      throw new Error("A refund with this idempotency key is already pending");
    }
    // If FAILED, we allow retry below
  }

  // --- RECORD-ONLY MODE ---
  if (recordOnly) {
    const refund = await prisma.refund.upsert({
      where: { idempotencyKey },
      create: {
        orderId,
        returnId: returnId || null,
        method,
        status: "PROCESSED",
        amountPaise,
        providerRefundId: providerRefundId || null,
        idempotencyKey,
        processedAt: new Date(),
      },
      update: {
        status: "PROCESSED",
        providerRefundId: providerRefundId || null,
        processedAt: new Date(),
        failureReason: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "REFUND_RECORDED",
        entity: "Refund",
        entityId: refund.id,
        meta: {
          orderId,
          returnId,
          amountPaise,
          method,
          providerRefundId,
          recordOnly: true,
        },
      },
    });

    return { success: true, refund, idempotent: false };
  }

  // --- STORE CREDIT OR MANUAL MODE ---
  if (method === "STORE_CREDIT" || method === "MANUAL") {
    const result = await prisma.$transaction(async (tx) => {
      // Row lock on Order
      await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

      // Check if this refund was ALREADY processed by a concurrent transaction
      const existingInTx = await tx.refund.findUnique({
        where: { idempotencyKey },
      });
      if (existingInTx && existingInTx.status === "PROCESSED") {
        return existingInTx;
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { refunds: true, user: true },
      });

      if (!order) {
        throw new Error("Order not found");
      }

      // Check cumulative refunded <= paid
      const processedRefunds = order.refunds.filter(
        (r) => r.status === "PROCESSED" && r.idempotencyKey !== idempotencyKey
      );
      const cumulativeRefunded = processedRefunds.reduce((acc, r) => acc + r.amountPaise, 0);

      if (cumulativeRefunded + amountPaise > order.total) {
        throw new Error("Total refunded cannot exceed order total paid");
      }

      // Create/update refund record as PROCESSED
      const refund = await tx.refund.upsert({
        where: { idempotencyKey },
        create: {
          orderId,
          returnId: returnId || null,
          method,
          status: "PROCESSED",
          amountPaise,
          providerRefundId: providerRefundId || null,
          idempotencyKey,
          processedAt: new Date(),
        },
        update: {
          status: "PROCESSED",
          method,
          amountPaise,
          providerRefundId: providerRefundId || null,
          processedAt: new Date(),
          failureReason: null,
        },
      });

      if (method === "STORE_CREDIT") {
        if (!order.userId) {
          throw new Error("Order has no user account to receive store credit");
        }

        await refundToWallet(tx, {
          userId: order.userId,
          orderId: order.id,
          amountPaise,
          refundId: refund.id,
          reason: reason || `Refund voucher for Order #${order.displayId}`,
          actorId: actorId || null,
        });
      }

      const newCumulative = cumulativeRefunded + amountPaise;
      const nextPaymentStatus =
        newCumulative >= order.total ? "REFUNDED" : "PARTIALLY_REFUNDED";

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: nextPaymentStatus,
          refundAmount: newCumulative,
          refundedAt: new Date(),
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          fulfilmentStatus: order.fulfilmentStatus,
          paymentStatus: nextPaymentStatus,
          note: `${method === "STORE_CREDIT" ? "Store credit" : "Manual"} refund processed: ₹${(
            amountPaise / 100
          ).toFixed(2)}`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorId || null,
          action: "REFUND_PROCESSED",
          entity: "Refund",
          entityId: refund.id,
          meta: {
            orderId,
            returnId,
            method,
            amountPaise,
            nextPaymentStatus,
          },
        },
      });

      return refund;
    });

    return { success: true, refund: result };
  }

  // --- RAZORPAY MODE ---
  // Step 1: Create PENDING refund inside transaction with row lock
  const pendingRefund = await prisma.$transaction(async (tx) => {
    // Row lock on Order
    await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { refunds: true },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const processedRefunds = order.refunds.filter(
      (r) => r.status === "PROCESSED" && r.idempotencyKey !== idempotencyKey
    );
    const cumulativeRefunded = processedRefunds.reduce((acc, r) => acc + r.amountPaise, 0);

    if (cumulativeRefunded + amountPaise > order.total) {
      throw new Error("Total refunded cannot exceed order total paid");
    }

    const refund = await tx.refund.upsert({
      where: { idempotencyKey },
      create: {
        orderId,
        returnId: returnId || null,
        method: "RAZORPAY",
        status: "PENDING",
        amountPaise,
        idempotencyKey,
      },
      update: {
        status: "PENDING",
        method: "RAZORPAY",
        amountPaise,
        failureReason: null,
      },
    });

    return { refund, order };
  });

  // Step 2: Call Razorpay AFTER the DB commit
  const { refund, order } = pendingRefund;
  if (!order.razorpayPaymentId) {
    const failedRefund = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "FAILED",
        failureReason: "Missing razorpayPaymentId on order",
      },
    });
    return {
      success: false,
      refund: failedRefund,
      error: "Missing razorpayPaymentId on order",
    };
  }

  try {
    const razorpay = getRazorpay();
    const razorpayRefund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: amountPaise,
      notes: {
        orderId: order.displayId,
        refundId: refund.id,
        returnId: returnId || "",
      },
    });

    // Step 3: Mark PROCESSED inside new transaction
    const processedRefund = await prisma.$transaction(async (tx) => {
      const orderRefreshed = await tx.order.findUnique({
        where: { id: order.id },
        include: { refunds: true },
      });

      const processedRefunds = (orderRefreshed?.refunds || []).filter(
        (r) => r.status === "PROCESSED" && r.id !== refund.id
      );
      const newCumulative =
        processedRefunds.reduce((acc, r) => acc + r.amountPaise, 0) + amountPaise;

      const nextPaymentStatus =
        newCumulative >= (orderRefreshed?.total || 0) ? "REFUNDED" : "PARTIALLY_REFUNDED";

      const updatedRefund = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: "PROCESSED",
          providerRefundId: razorpayRefund.id,
          processedAt: new Date(),
          failureReason: null,
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: nextPaymentStatus,
          razorpayRefundId: razorpayRefund.id,
          refundAmount: newCumulative,
          refundedAt: new Date(),
        },
      });

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          fulfilmentStatus: order.fulfilmentStatus,
          paymentStatus: nextPaymentStatus,
          note: `Razorpay refund processed: ${razorpayRefund.id} (₹${(amountPaise / 100).toFixed(
            2
          )})`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: actorId || null,
          action: "REFUND_PROCESSED",
          entity: "Refund",
          entityId: updatedRefund.id,
          meta: {
            orderId,
            returnId,
            method: "RAZORPAY",
            amountPaise,
            providerRefundId: razorpayRefund.id,
            nextPaymentStatus,
          },
        },
      });

      return updatedRefund;
    });

    return { success: true, refund: processedRefund };
  } catch (err: unknown) {
    const errorObj = err as { message?: string; error?: { description?: string } } | undefined;
    const safeReason =
      errorObj?.error?.description || errorObj?.message || "Razorpay refund failed";

    const failedRefund = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "FAILED",
        failureReason: safeReason,
      },
    });

    await prisma.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fulfilmentStatus: order.fulfilmentStatus,
        paymentStatus: order.paymentStatus,
        note: `REFUND FAILED – ${safeReason}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: actorId || null,
        action: "REFUND_FAILED",
        entity: "Refund",
        entityId: failedRefund.id,
        meta: {
          orderId,
          returnId,
          method: "RAZORPAY",
          amountPaise,
          error: safeReason,
        },
      },
    });

    return { success: false, refund: failedRefund, error: safeReason };
  }
}

