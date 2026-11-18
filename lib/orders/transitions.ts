import {
  PaymentMethod,
  PaymentStatus,
  FulfilmentStatus,
} from "@prisma/client";

export const LEGAL_FULFILMENT_TRANSITIONS: Record<
  PaymentMethod,
  Partial<Record<FulfilmentStatus, FulfilmentStatus[]>>
> = {
  RAZORPAY: {
    CREATED: ["CANCELLED"],
    PLACED: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED"],
    DELIVERED: ["CANCELLED"], // Approved return only
  },
  COD: {
    PLACED: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED", "CANCELLED"], // Delivery refused / RTO
    DELIVERED: ["CANCELLED"], // Approved return only
  },
  STORE_CREDIT: {
    PLACED: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED"],
    DELIVERED: ["CANCELLED"], // Approved return only
  },
};

export const LEGAL_PAYMENT_TRANSITIONS: Partial<
  Record<PaymentStatus, PaymentStatus[]>
> = {
  PENDING: ["PAID", "FAILED"],
  FAILED: ["PAID"],
  COD_PENDING: ["COD_COLLECTED"],
  PAID: ["PARTIALLY_REFUNDED", "REFUNDED"],
  COD_COLLECTED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
};

export function canFulfilmentTransition(
  method: PaymentMethod,
  from: FulfilmentStatus | string,
  to: FulfilmentStatus | string
): boolean {
  const allowed = (
    LEGAL_FULFILMENT_TRANSITIONS[method] as Record<string, string[] | undefined>
  )?.[from];
  return !!allowed?.includes(to);
}

export function canPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus
): boolean {
  const allowed = LEGAL_PAYMENT_TRANSITIONS[from];
  return !!allowed?.includes(to);
}

/**
 * Fulfilment status transition check.
 */
export function canTransition(
  method: PaymentMethod,
  from: FulfilmentStatus | string,
  to: FulfilmentStatus | string
): boolean {
  const allowed = (
    LEGAL_FULFILMENT_TRANSITIONS[method] as Record<string, string[] | undefined>
  )?.[from];
  return !!allowed?.includes(to);
}

export function nextStatusOptions(order: {
  paymentMethod: PaymentMethod;
  fulfilmentStatus?: FulfilmentStatus;
}): FulfilmentStatus[] {
  const fStatus = order.fulfilmentStatus;

  const allowed =
    (
      LEGAL_FULFILMENT_TRANSITIONS[order.paymentMethod] as Record<
        string,
        FulfilmentStatus[] | undefined
      >
    )?.[fStatus || ""] || [];

  return allowed.filter(
    (s) => !(fStatus === "DELIVERED" && s === "CANCELLED")
  );
}
