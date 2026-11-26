import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows } from "../helpers/fixtures";

const mockRequireStaff = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/guards", () => ({
  requireStaff: () => mockRequireStaff(),
}));

import { updateSettings } from "@/lib/actions/settings";

describe("T113: SEO Settings Governance & Validation", () => {
  let savedSettings: Awaited<ReturnType<typeof prisma.siteSettings.findUnique>> = null;

  beforeAll(async () => {
    savedSettings = await prisma.siteSettings.findUnique({ where: { id: "default" } });
  });

  afterAll(async () => {
    try {
      if (savedSettings) {
        const restoreData = { ...savedSettings } as Record<string, unknown>;
        delete restoreData.id;
        delete restoreData.updatedAt;
        await prisma.siteSettings.update({
          where: { id: "default" },
          data: restoreData,
        });
      }
    } finally {
      await cleanupM1TestRows();
    }
  });

  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("blocks STAFF from toggling seoIndexingEnabled, allows OWNER, and validates verification token", async () => {
    const staff = await createTestUser({ role: "STAFF" });
    const owner = await createTestUser({ role: "OWNER" });
    const current = await prisma.siteSettings.findUniqueOrThrow({ where: { id: "default" } });

    mockRequireStaff.mockResolvedValue(staff);
    await expect(
      updateSettings({ seoIndexingEnabled: !current.seoIndexingEnabled })
    ).rejects.toThrow("Only the store Owner can change search engine indexing settings.");

    mockRequireStaff.mockResolvedValue(owner);
    await expect(
      updateSettings({ googleSiteVerification: "bad!" })
    ).rejects.toThrow("Google site verification token");

    const updated = await updateSettings({
      seoIndexingEnabled: !current.seoIndexingEnabled,
      googleSiteVerification: "m1test_token_123456",
      ogDefaultImageUrl: "https://cdn.example.com/og-default.jpg",
    });

    expect(updated.seoIndexingEnabled).toBe(!current.seoIndexingEnabled);
    expect(updated.googleSiteVerification).toBe("m1test_token_123456");
    expect(updated.ogDefaultImageUrl).toBe("https://cdn.example.com/og-default.jpg");
  });
});
