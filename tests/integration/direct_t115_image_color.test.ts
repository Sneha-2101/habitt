import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, createTestProduct, cleanupM1TestRows, genId } from "../helpers/fixtures";

const mockRequireStaff = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/guards", () => ({
  requireStaff: () => mockRequireStaff(),
}));
vi.mock("@/lib/uploads/image-check", () => ({
  validateImageBuffer: () => ({ mimeType: "image/jpeg", ext: "jpg" }),
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/product-images/${path}` } }),
      }),
    },
  }),
}));

import { addProductImage, updateProductImageColor } from "@/lib/actions/products";
import { resolveFeedVariantImageUrl } from "@/lib/seo/feed";

describe("T115: Color-Tagged Product Images & Feed Selection", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("validates, updates, clears image colors and selects variant-tagged images for feed", async () => {
    const staff = await createTestUser({ role: "STAFF" });
    mockRequireStaff.mockResolvedValue(staff);

    const { product } = await createTestProduct({
      price: 199900,
      variants: [
        { size: "M", stock: 5, color: "Navy" },
        { size: "L", stock: 5, color: "Ivory" },
      ],
    });

    const img1 = await prisma.productImage.create({
      data: {
        id: genId("m1test_img"),
        productId: product.id,
        url: "https://example.com/default.jpg",
        position: 0,
      },
    });
    const img2 = await prisma.productImage.create({
      data: {
        id: genId("m1test_img"),
        productId: product.id,
        url: "https://example.com/ivory.jpg",
        position: 1,
      },
    });

    // Case-insensitive match normalizes to canonical variant color
    await updateProductImageColor(img2.id, product.id, "  ivory ");
    const updatedImg2 = await prisma.productImage.findUnique({ where: { id: img2.id } });
    expect(updatedImg2?.color).toBe("Ivory");

    // Unknown color rejected
    await expect(updateProductImageColor(img2.id, product.id, "Crimson")).rejects.toThrow("Invalid image color");

    // Feed image resolution picks tagged image for Ivory, falls back to first image for Navy
    const productImages = await prisma.productImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
    });
    expect(resolveFeedVariantImageUrl(productImages, "Ivory", null)).toBe("https://example.com/ivory.jpg");
    expect(resolveFeedVariantImageUrl(productImages, "Navy", null)).toBe("https://example.com/default.jpg");

    // Empty clears color
    await updateProductImageColor(img2.id, product.id, "");
    const clearedImg2 = await prisma.productImage.findUnique({ where: { id: img2.id } });
    expect(clearedImg2?.color).toBeNull();

    // addProductImage with valid color saves it
    const fakeFile = new File([new Uint8Array([1, 2, 3])], "navy.jpg", { type: "image/jpeg" });
    const fd = new FormData();
    fd.set("image", fakeFile);
    fd.set("color", "navy");
    await addProductImage(product.id, fd);

    const addedNavy = await prisma.productImage.findFirst({
      where: { productId: product.id, color: "Navy" },
    });
    expect(addedNavy).not.toBeNull();
    expect(img1.id).toBeTruthy();
  });
});
