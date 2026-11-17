"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/guards";
import { limit } from "@/lib/ratelimit";
import { mergeCarts } from "@/lib/cart/merge";
import { CartItem as ClientCartItem } from "@/lib/cart-store";

const incomingCartItemSchema = z
  .object({
    productId: z.string().min(1).optional(),
    variantId: z.string().min(1, "variantId is required"),
    qty: z.number().int("qty must be an integer").min(1).max(10),
  })
  .passthrough();

const incomingCartSchema = z.array(incomingCartItemSchema).max(50, "Cart cannot exceed 50 items");

export interface SyncCartResponseItem extends ClientCartItem {
  image?: string;
  slug?: string;
}

export interface SyncCartResult {
  items: SyncCartResponseItem[];
  dropped: number;
}

export async function loadCartAction(): Promise<SyncCartResult> {
  const user = await requireUser();
  const rl = await limit("cartSync", user.id);
  if (!rl.ok) throw new Error("Too many requests. Please try again shortly.");

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cart:' || ${user.id}))`;

    const cart = await tx.cart.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
      include: { items: true },
    });

    const variantIds = cart.items.map((i) => i.variantId);
    if (variantIds.length === 0) {
      return { items: [], dropped: 0 };
    }

    const activeVariants = await tx.productVariant.findMany({
      where: {
        id: { in: variantIds },
        product: { status: "ACTIVE" },
      },
      include: {
        product: {
          include: {
            images: { take: 1, orderBy: { position: "asc" } },
          },
        },
      },
    });

    const activeVariantMap = new Map(activeVariants.map((v) => [v.id, v]));
    let dropped = 0;
    const responseItems: SyncCartResponseItem[] = [];

    for (const item of cart.items) {
      const v = activeVariantMap.get(item.variantId);
      if (!v) {
        dropped++;
        continue;
      }
      responseItems.push({
        variantId: item.variantId,
        productId: v.productId,
        name: v.product.name,
        size: v.size,
        unitPrice: v.product.price,
        qty: item.qty,
        image: v.product.images?.[0]?.url || "",
        slug: v.product.slug,
      });
    }

    return {
      items: responseItems,
      dropped,
    };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function syncCartAction(localItems: unknown): Promise<SyncCartResult> {
  const user = await requireUser();
  const validated = incomingCartSchema.parse(localItems || []);

  const rl = await limit("cartSync", user.id);
  if (!rl.ok) throw new Error("Too many requests. Please try again shortly.");

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cart:' || ${user.id}))`;

    const cart = await tx.cart.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
      include: { items: true },
    });

    const candidateVariantIds = Array.from(
      new Set([...cart.items.map((i) => i.variantId), ...validated.map((i) => i.variantId)])
    );

    const activeVariants = await tx.productVariant.findMany({
      where: {
        id: { in: candidateVariantIds },
        product: { status: "ACTIVE" },
      },
      include: {
        product: {
          include: {
            images: { take: 1, orderBy: { position: "asc" } },
          },
        },
      },
    });

    const validVariantIds = new Set(activeVariants.map((v) => v.id));
    const variantMap = new Map(activeVariants.map((v) => [v.id, v]));

    const merged = mergeCarts(cart.items, validated, validVariantIds);

    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    if (merged.items.length > 0) {
      await tx.cartItem.createMany({
        data: merged.items.map((item) => {
          const v = variantMap.get(item.variantId);
          return {
            cartId: cart.id,
            productId: v ? v.productId : item.productId,
            variantId: item.variantId,
            qty: item.qty,
          };
        }),
      });
    }

    const responseItems: SyncCartResponseItem[] = merged.items.map((item) => {
      const v = variantMap.get(item.variantId)!;
      return {
        variantId: item.variantId,
        productId: v.productId,
        name: v.product.name,
        size: v.size,
        unitPrice: v.product.price,
        qty: item.qty,
        image: v.product.images?.[0]?.url || "",
        slug: v.product.slug,
      };
    });

    return {
      items: responseItems,
      dropped: merged.dropped,
    };
  }, { maxWait: 10000, timeout: 20000 });
}

export async function saveCartAction(items: unknown): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const validated = incomingCartSchema.parse(items || []);

  const rl = await limit("cartSync", user.id);
  if (!rl.ok) throw new Error("Too many requests. Please try again shortly.");

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cart:' || ${user.id}))`;

    const cart = await tx.cart.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });

    const candidateVariantIds = Array.from(new Set(validated.map((i) => i.variantId)));

    const activeVariants = await tx.productVariant.findMany({
      where: {
        id: { in: candidateVariantIds },
        product: {
          status: "ACTIVE",
        },
      },
    });

    const activeVariantMap = new Map(activeVariants.map((v) => [v.id, v]));
    const linesToSave: { cartId: string; productId: string; variantId: string; qty: number }[] = [];
    const seenVariantIds = new Set<string>();

    for (const item of validated) {
      const v = activeVariantMap.get(item.variantId);
      if (!v) continue; // ignore unknown or inactive variants
      if (seenVariantIds.has(item.variantId)) continue;
      seenVariantIds.add(item.variantId);

      linesToSave.push({
        cartId: cart.id,
        productId: v.productId,
        variantId: v.id,
        qty: Math.min(Math.max(1, item.qty), 10),
      });

      if (linesToSave.length >= 20) break;
    }

    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });
    if (linesToSave.length > 0) {
      await tx.cartItem.createMany({
        data: linesToSave,
      });
    }

    return { ok: true };
  }, { maxWait: 10000, timeout: 20000 });
}
