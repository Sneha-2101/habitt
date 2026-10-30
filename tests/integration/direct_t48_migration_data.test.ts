import { describe, it, expect } from "vitest";
import { prisma } from "../helpers/prisma";

describe("T48: Migration data integrity check", () => {
  it("every STAFF or OWNER user with a non-null email has an active StaffAllowlist row", async () => {
    const staffAndOwners = await prisma.user.findMany({
      where: {
        role: { in: ["STAFF", "OWNER"] },
        email: { not: null },
      },
    });

    for (const u of staffAndOwners) {
      const allowlistEntry = await prisma.staffAllowlist.findUnique({
        where: { email: u.email!.trim().toLowerCase() },
      });

      expect(allowlistEntry).not.toBeNull();
      expect(allowlistEntry?.active).toBe(true);
      expect(allowlistEntry?.role).toBe(u.role);
    }
  });
});

