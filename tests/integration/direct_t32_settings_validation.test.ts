import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { SiteSettings } from "@prisma/client";

const mockCurrentUser = { id: "staff_1", role: "STAFF", name: "Staff Member" };

vi.mock("@/lib/guards", () => ({
  requireStaff: vi.fn(async () => mockCurrentUser),
  requireRole: vi.fn(),
  requireUser: vi.fn(async () => mockCurrentUser),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { updateSettings, type UpdateSiteSettingsInput } from "@/lib/actions/settings";

describe("T32: Site Settings Validation and Persistence", () => {
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findFirst();
  });

  afterAll(async () => {
    if (originalSettings) {
      const { id, ...data } = originalSettings;
      await prisma.siteSettings.update({
        where: { id },
        data,
      });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid pincode, phone, email, and refund hours", async () => {
    // Bad pincode (not 6 digits)
    await expect(
      updateSettings({ businessPincode: "123" } as unknown as UpdateSiteSettingsInput)
    ).rejects.toThrow("Business pincode must be a 6-digit number");

    // Bad phone (not 10 digits)
    await expect(
      updateSettings({ businessPhone: "12345" } as unknown as UpdateSiteSettingsInput)
    ).rejects.toThrow("Must be a valid 10-digit Indian mobile number");

    // Bad email
    await expect(
      updateSettings({ supportEmail: "invalid-email" } as unknown as UpdateSiteSettingsInput)
    ).rejects.toThrow("Invalid support email address");

    // Negative refund processing hours
    await expect(
      updateSettings({ refundProcessingHours: -5 } as unknown as UpdateSiteSettingsInput)
    ).rejects.toThrow("Refund processing hours must be between 1 and 240");
  });

  it("successfully validates and updates valid settings", async () => {
    const updated = await updateSettings({
      legalName: "Habitt Apparels Pvt Ltd",
      businessPhone: "+91 9876543210",
      whatsappSupportNumber: "9876543211",
      businessState: "Karnataka",
      businessPincode: "560001",
      shiprocketPickupLocation: "Warehouse 1",
      freeShippingOnPrepaid: true,
      codRequiresDeliveredOrder: true,
      freeReturnShipping: false,
      refundProcessingHours: 72,
      maxDeliveryDays: 5,
    });

    expect(updated.legalName).toBe("Habitt Apparels Pvt Ltd");
    expect(updated.businessPhone).toBe("9876543210");
    expect(updated.whatsappSupportNumber).toBe("9876543211");
    expect(updated.businessState).toBe("Karnataka");
    expect(updated.businessPincode).toBe("560001");
    expect(updated.shiprocketPickupLocation).toBe("Warehouse 1");
    expect(updated.freeShippingOnPrepaid).toBe(true);
    expect(updated.codRequiresDeliveredOrder).toBe(true);
    expect(updated.freeReturnShipping).toBe(false);
    expect(updated.refundProcessingHours).toBe(72);
    expect(updated.maxDeliveryDays).toBe(5);

    // Verify persisted directly in database
    const saved = await prisma.siteSettings.findUnique({ where: { id: "default" } });
    expect(saved?.legalName).toBe("Habitt Apparels Pvt Ltd");
    expect(saved?.businessPhone).toBe("9876543210");
    expect(saved?.businessPincode).toBe("560001");
    expect(saved?.refundProcessingHours).toBe(72);
  });
});
