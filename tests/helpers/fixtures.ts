import crypto from "crypto";
import { prisma } from "./prisma";

import { Size } from "@prisma/client";

export function genId(prefix: string = "m1test"): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export async function createTestUser(overrides: Partial<Parameters<typeof prisma.user.create>[0]["data"]> = {}) {
  const id = genId("m1test_usr");
  return prisma.user.create({
    data: {
      id,
      name: `M1 Test User ${id}`,
      email: `${id}@example.test`,
      role: "CUSTOMER",
      storeCreditBalance: 0,
      ...overrides,
    },
  });
}

export async function createTestProduct(opts?: {
  price?: number;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  variants?: Array<{ size: Size; stock: number }>;
}) {
  const id = genId("m1test_prod");
  const slug = `m1test-prod-${crypto.randomBytes(4).toString("hex")}`;
  const price = opts?.price ?? 100000; // Rs 1000 in paise
  const status = opts?.status ?? "ACTIVE";

  const product = await prisma.product.create({
    data: {
      id,
      name: `Test Product ${id}`,
      slug,
      description: "Test product description",
      price,
      status,
      category: "SHIRTS",
    },
  });

  const variantsData = opts?.variants ?? [{ size: Size.M, stock: 5 }];
  const createdVariants = [];
  for (const v of variantsData) {
    const varId = genId("m1test_var");
    const variant = await prisma.productVariant.create({
      data: {
        id: varId,
        productId: product.id,
        size: v.size,
        stock: v.stock,
      },
    });
    createdVariants.push(variant);
  }

  return { product, variants: createdVariants };
}

export async function createTestCoupon(opts?: {
  discountType?: "PERCENT" | "FLAT";
  value?: number;
  usageLimit?: number | null;
  timesUsed?: number;
}) {
  const id = genId("m1test_cpn");
  const code = `m1test_${crypto.randomBytes(4).toString("hex")}`.toUpperCase();

  return prisma.coupon.create({
    data: {
      id,
      code,
      discountType: opts?.discountType ?? "PERCENT",
      value: opts?.value ?? 10,
      usageLimit: opts?.usageLimit === undefined ? 1 : opts?.usageLimit,
      timesUsed: opts?.timesUsed ?? 0,
    },
  });
}

export async function createTestOrder(opts: {
  userId: string;
  items: Array<{ variantId: string; productId: string; qty: number; unitPrice: number; name?: string; size?: string }>;
  status?: "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED";
  paymentMethod?: "RAZORPAY" | "COD" | "STORE_CREDIT";
  stockDeducted?: boolean;
  storeCreditApplied?: number;
  couponCode?: string;
  discountAmount?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: Date;
  createdAt?: Date;
}) {
  const id = genId("m1test_ord");
  const displayId = `m1test_HB_${crypto.randomInt(100000, 999999)}`;
  const subtotal = opts.items.reduce((acc, it) => acc + it.unitPrice * it.qty, 0);
  const total = subtotal - (opts.discountAmount || 0);

  return prisma.order.create({
    data: {
      id,
      displayId,
      userId: opts.userId,
      customerName: "M1 Test Customer",
      customerPhone: "9876543210",
      customerEmail: "m1test_cust@example.test",
      shippingAddress: {
        line1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      subtotal,
      shippingFee: 0,
      total,
      status: opts.status ?? "PENDING",
      paymentMethod: opts.paymentMethod ?? "RAZORPAY",
      stockDeducted: opts.stockDeducted ?? false,
      storeCreditApplied: opts.storeCreditApplied ?? 0,
      couponCode: opts.couponCode,
      discountAmount: opts.discountAmount,
      razorpayOrderId: opts.razorpayOrderId,
      razorpayPaymentId: opts.razorpayPaymentId,
      paidAt: opts.paidAt,
      createdAt: opts.createdAt,
      items: {
        create: opts.items.map((it) => ({
          id: genId("m1test_itm"),
          productId: it.productId,
          variantId: it.variantId,
          name: it.name ?? "Test Item",
          size: (it.size ?? "M") as Size,
          unitPrice: it.unitPrice,
          qty: it.qty,
        })),
      },
    },
    include: {
      items: true,
    },
  });
}

export async function cleanupM1TestRows(): Promise<{ remainingTotal: number; details: Record<string, number> }> {
  // Delete in order of dependencies (children first)
  // 1. OrderStatusEvent
  await prisma.orderStatusEvent.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 2. ReturnRequest
  await prisma.returnRequest.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 3. OrderItem
  await prisma.orderItem.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
        { variantId: { startsWith: "m1test" } },
      ],
    },
  });

  // 4. StoreCreditTransaction
  await prisma.storeCreditTransaction.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
        { relatedOrderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 5. StockMovement
  await prisma.stockMovement.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { variantId: { startsWith: "m1test" } },
        { actorId: { startsWith: "m1test" } },
        { refId: { startsWith: "m1test" } },
      ],
    },
  });

  // 6. ProcessedWebhook
  await prisma.processedWebhook.deleteMany({
    where: {
      id: { startsWith: "m1test" },
    },
  });

  // 7. Order
  await prisma.order.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
        { displayId: { startsWith: "m1test" } },
      ],
    },
  });

  // 8. Coupon
  await prisma.coupon.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { code: { startsWith: "m1test" } },
      ],
    },
  });

  // 9. ProductImage
  await prisma.productImage.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
      ],
    },
  });

  // 10. ProductVariant
  await prisma.productVariant.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
      ],
    },
  });

  // 11. Product
  await prisma.product.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { slug: { startsWith: "m1test" } },
      ],
    },
  });

  // 12. Address
  await prisma.address.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
      ],
    },
  });


  // 14. User
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { email: { startsWith: "m1test" } },
      ],
    },
  });

  // Report counts of any remaining m1test rows
  const remainingCounts = {
    orderStatusEvents: await prisma.orderStatusEvent.count({ where: { id: { startsWith: "m1test" } } }),
    returnRequests: await prisma.returnRequest.count({ where: { id: { startsWith: "m1test" } } }),
    orderItems: await prisma.orderItem.count({ where: { id: { startsWith: "m1test" } } }),
    storeCreditTransactions: await prisma.storeCreditTransaction.count({ where: { id: { startsWith: "m1test" } } }),
    stockMovements: await prisma.stockMovement.count({ where: { id: { startsWith: "m1test" } } }),
    processedWebhooks: await prisma.processedWebhook.count({ where: { id: { startsWith: "m1test" } } }),
    orders: await prisma.order.count({ where: { id: { startsWith: "m1test" } } }),
    coupons: await prisma.coupon.count({ where: { id: { startsWith: "m1test" } } }),
    productVariants: await prisma.productVariant.count({ where: { id: { startsWith: "m1test" } } }),
    products: await prisma.product.count({ where: { id: { startsWith: "m1test" } } }),
    users: await prisma.user.count({ where: { id: { startsWith: "m1test" } } }),
  };

  const remainingTotal = Object.values(remainingCounts).reduce((a, b) => a + b, 0);
  return { remainingTotal, details: remainingCounts };
}
