import { PaymentMethod, PaymentStatus, FulfilmentStatus } from "@prisma/client";

export type LegacyStage =
  | "PENDING"
  | "PAID"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "FAILED";

export interface OrderStatusLabel {
  label: string;
  stage: LegacyStage;
  chipClass: string;
  adminClass: string;
}

/**
 * Returns the old-status-equivalent key (PENDING | PAID | SHIPPED | DELIVERED | CANCELLED | FAILED)
 * derived from (paymentMethod, paymentStatus, fulfilmentStatus).
 */
export function legacyStage(order: {
  paymentMethod: PaymentMethod;
  paymentStatus?: PaymentStatus | null;
  fulfilmentStatus?: FulfilmentStatus | null;
}): LegacyStage {
  const { paymentMethod, paymentStatus, fulfilmentStatus } = order;

  if (fulfilmentStatus === "CANCELLED") {
    return "CANCELLED";
  }

  if (paymentStatus === "FAILED") {
    return "FAILED";
  }

  if (fulfilmentStatus === "DELIVERED") {
    return "DELIVERED";
  }

  if (fulfilmentStatus === "SHIPPED") {
    return "SHIPPED";
  }

  if (paymentMethod === "COD") {
    if (fulfilmentStatus === "PLACED") {
      return "PENDING";
    }
  } else {
    // RAZORPAY and STORE_CREDIT
    if (fulfilmentStatus === "PLACED") {
      return "PAID";
    }
    if (fulfilmentStatus === "CREATED") {
      return "PENDING";
    }
  }

  if (paymentStatus === "PAID" || paymentStatus === "COD_COLLECTED") {
    return "PAID";
  }

  return "PENDING";
}

/**
 * Maps an OrderStatusEvent's (paymentStatus, fulfilmentStatus) to a legacy stage.
 * Priority:
 *   fulfilmentStatus SHIPPED|DELIVERED|CANCELLED -> that;
 *   else paymentStatus FAILED -> FAILED;
 *   else paymentStatus PAID -> PAID;
 *   else PENDING.
 */
export function legacyEventStage(e: {
  paymentStatus?: PaymentStatus | string | null;
  fulfilmentStatus?: FulfilmentStatus | string | null;
}): LegacyStage {
  const { paymentStatus, fulfilmentStatus } = e;

  if (
    fulfilmentStatus === "SHIPPED" ||
    fulfilmentStatus === "DELIVERED" ||
    fulfilmentStatus === "CANCELLED"
  ) {
    return fulfilmentStatus;
  }

  if (paymentStatus === "FAILED") {
    return "FAILED";
  }

  if (paymentStatus === "PAID") {
    return "PAID";
  }

  return "PENDING";
}

/**
 * Maps (paymentMethod, paymentStatus, fulfilmentStatus) to user-facing chip label,
 * background, and text colors.
 */
export function getOrderStatusLabel(order: {
  paymentMethod: PaymentMethod;
  paymentStatus?: PaymentStatus | null;
  fulfilmentStatus?: FulfilmentStatus | null;
}): OrderStatusLabel {
  const stage = legacyStage(order);

  let label: string = stage;
  if (order.paymentStatus === "REFUNDED") {
    label = "Refunded";
  } else if (order.paymentStatus === "PARTIALLY_REFUNDED") {
    label = "Partially Refunded";
  }

  // AccountClient badge classes
  let chipClass = "bg-amber-100 text-amber-800";
  if (stage === "PAID") {
    chipClass = "bg-emerald-100 text-emerald-800";
  } else if (stage === "SHIPPED" || stage === "DELIVERED") {
    chipClass = "bg-blue-100 text-blue-800";
  } else if (stage === "CANCELLED" || stage === "FAILED") {
    chipClass = "bg-rose-100 text-rose-800";
  }

  // AdminOrdersClient text color classes
  let adminClass = "text-ink";
  if (stage === "PAID" || stage === "DELIVERED") {
    adminClass = "text-moss";
  } else if (stage === "FAILED" || stage === "CANCELLED") {
    adminClass = "text-clay";
  }

  return { label, stage, chipClass, adminClass };
}
