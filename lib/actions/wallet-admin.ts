"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/guards";
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
