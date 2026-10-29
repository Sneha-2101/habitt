import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { formatINR } from "@/lib/money";

export interface CodEligibilityResult {
  eligible: boolean;
  reason?: string;
  message?: string;
  maxCapRupees?: number;
}

export async function isEligibleForCod(
  userId: string,
  subtotal: number
): Promise<CodEligibilityResult> {
  const settings = await getSettings();

  if (!settings.codEnabled) {
    const msg = "Cash on Delivery is currently disabled.";
    return {
      eligible: false,
      reason: msg,
      message: msg,
    };
  }

  if (subtotal > settings.codOrderCap) {
    const msg = `COD is available on orders up to ${formatINR(settings.codOrderCap)}`;
    return {
      eligible: false,
      reason: msg,
      message: msg,
      maxCapRupees: Math.round(settings.codOrderCap / 100),
    };
  }

  // Verified customer check: must have at least 1 delivered order if required by settings
  if (settings.codRequiresDeliveredOrder) {
    const deliveredOrderCount = await prisma.order.count({
      where: {
        userId,
        status: "DELIVERED",
      },
    });

    if (deliveredOrderCount < 1) {
      const msg = "COD available on orders after your first delivered order";
      return {
        eligible: false,
        reason: msg,
        message: msg,
      };
    }
  }

  return {
    eligible: true,
  };
}
