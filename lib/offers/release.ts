import { Prisma } from "@prisma/client";

/**
 * Releases offer usage associated with an order.
 * Reads the order's OfferRedemption rows, decrements Offer.timesUsed for each
 * (only if timesUsed > 0, ensuring it never goes below 0), and deletes the redemption rows.
 * Idempotent: a subsequent call finds no redemption rows and performs no operations.
 */
export async function releaseOfferUsage(
  tx: Prisma.TransactionClient,
  orderId: string
): Promise<{ releasedCount: number }> {
  const redemptions = await tx.offerRedemption.findMany({
    where: { orderId },
  });

  if (redemptions.length === 0) {
    // Fallback for orders created directly without OfferRedemption rows (e.g. fixtures/legacy)
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { couponCode: true },
    });
    if (order?.couponCode) {
      await tx.offer.updateMany({
        where: { code: order.couponCode, timesUsed: { gt: 0 } },
        data: { timesUsed: { decrement: 1 } },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { couponCode: null },
      });
      return { releasedCount: 1 };
    }
    return { releasedCount: 0 };
  }

  for (const r of redemptions) {
    if (r.amountPaise > 0) {
      await tx.offer.updateMany({
        where: { id: r.offerId, timesUsed: { gt: 0 } },
        data: { timesUsed: { decrement: 1 } },
      });
    }
  }

  await tx.offerRedemption.deleteMany({
    where: { orderId },
  });

  return { releasedCount: redemptions.length };
}
