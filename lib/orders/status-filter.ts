import { Prisma, PaymentMethod } from "@prisma/client";

const VALID_PAYMENT_METHODS: PaymentMethod[] = ["RAZORPAY", "COD", "STORE_CREDIT"];

export function buildStatusFilter(status?: string | null): Prisma.OrderWhereInput {
  if (!status) return {};
  switch (status) {
    case "PENDING":
      return {
        OR: [
          { paymentStatus: "PENDING", fulfilmentStatus: "CREATED" },
          { paymentMethod: "COD", paymentStatus: "COD_PENDING", fulfilmentStatus: "PLACED" },
        ],
      };
    case "PAID":
      return { paymentStatus: "PAID", fulfilmentStatus: "PLACED" };
    case "SHIPPED":
      return { fulfilmentStatus: "SHIPPED" };
    case "DELIVERED":
      return { fulfilmentStatus: "DELIVERED" };
    case "CANCELLED":
      return { fulfilmentStatus: "CANCELLED" };
    case "FAILED":
      return { paymentStatus: "FAILED" };
    default:
      return {};
  }
}

export function buildOrderWhere({
  status,
  paymentMethod,
  q,
}: {
  status?: string | null;
  paymentMethod?: string | null;
  q?: string | null;
}): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [];

  const statusFilter = buildStatusFilter(status);
  if (Object.keys(statusFilter).length > 0) {
    conditions.push(statusFilter);
  }

  if (paymentMethod && VALID_PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
    conditions.push({ paymentMethod: paymentMethod as PaymentMethod });
  }

  const query = q?.trim();
  if (query) {
    conditions.push({
      OR: [
        { displayId: { contains: query, mode: "insensitive" } },
        { customerName: { contains: query, mode: "insensitive" } },
        { customerEmail: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  if (conditions.length === 0) {
    return {};
  }

  return { AND: conditions };
}
