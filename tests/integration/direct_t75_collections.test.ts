import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import * as guardsModule from "@/lib/guards";
import { type GuardUser, ForbiddenError } from "@/lib/guards";
import {
  createCollection,
  updateCollection,
  setCollectionActive,
  setCollectionPosition,
  deleteCollection,
  setProductCollections,
  setCollectionProducts,
} from "@/lib/actions/collections";
import {
  createTestUser,
  createTestProduct,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";

describe("T75: Collections Foundation and Relationships", () => {
  const createdCollectionIds: string[] = [];
  const createdProductIds: string[] = [];
  const testUserIds: string[] = [];
  const createdOfferIds: string[] = [];

  let staffUser: GuardUser;

  beforeAll(async () => {
    await cleanupM1TestRows();
    const staff = await createTestUser({
      email: `${genId("m1test_staff")}@habitt.test`,
      role: "STAFF",
    });
    testUserIds.push(staff.id);
    staffUser = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: "STAFF",
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Clean up created offer targets and offers
    if (createdOfferIds.length > 0) {
      await prisma.offerTarget.deleteMany({ where: { offerId: { in: createdOfferIds } } });
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
    }
    // Clean up product collections
    if (createdCollectionIds.length > 0 || createdProductIds.length > 0) {
      await prisma.productCollection.deleteMany({
        where: {
          OR: [
            { collectionId: { in: createdCollectionIds } },
            { productId: { in: createdProductIds } },
          ],
        },
      });
      await prisma.collection.deleteMany({ where: { id: { in: createdCollectionIds } } });
    }
    if (createdProductIds.length > 0) {
      await prisma.productVariant.deleteMany({ where: { productId: { in: createdProductIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    if (testUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    }
    await cleanupM1TestRows();
  });

  function mockStaff() {
    vi.spyOn(guardsModule, "requireStaff").mockResolvedValue(staffUser);
  }

  function mockCustomer() {
    vi.spyOn(guardsModule, "requireStaff").mockRejectedValue(new ForbiddenError());
  }

  it("1. Non-staff is rejected on collection management", async () => {
    mockCustomer();
    await expect(
      createCollection({
        name: "m1test_Unauth",
        slug: "m1test-unauth",
        position: 0,
        active: true,
      })
    ).rejects.toThrow();
  });

  it("2. Collection CRUD operations work smoothly", async () => {
    mockStaff();
    const slug = `m1test-col-${Date.now()}`;
    const createRes = await createCollection({
      name: "m1test Collection Alpha",
      slug,
      position: 10,
      active: true,
    });

    expect(createRes.success).toBe(true);
    expect(createRes.collection.name).toBe("m1test Collection Alpha");
    expect(createRes.collection.slug).toBe(slug);
    expect(createRes.collection.position).toBe(10);
    expect(createRes.collection.active).toBe(true);
    createdCollectionIds.push(createRes.collection.id);

    // Update name and position
    const updateRes = await updateCollection(createRes.collection.id, {
      name: "m1test Collection Alpha Renamed",
      position: 5,
    });
    expect(updateRes.success).toBe(true);
    expect(updateRes.collection.name).toBe("m1test Collection Alpha Renamed");
    expect(updateRes.collection.position).toBe(5);

    // Toggle active
    const activeRes = await setCollectionActive(createRes.collection.id, false);
    expect(activeRes.collection.active).toBe(false);

    // Change position directly
    const posRes = await setCollectionPosition(createRes.collection.id, 12);
    expect(posRes.collection.position).toBe(12);
  });

  it("3. Enforces unique collection slug", async () => {
    mockStaff();
    const slug = `m1test-uniq-${Date.now()}`;
    const c1 = await createCollection({
      name: "m1test Unique 1",
      slug,
      position: 0,
      active: true,
    });
    createdCollectionIds.push(c1.collection.id);

    await expect(
      createCollection({
        name: "m1test Unique 2",
        slug,
        position: 1,
        active: true,
      })
    ).rejects.toThrow(/duplicate/i);
  });

  it("4. Product assignment in both directions works correctly", async () => {
    mockStaff();
    const { product: prod1 } = await createTestProduct();
    const { product: prod2 } = await createTestProduct();
    createdProductIds.push(prod1.id, prod2.id);

    const c1 = await createCollection({
      name: "m1test Col A",
      slug: `m1test-col-a-${Date.now()}`,
      position: 1,
      active: true,
    });
    const c2 = await createCollection({
      name: "m1test Col B",
      slug: `m1test-col-b-${Date.now()}`,
      position: 2,
      active: true,
    });
    createdCollectionIds.push(c1.collection.id, c2.collection.id);

    // Direction 1: setProductCollections (assign prod1 to c1 and c2)
    const setProdRes = await setProductCollections(prod1.id, [
      c1.collection.id,
      c2.collection.id,
    ]);
    expect(setProdRes.success).toBe(true);

    const prod1Cols = await prisma.productCollection.findMany({
      where: { productId: prod1.id },
      select: { collectionId: true },
    });
    expect(prod1Cols).toHaveLength(2);
    expect(prod1Cols.map((c) => c.collectionId).sort()).toEqual(
      [c1.collection.id, c2.collection.id].sort()
    );

    // Direction 2: setCollectionProducts (assign c1 to prod1 and prod2)
    const setColRes = await setCollectionProducts(c1.collection.id, [prod1.id, prod2.id]);
    expect(setColRes.success).toBe(true);

    const c1Prods = await prisma.productCollection.findMany({
      where: { collectionId: c1.collection.id },
      select: { productId: true },
    });
    expect(c1Prods).toHaveLength(2);
    expect(c1Prods.map((p) => p.productId).sort()).toEqual([prod1.id, prod2.id].sort());
  });

  it("5. Refuses collection delete when an offer targets it", async () => {
    mockStaff();
    const col = await createCollection({
      name: "m1test Targeted Col",
      slug: `m1test-targeted-${Date.now()}`,
      position: 0,
      active: true,
    });
    createdCollectionIds.push(col.collection.id);

    // Create an offer targeting this collection
    const offer = await prisma.offer.create({
      data: {
        id: genId("m1test_off"),
        name: "m1test Offer on Collection",
        kind: "PERCENT_OFF",
        config: { percent: 10 },
        targets: {
          create: [{ collectionId: col.collection.id }],
        },
      },
    });
    createdOfferIds.push(offer.id);

    // Attempt deleteCollection -> must throw
    await expect(deleteCollection(col.collection.id)).rejects.toThrow(
      /Cannot delete collection because it is targeted by one or more offers/i
    );

    // Remove the target
    await prisma.offerTarget.deleteMany({
      where: { collectionId: col.collection.id },
    });

    // Now delete succeeds
    const delRes = await deleteCollection(col.collection.id);
    expect(delRes.success).toBe(true);

    const verify = await prisma.collection.findUnique({
      where: { id: col.collection.id },
    });
    expect(verify).toBeNull();
  });
});
