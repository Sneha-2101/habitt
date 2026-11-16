import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "../helpers/prisma";
import {
  createTestUser,
  cleanupM1TestRows,
  genId,
} from "../helpers/fixtures";
import {
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "@/lib/actions/account";
import { createSession } from "@/lib/sessions";
import * as sessionsModule from "@/lib/sessions";

describe("T52, T53: Address book actions and partial unique index", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T52: address validation, max 10, first default, concurrent setDefault, delete default promotes another, user scoping", async () => {
    const userA = await createTestUser({ email: `${genId("m1test_addrA")}@habitt.test` });
    const userB = await createTestUser({ email: `${genId("m1test_addrB")}@habitt.test` });
    const { sid: sidA } = await createSession({ userId: userA.id, role: "CUSTOMER" });
    const { sid: sidB } = await createSession({ userId: userB.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userA.id,
      role: "CUSTOMER",
      email: userA.email,
      phone: userA.phone ?? null,
      name: userA.name,
      sid: sidA,
      stepUpAt: null,
    });

    // 1. Validation errors (invalid pincode / invalid phone)
    await expect(
      createAddress({
        fullName: "Aarav",
        phone: "123", // invalid phone
        line1: "123 Main Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Home",
      })
    ).rejects.toThrow();

    await expect(
      createAddress({
        fullName: "Aarav",
        phone: "9876543210",
        line1: "123 Main Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "1234", // invalid pincode length
        label: "Home",
      })
    ).rejects.toThrow();

    // 2. First address becomes default automatically
    const addr1 = await createAddress({
      fullName: "Aarav First",
      phone: "9876543210",
      line1: "123 First Road",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      label: "Home",
      isDefault: false, // even if passed false, first becomes default
    });
    expect(addr1.isDefault).toBe(true);

    // Create addr2 and addr3
    const addr2 = await createAddress({
      fullName: "Aarav Second",
      phone: "9876543210",
      line1: "456 Second Road",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      label: "Work",
      isDefault: false,
    });
    expect(addr2.isDefault).toBe(false);

    const addr3 = await createAddress({
      fullName: "Aarav Third",
      phone: "9876543210",
      line1: "789 Third Road",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      label: "Other",
      isDefault: false,
    });

    // 3. Concurrent setDefault: 5 concurrent calls leave exactly one default
    const addrsToToggle = [addr1.id, addr2.id, addr3.id, addr1.id, addr2.id];
    await Promise.all(addrsToToggle.map((id) => setDefaultAddress(id)));

    const defaultsA = await prisma.address.findMany({
      where: { userId: userA.id, isDefault: true },
    });
    expect(defaultsA).toHaveLength(1);

    // 4. Delete default promotes the most recently updated remaining address
    const currentDefault = defaultsA[0];
    await deleteAddress(currentDefault.id);

    const newDefaultsA = await prisma.address.findMany({
      where: { userId: userA.id, isDefault: true },
    });
    expect(newDefaultsA).toHaveLength(1);
    expect(newDefaultsA[0].id).not.toBe(currentDefault.id);

    // 5. User B scoping: User B cannot edit/delete/default User A's address
    // Returns identical generic "Address not found" for nonexistent and not-yours
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userB.id,
      role: "CUSTOMER",
      email: userB.email,
      phone: userB.phone ?? null,
      name: userB.name,
      sid: sidB,
      stepUpAt: null,
    });

    await expect(deleteAddress(addr2.id)).rejects.toThrow("Address not found");
    await expect(deleteAddress("nonexistent_id")).rejects.toThrow("Address not found");
    await expect(setDefaultAddress(addr2.id)).rejects.toThrow("Address not found");
    await expect(
      updateAddress(addr2.id, {
        fullName: "Hacker",
        phone: "9876543210",
        line1: "Hacked Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Home",
      })
    ).rejects.toThrow("Address not found");

    // 6. Max 10 addresses per user
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userA.id,
      role: "CUSTOMER",
      email: userA.email,
      phone: userA.phone ?? null,
      name: userA.name,
      sid: sidA,
      stepUpAt: null,
    });

    // Currently User A has 2 addresses. Add 8 more to reach 10.
    for (let i = 3; i <= 10; i++) {
      await createAddress({
        fullName: `Aarav ${i}`,
        phone: "9876543210",
        line1: `${i} Test Street`,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Home",
      });
    }

    const countA = await prisma.address.count({ where: { userId: userA.id } });
    expect(countA).toBe(10);

    // 11th address should fail
    await expect(
      createAddress({
        fullName: "Aarav 11",
        phone: "9876543210",
        line1: "11 Test Street",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Home",
      })
    ).rejects.toThrow("Maximum of 10 addresses allowed.");
  });

  it("T52.2: concurrent creates at 9 addresses end with exactly 10", async () => {
    const userC = await createTestUser({ email: `${genId("m1test_addrC")}@habitt.test` });
    const { sid: sidC } = await createSession({ userId: userC.id, role: "CUSTOMER" });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: userC.id,
      role: "CUSTOMER",
      email: userC.email,
      phone: userC.phone ?? null,
      name: userC.name,
      sid: sidC,
      stepUpAt: null,
    });

    // Create 9 addresses sequentially
    for (let i = 1; i <= 9; i++) {
      await createAddress({
        fullName: `User ${i}`,
        phone: "9876543210",
        line1: `${i} Test Street`,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Home",
      });
    }

    const countBefore = await prisma.address.count({ where: { userId: userC.id } });
    expect(countBefore).toBe(9);

    // Fire 3 concurrent creates at 9 addresses
    const creates = [10, 11, 12].map((num) =>
      createAddress({
        fullName: `User ${num}`,
        phone: "9876543210",
        line1: `${num} Parallel Street`,
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        label: "Work",
      })
    );

    const results = await Promise.allSettled(creates);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect((r.reason as Error).message).toContain("Maximum of 10 addresses allowed.");
      }
    }

    const countAfter = await prisma.address.count({ where: { userId: userC.id } });
    expect(countAfter).toBe(10);
  });

  it("T53: Database partial unique index exists and no user has > 1 default", async () => {
    // Query pg_indexes for Address_one_default_per_user partial index
    const indexes: Array<{ indexname: string; indexdef: string }> = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Address' AND indexname = 'Address_one_default_per_user';
    `;

    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes[0].indexdef.toLowerCase()).toContain("where");
    expect(indexes[0].indexdef.toLowerCase()).toContain("isdefault");

    // Confirm that in the live database no user has more than 1 default address
    const duplicates: Array<{ userId: string; default_count: bigint }> = await prisma.$queryRaw`
      SELECT "userId", count(*) as default_count
      FROM "Address"
      WHERE "isDefault" = true
      GROUP BY "userId"
      HAVING count(*) > 1;
    `;

    expect(duplicates).toHaveLength(0);
  });
});
