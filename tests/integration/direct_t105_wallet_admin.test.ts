import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser } from "../helpers/fixtures";
import * as guardsModule from "@/lib/guards";
import { adjustCustomerWalletAction } from "@/lib/actions/wallet-admin";
import { getWalletSummary } from "@/lib/wallet/service";
import { SiteSettings } from "@prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("T105: Wallet Admin Actions (OWNER-only, Audit, Cap)", () => {
  let ownerUser: { id: string; email: string; role: "OWNER" };
  let staffUser: { id: string; email: string; role: "STAFF" };
  let customerUser: { id: string; email: string; role: "CUSTOMER" };
  let originalSettings: SiteSettings | null = null;

  beforeAll(async () => {
    originalSettings = await prisma.siteSettings.findUnique({
      where: { id: "default" },
    });
    await cleanupM1TestRows();
    const o = await createTestUser({ role: "OWNER" });
    ownerUser = { id: o.id, email: o.email!, role: "OWNER" };
    const s = await createTestUser({ role: "STAFF" });
    staffUser = { id: s.id, email: s.email!, role: "STAFF" };
    const c = await createTestUser({ role: "CUSTOMER" });
    customerUser = { id: c.id, email: c.email!, role: "CUSTOMER" };
  });

  afterAll(async () => {
    try {
      if (originalSettings) {
        const { id: _id, updatedAt: _up, ...rest } = originalSettings;
        void _id;
        void _up;
        await prisma.siteSettings.upsert({
          where: { id: "default" },
          create: { id: "default", ...rest },
          update: { ...rest },
        });
      }
      await prisma.walletEntry.deleteMany({ where: { userId: customerUser.id } });
      await prisma.walletLot.deleteMany({ where: { userId: customerUser.id } });
      await prisma.auditLog.deleteMany({
        where: { actorId: { in: [ownerUser.id, staffUser.id, customerUser.id] } },
      });
    } finally {
      await cleanupM1TestRows();
    }
  });

  it("blocks STAFF and CUSTOMER from adjusting customer wallet", async () => {
    vi.spyOn(guardsModule, "requireRole").mockRejectedValueOnce(
      new guardsModule.ForbiddenError()
    );
    await expect(
      adjustCustomerWalletAction({
        userId: customerUser.id,
        deltaPaise: 5000,
        reason: "Unauthorized staff attempt",
      })
    ).rejects.toThrow(guardsModule.ForbiddenError);
  });

  it("allows OWNER to credit & debit wallet, enforces maxAdminAdjustPaise, and writes AuditLog", async () => {
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue(ownerUser);

    const creditRes = await adjustCustomerWalletAction({
      userId: customerUser.id,
      deltaPaise: 15000,
      reason: "Goodwill credit",
    });
    expect(creditRes.ok).toBe(true);
    expect(creditRes.balancePaise).toBe(15000);

    const debitRes = await adjustCustomerWalletAction({
      userId: customerUser.id,
      deltaPaise: -5000,
      reason: "Correction debit",
    });
    expect(debitRes.ok).toBe(true);
    expect(debitRes.balancePaise).toBe(10000);

    const summary = await getWalletSummary(customerUser.id);
    expect(summary.balancePaise).toBe(10000);
    expect(summary.byKind.ADJUST).toBe(10000);

    const maxAdjust = originalSettings?.maxAdminAdjustPaise ?? 500000;
    await expect(
      adjustCustomerWalletAction({
        userId: customerUser.id,
        deltaPaise: maxAdjust + 1,
        reason: "Exceeds cap",
      })
    ).rejects.toThrow("exceeds maximum allowed limit");

    const audits = await prisma.auditLog.findMany({
      where: {
        actorId: ownerUser.id,
        action: "WALLET_ADMIN_ADJUST",
        entityId: customerUser.id,
      },
    });
    expect(audits.length).toBe(2);
  });
});
