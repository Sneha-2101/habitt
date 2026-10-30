import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
} from "../helpers/fixtures";

let mockUser: { id: string; role: string } = { id: "m1test_mock_user", role: "CUSTOMER" };

vi.mock("@/lib/guards", () => ({
  requireUser: vi.fn(async () => mockUser),
  requireStaff: vi.fn(async () => mockUser),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: mockUser,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requestStockNotification } from "@/lib/actions/notifications";
import { submitReview, getReviewsForProduct } from "@/lib/actions/reviews";
import { formatReviewerName } from "@/lib/reviews";

describe("T26 & T27: Stock Notification Validation & Review Privacy", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("T26 stock notify: unknown variant, wrong product, archived product -> rejected; 6th request for same email -> rejected", async () => {
    const email = "m1test_stock_user@example.test";

    // 1. Setup active product with variants
    const { product: activeProduct, variants: activeVariants } = await createTestProduct({
      status: "ACTIVE",
      variants: [
        { size: "S", stock: 0 },
        { size: "M", stock: 0 },
        { size: "L", stock: 0 },
        { size: "XL", stock: 0 },
      ],
    });

    const { product: otherProduct, variants: otherVariants } = await createTestProduct({
      status: "ACTIVE",
      variants: [{ size: "S", stock: 0 }],
    });

    const { product: archivedProduct, variants: archivedVariants } = await createTestProduct({
      status: "ARCHIVED",
      variants: [{ size: "M", stock: 0 }],
    });

    // Case A: Unknown variant ID -> rejected
    await expect(
      requestStockNotification(email, activeProduct.id, "m1test_nonexistent_variant")
    ).rejects.toThrow("Product variant is no longer available.");

    // Case B: Variant belonging to wrong product -> rejected
    await expect(
      requestStockNotification(email, activeProduct.id, otherVariants[0].id)
    ).rejects.toThrow("Product variant is no longer available.");

    // Case C: Archived product -> rejected
    await expect(
      requestStockNotification(email, archivedProduct.id, archivedVariants[0].id)
    ).rejects.toThrow("Product is no longer available.");

    // Case D: 6th request for same email -> rejected (max 5 open requests)
    // Create 4 more products/variants to make 5 total distinct open notifications
    const p2 = await createTestProduct({ variants: [{ size: "M", stock: 0 }] });
    const p3 = await createTestProduct({ variants: [{ size: "M", stock: 0 }] });
    const p4 = await createTestProduct({ variants: [{ size: "M", stock: 0 }] });
    const p5 = await createTestProduct({ variants: [{ size: "M", stock: 0 }] });

    // Request 1 to 4 on activeVariants
    await requestStockNotification(email, activeProduct.id, activeVariants[0].id);
    await requestStockNotification(email, activeProduct.id, activeVariants[1].id);
    await requestStockNotification(email, activeProduct.id, activeVariants[2].id);
    await requestStockNotification(email, activeProduct.id, activeVariants[3].id);
    // Request 5
    await requestStockNotification(email, p2.product.id, p2.variants[0].id);

    const count = await prisma.stockNotification.count({
      where: { email, notified: false },
    });
    expect(count).toBe(5);

    // 6th request must be rejected
    await expect(
      requestStockNotification(email, p3.product.id, p3.variants[0].id)
    ).rejects.toThrow("Maximum of 5 open stock notification requests allowed per email.");
  });

  it("T27 reviews: 1001-character comment rejected; reviewer name formatted as first name + last initial", async () => {
    const user = await createTestUser({ name: "Rohan Sharma" });
    mockUser = { id: user.id, role: "CUSTOMER" };

    const { product } = await createTestProduct();

    // 1. 1001-character comment rejected
    const longComment = "a".repeat(1001);
    await expect(submitReview(product.id, 5, longComment)).rejects.toThrow(
      "Review comment must be between 10 and 1000 characters."
    );

    // 2. Also verify short comment (<10 chars) rejected
    await expect(submitReview(product.id, 5, "Too short")).rejects.toThrow(
      "Review comment must be between 10 and 1000 characters."
    );

    // 3. Reviewer name formatting test via getReviewsForProduct
    // Insert reviews with different names directly
    const userA = await createTestUser({ name: "Johnathan Doe" });
    const userB = await createTestUser({ name: "Priya" });
    const userC = await createTestUser({ name: "Vikram Kumar Singh" });

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: userA.id,
        rating: 5,
        comment: "Excellent quality heavyweight tee. Fits perfectly.",
      },
    });

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: userB.id,
        rating: 4,
        comment: "Love the clean minimalist aesthetic. Will buy more.",
      },
    });

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: userC.id,
        rating: 5,
        comment: "Super durable fabric. Highly recommended basic.",
      },
    });

    const reviews = await getReviewsForProduct(product.id);
    expect(reviews.length).toBe(3);

    const names = reviews.map((r) => r.user.name);
    // Rohan Sharma / Johnathan Doe -> "Johnathan D."
    expect(names).toContain("Johnathan D.");
    // Priya -> "Priya"
    expect(names).toContain("Priya");
    // Vikram Kumar Singh -> "Vikram S."
    expect(names).toContain("Vikram S.");

    // Check privacy: none of the returned review objects should leak full name or email or userId
    for (const r of reviews) {
      expect((r as any).userId).toBeUndefined();
      expect((r as any).user.email).toBeUndefined();
      expect(r.user.name).not.toBe("Johnathan Doe");
      expect(r.user.name).not.toBe("Vikram Kumar Singh");
    }

    // Direct unit checks for formatReviewerName
    expect(formatReviewerName("Alice Smith")).toBe("Alice S.");
    expect(formatReviewerName("Bob")).toBe("Bob");
    expect(formatReviewerName("")).toBe("Anonymous");
    expect(formatReviewerName(null)).toBe("Anonymous");
    expect(formatReviewerName(undefined)).toBe("Anonymous");
  });
});

