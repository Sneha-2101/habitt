import crypto from "crypto";
import { prisma } from "./prisma";

import { FulfilmentStatus, PaymentStatus, Prisma } from "@prisma/client";

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
  compareAtPrice?: number | null;
  costPrice?: number | null;
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  categoryId?: string;
  variants?: Array<{
    size: string;
    stock: number;
    color?: string;
    colorHex?: string | null;
    sku?: string | null;
  }>;
}) {
  const id = genId("m1test_prod");
  const slug = `m1test-prod-${crypto.randomBytes(4).toString("hex")}`;
  const price = opts?.price ?? 100000; // Rs 1000 in paise
  const status = opts?.status ?? "ACTIVE";

  let categoryId = opts?.categoryId;
  if (!categoryId) {
    const defaultCat = await prisma.category.findUnique({
      where: { slug: "shirts" },
    });
    categoryId = defaultCat?.id ?? "cat_shirts";
  }

  const productData: Prisma.ProductUncheckedCreateInput = {
    id,
    name: `Test Product ${id}`,
    slug,
    description: "Test product description",
    price,
    status,
    categoryId,
  };
  if (opts?.compareAtPrice !== undefined) {
    productData.compareAtPrice = opts.compareAtPrice;
  }
  if (opts?.costPrice !== undefined) {
    productData.costPrice = opts.costPrice;
  }

  const product = await prisma.product.create({
    data: productData,
    ...(opts?.costPrice !== undefined ? { omit: { costPrice: false } } : {}),
  });

  const variantsData = opts?.variants ?? [{ size: "M", stock: 5 }];
  const createdVariants = [];
  for (const v of variantsData) {
    const varId = genId("m1test_var");
    const variant = await prisma.productVariant.create({
      data: {
        id: varId,
        productId: product.id,
        size: v.size,
        stock: v.stock,
        color: v.color ?? "",
        colorHex: v.colorHex ?? null,
        sku: v.sku ?? null,
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
  expiresAt?: Date | null;
}) {
  const id = genId("m1test_off");
  const code = `m1test_${crypto.randomBytes(4).toString("hex")}`.toUpperCase();
  const isPercent = (opts?.discountType ?? "PERCENT") === "PERCENT";
  const kind = isPercent ? ("PERCENT_OFF" as const) : ("FLAT_OFF" as const);
  const config = isPercent ? { percent: opts?.value ?? 10 } : { amountPaise: opts?.value ?? 1000 };

  return prisma.offer.create({
    data: {
      id,
      name: code,
      kind,
      code,
      active: true,
      priority: 100,
      audience: "ALL",
      config,
      maxUsesTotal: opts?.usageLimit === undefined ? 1 : opts?.usageLimit,
      maxUsesPerCustomer: 1,
      timesUsed: opts?.timesUsed ?? 0,
      endsAt: opts?.expiresAt ?? null,
    },
  });
}

export async function createTestOrder(opts: {
  userId: string;
  items: Array<{ variantId: string; productId: string; qty: number; unitPrice: number; name?: string; size?: string; isGift?: boolean; discountPaise?: number }>;
  status?: "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED";
  paymentStatus?: PaymentStatus;
  fulfilmentStatus?: FulfilmentStatus;
  paymentMethod?: "RAZORPAY" | "COD" | "STORE_CREDIT";
  stockDeducted?: boolean;
  storeCreditApplied?: number;
  couponCode?: string;
  discountAmount?: number;
  shippingFee?: number;
  total?: number;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: Date;
  shippedAt?: Date;
  createdAt?: Date;
  customerName?: string;
  shippingAddress?: any;
}) {
  const id = genId("m1test_ord");
  const displayId = `m1test_HB_${crypto.randomInt(100000, 999999)}`;
  const subtotal = opts.items.reduce((acc, it) => acc + it.unitPrice * it.qty, 0);
  const total = opts.total !== undefined ? opts.total : (subtotal + (opts.shippingFee ?? 0) - (opts.discountAmount || 0));

  const method = opts.paymentMethod ?? "RAZORPAY";
  let derivedPaymentStatus: PaymentStatus;
  let derivedFulfilmentStatus: FulfilmentStatus;

  if (opts.paymentStatus && opts.fulfilmentStatus) {
    derivedPaymentStatus = opts.paymentStatus;
    derivedFulfilmentStatus = opts.fulfilmentStatus;
  } else {
    const legacy = opts.status ?? "PENDING";
    if (method === "COD") {
      switch (legacy) {
        case "PENDING":
          derivedPaymentStatus = "COD_PENDING";
          derivedFulfilmentStatus = "PLACED";
          break;
        case "SHIPPED":
          derivedPaymentStatus = "COD_PENDING";
          derivedFulfilmentStatus = "SHIPPED";
          break;
        case "DELIVERED":
          derivedPaymentStatus = "COD_COLLECTED";
          derivedFulfilmentStatus = "DELIVERED";
          break;
        case "CANCELLED":
          derivedPaymentStatus = "COD_PENDING";
          derivedFulfilmentStatus = "CANCELLED";
          break;
        default:
          derivedPaymentStatus = "COD_PENDING";
          derivedFulfilmentStatus = "PLACED";
      }
    } else {
      switch (legacy) {
        case "PENDING":
          derivedPaymentStatus = "PENDING";
          derivedFulfilmentStatus = "CREATED";
          break;
        case "PAID":
          derivedPaymentStatus = "PAID";
          derivedFulfilmentStatus = "PLACED";
          break;
        case "SHIPPED":
          derivedPaymentStatus = "PAID";
          derivedFulfilmentStatus = "SHIPPED";
          break;
        case "DELIVERED":
          derivedPaymentStatus = "PAID";
          derivedFulfilmentStatus = "DELIVERED";
          break;
        case "CANCELLED":
          derivedPaymentStatus = opts.paidAt ? "REFUNDED" : "PENDING";
          derivedFulfilmentStatus = "CANCELLED";
          break;
        case "FAILED":
          derivedPaymentStatus = "FAILED";
          derivedFulfilmentStatus = "CREATED";
          break;
        default:
          derivedPaymentStatus = "PENDING";
          derivedFulfilmentStatus = "CREATED";
      }
    }
    if (opts.paymentStatus) derivedPaymentStatus = opts.paymentStatus;
    if (opts.fulfilmentStatus) derivedFulfilmentStatus = opts.fulfilmentStatus;
  }

  const order = await prisma.order.create({
    data: {
      id,
      displayId,
      userId: opts.userId,
      customerName: opts.customerName ?? "M1 Test Customer",
      customerPhone: "9876543210",
      customerEmail: "m1test_cust@example.test",
      shippingAddress: opts.shippingAddress ?? {
        line1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      subtotal,
      shippingFee: opts.shippingFee ?? 0,
      total,
      paymentStatus: derivedPaymentStatus,
      fulfilmentStatus: derivedFulfilmentStatus,
      paymentMethod: opts.paymentMethod ?? "RAZORPAY",
      stockDeducted: opts.stockDeducted ?? false,
      storeCreditApplied: opts.storeCreditApplied ?? 0,
      couponCode: opts.couponCode,
      discountAmount: opts.discountAmount,
      razorpayOrderId: opts.razorpayOrderId,
      razorpayPaymentId: opts.razorpayPaymentId,
      paidAt: opts.paidAt,
      shippedAt:
        opts.shippedAt !== undefined
          ? opts.shippedAt
          : derivedFulfilmentStatus === "SHIPPED" || derivedFulfilmentStatus === "DELIVERED" || derivedFulfilmentStatus === "RTO"
          ? opts.paidAt ?? new Date()
          : null,
      createdAt: opts.createdAt,
      items: {
        create: opts.items.map((it) => ({
          id: genId("m1test_itm"),
          productId: it.productId,
          variantId: it.variantId,
          name: it.name ?? "Test Item",
          size: it.size ?? "M",
          unitPrice: it.unitPrice,
          qty: it.qty,
          isGift: it.isGift ?? false,
          discountPaise: it.discountPaise ?? 0,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  if (opts.couponCode) {
    const offer = await prisma.offer.findFirst({
      where: { code: opts.couponCode },
    });
    if (offer) {
      await prisma.offerRedemption.create({
        data: {
          orderId: order.id,
          offerId: offer.id,
          userId: opts.userId,
          amountPaise: opts.discountAmount || 1000,
        },
      });
    }
  }

  return order;
}

export async function cleanupM1TestRows(): Promise<{ remainingTotal: number; details: Record<string, number> }> {
  // Find all m1test users and their orders first to avoid foreign key violations
  const m1Users = await prisma.user.findMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { email: { startsWith: "m1test" } },
      ],
    },
    select: { id: true },
  });
  const m1UserIds = m1Users.map((u) => u.id);

  const m1Orders = await prisma.order.findMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { in: m1UserIds } },
        { displayId: { startsWith: "m1test" } },
      ],
    },
    select: { id: true },
  });
  const m1OrderIds = m1Orders.map((o) => o.id);

  // Delete in order of dependencies (children first)
  // 1. OrderStatusEvent
  await prisma.orderStatusEvent.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { in: m1OrderIds } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 2. ReturnRequest
  await prisma.returnRequest.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { in: m1OrderIds } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 2b. CreditNoteLine & CreditNote
  await prisma.creditNoteLine.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { creditNote: { orderId: { in: m1OrderIds } } },
        { creditNote: { orderId: { startsWith: "m1test" } } },
      ],
    },
  });

  await prisma.creditNote.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { in: m1OrderIds } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 2c. InvoiceLine & Invoice
  await prisma.invoiceLine.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { invoice: { orderId: { in: m1OrderIds } } },
        { invoice: { orderId: { startsWith: "m1test" } } },
      ],
    },
  });

  await prisma.invoice.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { in: m1OrderIds } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  // 2d. GstRule
  await prisma.gstRule.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { name: { startsWith: "m1test" } },
      ],
    },
  });

  // 3. OrderItem
  await prisma.orderItem.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { in: m1OrderIds } },
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
        { userId: { in: m1UserIds } },
        { userId: { startsWith: "m1test" } },
        { relatedOrderId: { in: m1OrderIds } },
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

  // 6b. Offers & Collections cleanup
  await prisma.orderDiscount.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.offerRedemption.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { offerId: { startsWith: "m1test" } },
        { orderId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.offerTarget.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { offerId: { startsWith: "m1test" } },
        { categoryId: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
        { collectionId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.productCollection.deleteMany({
    where: {
      OR: [
        { productId: { startsWith: "m1test" } },
        { collectionId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.offer.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { name: { startsWith: "m1test" } },
        { code: { startsWith: "m1test" } },
        { code: { startsWith: "M1TEST" } },
        { legacyCouponId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.collection.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { slug: { startsWith: "m1test" } },
        { name: { startsWith: "m1test" } },
      ],
    },
  });

  // 7. Order
  await prisma.order.deleteMany({
    where: {
      OR: [
        { id: { in: m1OrderIds } },
        { id: { startsWith: "m1test" } },
        { userId: { in: m1UserIds } },
        { userId: { startsWith: "m1test" } },
        { displayId: { startsWith: "m1test" } },
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

  // 11b. Category
  await prisma.category.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { slug: { startsWith: "m1test" } },
      ],
    },
  });

  // 12. CartItem and Cart
  await prisma.cartItem.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { cart: { userId: { startsWith: "m1test" } } },
        { productId: { startsWith: "m1test" } },
        { variantId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.cart.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
      ],
    },
  });

  // 13. Address
  await prisma.address.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
      ],
    },
  });

  // 13. Review, StockNotification, NewsletterSubscriber, OtpCode
  await prisma.review.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.stockNotification.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { email: { startsWith: "m1test" } },
        { productId: { startsWith: "m1test" } },
        { variantId: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.newsletterSubscriber.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { email: { startsWith: "m1test" } },
      ],
    },
  });

  await prisma.otpCode.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { identifier: { startsWith: "m1test" } },
      ],
    },
  });

  // 14. Session
  await prisma.session.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { userId: { startsWith: "m1test" } },
      ],
    },
  });

  // 15. AuditLog
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { actorId: { startsWith: "m1test" } },
      ],
    },
  });

  // 16. StaffAllowlist
  await prisma.staffAllowlist.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "m1test" } },
        { email: { startsWith: "m1test" } },
      ],
    },
  });

  // 17. User
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
    orderDiscounts: await prisma.orderDiscount.count({ where: { id: { startsWith: "m1test" } } }),
    offerRedemptions: await prisma.offerRedemption.count({ where: { id: { startsWith: "m1test" } } }),
    offerTargets: await prisma.offerTarget.count({ where: { id: { startsWith: "m1test" } } }),
    productCollections: await prisma.productCollection.count({ where: { OR: [{ productId: { startsWith: "m1test" } }, { collectionId: { startsWith: "m1test" } }] } }),
    offers: await prisma.offer.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { code: { startsWith: "m1test" } }, { code: { startsWith: "M1TEST" } }] } }),
    collections: await prisma.collection.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { slug: { startsWith: "m1test" } }] } }),
    invoices: await prisma.invoice.count({ where: { id: { startsWith: "m1test" } } }),
    creditNotes: await prisma.creditNote.count({ where: { id: { startsWith: "m1test" } } }),
    gstRules: await prisma.gstRule.count({ where: { id: { startsWith: "m1test" } } }),
    orders: await prisma.order.count({ where: { id: { startsWith: "m1test" } } }),
    productVariants: await prisma.productVariant.count({ where: { id: { startsWith: "m1test" } } }),
    products: await prisma.product.count({ where: { id: { startsWith: "m1test" } } }),
    reviews: await prisma.review.count({ where: { id: { startsWith: "m1test" } } }),
    stockNotifications: await prisma.stockNotification.count({ where: { id: { startsWith: "m1test" } } }),
    newsletterSubscribers: await prisma.newsletterSubscriber.count({ where: { id: { startsWith: "m1test" } } }),
    otpCodes: await prisma.otpCode.count({ where: { id: { startsWith: "m1test" } } }),
    sessions: await prisma.session.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
    auditLogs: await prisma.auditLog.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { actorId: { startsWith: "m1test" } }] } }),
    staffAllowlists: await prisma.staffAllowlist.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { email: { startsWith: "m1test" } }] } }),
    cartItems: await prisma.cartItem.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { cart: { userId: { startsWith: "m1test" } } }] } }),
    carts: await prisma.cart.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
    addresses: await prisma.address.count({ where: { OR: [{ id: { startsWith: "m1test" } }, { userId: { startsWith: "m1test" } }] } }),
    users: await prisma.user.count({ where: { id: { startsWith: "m1test" } } }),
  };

  const remainingTotal = Object.values(remainingCounts).reduce((a, b) => a + b, 0);
  return { remainingTotal, details: remainingCounts };
}
