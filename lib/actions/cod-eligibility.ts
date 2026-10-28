import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { formatINR } from "@/lib/money";

export interface CodEligibilityResult {
  eligible: boolean;
  reason?: "cod_disabled" | "order_cap_exceeded" | "requires_first_delivery";
  message?: string;
  maxCapRupees?: number;
}

export async function isEligibleForCod(userId: string, subtotal: number): Promise<CodEligibilityResult> {
  const settings = await getSettings();

  if (!settings.codEnabled) {
    return {
      eligible: false,
      reason: "cod_disabled",
      message: "Cash on Delivery is currently disabled.",
    };
  }

  if (subtotal > settings.codOrderCap) {
    return {
      eligible: false,
      reason: "order_cap_exceeded",
      message: `COD is available on orders up to ${formatINR(settings.codOrderCap)}`,
      maxCapRupees: Math.round(settings.codOrderCap / 100),
    };
  }

  // Verified customer check: must have at least 1 delivered order
  const deliveredOrderCount = await prisma.order.count({
    where: {
      userId,
      status: "DELIVERED",
    },
  });

  if (deliveredOrderCount < 1) {
    return {
      eligible: false,
      reason: "requires_first_delivery",
      message: "COD available on orders after your first delivered order",
    };
  }

  return {
    eligible: true,
  };
}
