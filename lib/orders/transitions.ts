import { OrderStatus, PaymentMethod } from "@prisma/client";

export const LEGAL_TRANSITIONS: Record<PaymentMethod, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  RAZORPAY: {
    PENDING: ["PAID", "FAILED", "CANCELLED"],
    FAILED: ["PAID"],
    PAID: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED"],
    DELIVERED: ["CANCELLED"], // Approved return only
  },
  COD: {
    PENDING: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED", "CANCELLED"], // Delivery refused / RTO
    DELIVERED: ["CANCELLED"], // Approved return only
  },
  STORE_CREDIT: {
    PAID: ["SHIPPED", "CANCELLED"],
    SHIPPED: ["DELIVERED"],
    DELIVERED: ["CANCELLED"], // Approved return only
  },
};

export function canTransition(method: PaymentMethod, from: OrderStatus, to: OrderStatus): boolean {
  const allowed = LEGAL_TRANSITIONS[method]?.[from];
  return !!allowed?.includes(to);
}

export function nextStatusOptions(order: { paymentMethod: PaymentMethod; status: OrderStatus }): OrderStatus[] {
  const allowed = LEGAL_TRANSITIONS[order.paymentMethod]?.[order.status] || [];
  // Admin manual dropdown must never show PAID, PENDING, or FAILED.
  // DELIVERED -> CANCELLED is approved return only (handled in returns workflow).
  return allowed.filter(
    (s) => s !== "PAID" && s !== "PENDING" && s !== "FAILED" && !(order.status === "DELIVERED" && s === "CANCELLED")
  );
}
