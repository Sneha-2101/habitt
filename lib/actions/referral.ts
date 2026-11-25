"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/guards";
import { attachReferral } from "@/lib/rewards/service";

const NEUTRAL_MESSAGE =
  "If the code is valid and your account is eligible, it has been noted.";

export async function applyReferralCodeAction(code: string): Promise<{ message: string }> {
  const user = await requireUser();
  try {
    await attachReferral(user.id, code || "");
  } catch {
    // Always return neutral response
  }
  revalidatePath("/account/referrals");
  return { message: NEUTRAL_MESSAGE };
}
