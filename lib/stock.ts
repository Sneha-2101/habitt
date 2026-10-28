import { Prisma, StockReason } from "@prisma/client";

export class InsufficientStockError extends Error {
  variantId: string;
  constructor(variantId: string, message?: string) {
    super(message || `Insufficient stock for product variant ${variantId}`);
    this.name = "InsufficientStockError";
    this.variantId = variantId;
  }
}

export interface StockItem {
  variantId: string;
  qty: number;
}

export interface StockRef {
  refType?: string;
  refId?: string;
  actorId?: string;
}

export async function reserveStock(
  tx: Prisma.TransactionClient,
  items: StockItem[],
  reason: StockReason,
  ref?: StockRef,
  opts?: { clampOnShortage?: boolean }
) {
  for (const item of items) {
    if (!item.variantId || item.qty <= 0) continue;

    const count = await tx.$executeRaw`
      UPDATE "ProductVariant"
      SET stock = stock - ${item.qty}
      WHERE id = ${item.variantId} AND stock >= ${item.qty}
    `;

    if (count === 0) {
      if (opts?.clampOnShortage) {
        const currentVariant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stock: true },
        });
        const currentStock = currentVariant?.stock ?? 0;

        await tx.$executeRaw`
          UPDATE "ProductVariant"
          SET stock = 0
          WHERE id = ${item.variantId}
        `;

        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            delta: -item.qty,
            reason: "OVERSOLD",
            refType: ref?.refType,
            refId: ref?.refId,
            actorId: ref?.actorId,
          },
        });

        console.error("OVERSOLD", {
          variantId: item.variantId,
          requestedQty: item.qty,
          previousStock: currentStock,
          ref,
        });
      } else {
        throw new InsufficientStockError(item.variantId);
      }
    } else {
      await tx.stockMovement.create({
        data: {
          variantId: item.variantId,
          delta: -item.qty,
          reason,
          refType: ref?.refType,
          refId: ref?.refId,
          actorId: ref?.actorId,
        },
      });
    }
  }
}

export async function releaseStock(
  tx: Prisma.TransactionClient,
  items: StockItem[],
  reason: StockReason,
  ref?: StockRef
) {
  for (const item of items) {
    if (!item.variantId || item.qty <= 0) continue;

    await tx.$executeRaw`
      UPDATE "ProductVariant"
      SET stock = stock + ${item.qty}
      WHERE id = ${item.variantId}
    `;

    await tx.stockMovement.create({
      data: {
        variantId: item.variantId,
        delta: item.qty,
        reason,
        refType: ref?.refType,
        refId: ref?.refId,
        actorId: ref?.actorId,
      },
    });
  }
}
