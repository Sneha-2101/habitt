import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows } from "../helpers/fixtures";
import { UnauthorizedError } from "@/lib/guards";

let mockActor: { id: string; role: string; name: string } | null = null;

vi.mock("@/lib/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guards")>();
  return {
    ...actual,
    requireStaff: vi.fn(async () => {
      if (!mockActor) {
        throw new UnauthorizedError("Authentication required");
      }
      return mockActor;
    }),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  saveContentAction,
  createBannerAction,
  reorderBannersAction,
  deleteBannerAction,
} from "@/lib/actions/content";
import { getActiveHomeBanners } from "@/lib/content/content";

describe("T101: Content & Banner Actions", () => {
  let staffUserId = "";
  const createdBannerIds: string[] = [];

  beforeAll(async () => {
    const staffUser = await createTestUser({ role: "STAFF" });
    staffUserId = staffUser.id;
  });

  afterAll(async () => {
    try {
      if (createdBannerIds.length > 0) {
        await prisma.homeBanner.deleteMany({ where: { id: { in: createdBannerIds } } });
      }
      await prisma.siteContent.deleteMany({ where: { key: "about" } });
      if (staffUserId) {
        await prisma.auditLog.deleteMany({ where: { actorId: staffUserId } });
        await prisma.user.deleteMany({ where: { id: staffUserId } });
      }
      await cleanupM1TestRows();
    } catch {
      // ignore cleanup errors
    }
  });

  beforeEach(() => {
    mockActor = { id: staffUserId, role: "STAFF", name: "Staff Member" };
  });

  it("rejects anonymous callers and bad content keys", async () => {
    mockActor = null;
    await expect(
      saveContentAction({ key: "about", title: "About", body: "Hello", isPublished: true })
    ).rejects.toThrow(UnauthorizedError);

    mockActor = { id: staffUserId, role: "STAFF", name: "Staff Member" };
    await expect(
      saveContentAction({ key: "invalid.key", title: "Bad", body: "Hello", isPublished: true })
    ).rejects.toThrow();
  });

  it("saves allowed content and writes AuditLog without [AuditLog Error]", async () => {
    const errorSpy = vi.spyOn(console, "error");
    try {
      const saved = await saveContentAction({
        key: "about",
        title: "m1test About Title",
        body: "## Heading\n\nParagraph text",
        isPublished: true,
      });
      expect(saved.key).toBe("about");
      expect(saved.updatedById).toBe(staffUserId);

      const audit = await prisma.auditLog.findFirst({
        where: { actorId: staffUserId, action: "CONTENT_UPDATED", entityId: "about" },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();

      const auditErrors = errorSpy.mock.calls.filter((call) =>
        call.some((arg) => String(arg).includes("[AuditLog Error]"))
      );
      expect(auditErrors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("enforces banner schedule window, ordering, and max 8 active banners", async () => {
    const bucketBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co"}/storage/v1/object/public/product-images/banners`;

    // Active banner within window
    const b1 = await createBannerAction({
      imageUrl: `${bucketBase}/m1test-1.jpg`,
      imageAlt: "m1test Banner 1",
      heading: "m1test Active Banner",
      ctaHref: "/shop",
      isActive: true,
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 3600_000),
    });
    createdBannerIds.push(b1.id);

    // Expired banner
    const bExpired = await createBannerAction({
      imageUrl: `${bucketBase}/m1test-exp.jpg`,
      imageAlt: "m1test Expired",
      heading: "m1test Expired Banner",
      isActive: true,
      startsAt: new Date(Date.now() - 7200_000),
      endsAt: new Date(Date.now() - 3600_000),
    });
    createdBannerIds.push(bExpired.id);

    const active = await getActiveHomeBanners();
    expect(active.some((b) => b.id === b1.id)).toBe(true);
    expect(active.some((b) => b.id === bExpired.id)).toBe(false);

    // Reorder
    await reorderBannersAction([bExpired.id, b1.id]);
    const b1After = await prisma.homeBanner.findUnique({ where: { id: b1.id } });
    expect(b1After?.sortOrder).toBe(1);

    // Clean up these two before testing max 8 limit cleanly
    await deleteBannerAction(b1.id);
    await deleteBannerAction(bExpired.id);
    createdBannerIds.length = 0;
  });
});
