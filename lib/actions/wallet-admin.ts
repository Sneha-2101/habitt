"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { adminAdjustWallet } from "@/lib/wallet/service";

const adjustWalletSchema = z.object({
  userId: z.string().trim().min(1, "Customer ID is required"),
  deltaPaise: z
    .number()
    .int("Amount must be an integer in paise")
    .refine((val) => val !== 0, "Adjustment amount cannot be zero"),
  reason: z
    .string()
    .trim()
    .min(3, "Reason must be at least 3 characters")
    .max(300, "Reason cannot exceed 300 characters"),
  note: z.string().trim().max(500).optional(),
});

const rewardSettingsSchema = z.object({
  promoCreditExpiryDays: z
    .number()
    .int("Promo expiry days must be an integer")
    .min(1, "Promo expiry days must be at least 1")
    .max(3650, "Promo expiry days cannot exceed 3650"),
  walletMaxPercentOfOrder: z
    .number()
    .int("Max wallet percent must be an integer")
    .min(0, "Max wallet percent must be 0..100")
    .max(100, "Max wallet percent must be 0..100"),
  maxAdminAdjustPaise: z
    .number()
    .int("Max admin adjustment must be an integer in paise")
    .min(1, "Max admin adjustment must be at least 1 paise")
    .max(5000000, "Max admin adjustment cannot exceed 5000000 paise"),
});

export async function adjustCustomerWalletAction(input: {
  userId: string;
  deltaPaise: number;
  reason: string;
  note?: string;
}) {
  const actor = await requireRole("OWNER");
  const parsed = adjustWalletSchema.parse(input);

  const result = await adminAdjustWallet({
    actorId: actor.id,
    userId: parsed.userId,
    deltaPaise: parsed.deltaPaise,
    reason: parsed.reason,
    note: parsed.note || null,
  });

  revalidatePath("/admin/rewards");
  return {
    ok: true as const,
    balancePaise: result.balancePaise,
  };
}

export async function updateRewardSettingsAction(input: {
  promoCreditExpiryDays: number;
  walletMaxPercentOfOrder: number;
  maxAdminAdjustPaise: number;
}) {
  const actor = await requireRole("OWNER");
  const parsed = rewardSettingsSchema.parse(input);

  const before = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: {
      promoCreditExpiryDays: true,
      walletMaxPercentOfOrder: true,
      maxAdminAdjustPaise: true,
    },
  });

  const updated = await prisma.siteSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      promoCreditExpiryDays: parsed.promoCreditExpiryDays,
      walletMaxPercentOfOrder: parsed.walletMaxPercentOfOrder,
      maxAdminAdjustPaise: parsed.maxAdminAdjustPaise,
    },
    update: {
      promoCreditExpiryDays: parsed.promoCreditExpiryDays,
      walletMaxPercentOfOrder: parsed.walletMaxPercentOfOrder,
      maxAdminAdjustPaise: parsed.maxAdminAdjustPaise,
    },
    select: {
      promoCreditExpiryDays: true,
      walletMaxPercentOfOrder: true,
      maxAdminAdjustPaise: true,
    },
  });

  await writeAudit({
    actorId: actor.id,
    action: "REWARD_SETTINGS_UPDATED",
    entity: "SiteSettings",
    entityId: "default",
    meta: {
      before: before ?? null,
      after: updated,
    },
  });

  revalidatePath("/admin/rewards");
  revalidatePath("/checkout");

  return {
    ok: true as const,
    settings: updated,
  };
}
