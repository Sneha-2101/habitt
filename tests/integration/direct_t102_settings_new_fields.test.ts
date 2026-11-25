import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { SiteSettings } from "@prisma/client";

const mockStaffUser = { id: "", role: "STAFF", name: "Staff Member" };

vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => mockStaffUser),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateSettings } from "@/lib/actions/settings";
import { getBusinessProfile } from "@/lib/site/business";
import { runTicketSlaJob } from "@/lib/tickets/sla";

describe("T102: New SiteSettings Fields & Ticket SLA Without Support Email", () => {
  let originalSettings: SiteSettings | null = null;
  let staffUserId = "";

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    const staffUser = await createTestUser({ role: "STAFF" });
    staffUserId = staffUser.id;
    mockStaffUser.id = staffUser.id;
    mockStaffUser.name = staffUser.name;
  });

  afterAll(async () => {
    try {
      if (staffUserId) {
        await prisma.auditLog.deleteMany({ where: { actorId: staffUserId } });
        await prisma.user.deleteMany({ where: { id: staffUserId } });
      }
      await cleanupM1TestRows();
    } finally {
      if (originalSettings) {
        const { id, ...data } = originalSettings;
        await prisma.siteSettings.update({
          where: { id },
          data,
        });
      }
    }
  });

  it("validates new URL, email, phone, pincode fields and persists them to getBusinessProfile", async () => {
    await expect(
      updateSettings({ instagramUrl: "http://insecure.example.com" })
    ).rejects.toThrow("Social URL must be a valid https:// URL");

    await expect(
      updateSettings({ pickupPincode: "12" })
    ).rejects.toThrow("Business pincode must be a 6-digit number");

    await expect(
      updateSettings({ pickupPhone: "999" })
    ).rejects.toThrow("Must be a valid 10-digit Indian mobile number");

    await updateSettings({
      businessAddressLine1: "42 Studio Lane",
      businessCity: "Chandigarh",
      pickupAddressLine1: "Warehouse 9",
      pickupCity: "Ludhiana",
      pickupPincode: "141001",
      pickupPhone: "+91 9876543210",
      ordersEmail: "orders@example.com",
      replyToEmail: "reply@example.com",
      dispatchHandlingNote: "Ships within 24 hours on working days",
      instagramUrl: "https://instagram.com/habitt",
      facebookUrl: "https://facebook.com/habitt",
    });

    const profile = await getBusinessProfile();
    expect(profile.addressLine1).toBe("42 Studio Lane");
    expect(profile.city).toBe("Chandigarh");
    expect(profile.pickup.addressLine1).toBe("Warehouse 9");
    expect(profile.pickup.pincode).toBe("141001");
    expect(profile.pickup.phone).toBe("9876543210");
    expect(profile.ordersEmail).toBe("orders@example.com");
    expect(profile.replyToEmail).toBe("reply@example.com");
    expect(profile.dispatchHandlingNote).toBe("Ships within 24 hours on working days");
    expect(profile.social.instagramUrl).toBe("https://instagram.com/habitt");
    expect(profile.social.facebookUrl).toBe("https://facebook.com/habitt");
  });

  it("runTicketSlaJob skips SLA alert without throwing when supportEmail & grievanceOfficerEmail are empty", async () => {
    await prisma.siteSettings.update({
      where: { id: "default" },
      data: { supportEmail: "", grievanceOfficerEmail: null },
    });

    const user = await createTestUser();
    const past = new Date(Date.now() - 48 * 3600_000);
    await prisma.ticket.create({
      data: {
        number: `m1test_tkt_${genId().slice(0, 8)}`,
        userId: user.id,
        category: "ORDER",
        subject: "m1test SLA skip test",
        status: "OPEN",
        source: "ACCOUNT",
        ackDueAt: past,
        resolveDueAt: past,
      },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await runTicketSlaJob();
      expect(result.ackBreaches).toBe(0);
      expect(result.resolveBreaches).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
