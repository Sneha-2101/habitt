"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import {
  offerInputSchema,
  normalizeOfferFormInput,
  type OfferInput,
} from "@/lib/offers/schema";

export async function upsertInfluencerOfferInTx(
  tx: Prisma.TransactionClient,
  input: {
    offerId?: string | null;
    name: string;
    code: string;
    active: boolean;
    percent: number;
  }
) {
  const parsed = offerInputSchema.parse({
    name: input.name,
    kind: "PERCENT_OFF",
    code: input.code,
    active: input.active,
    startsAt: null,
    endsAt: null,
    minCartPaise: 0,
    maxUsesTotal: null,
    maxUsesPerCustomer: null,
    priority: 100,
    audience: "ALL",
    config: { percent: input.percent },
    targets: [],
  });

  if (input.offerId) {
    return tx.offer.update({
      where: { id: input.offerId },
      data: {
        name: parsed.name,
        code: parsed.code,
        active: parsed.active,
        startsAt: null,
        endsAt: null,
        config: parsed.config,
      },
    });
  }

  return tx.offer.create({
    data: {
      name: parsed.name,
      kind: parsed.kind,
      code: parsed.code,
      active: parsed.active,
      startsAt: null,
      endsAt: null,
      minCartPaise: parsed.minCartPaise,
      maxUsesTotal: null,
      maxUsesPerCustomer: null,
      priority: parsed.priority,
      audience: parsed.audience,
      config: parsed.config,
    },
  });
}

export async function createOffer(rawInput: unknown) {
  const staff = await requireStaff();

  const normalized = normalizeOfferFormInput(rawInput);
  const parsed: OfferInput = offerInputSchema.parse(normalized);

  let warning: string | undefined;

  const offer = await prisma.$transaction(async (tx) => {
    // 1. Duplicate code check (case-insensitive via uppercase)
    if (parsed.code) {
      const existing = await tx.offer.findUnique({
        where: { code: parsed.code },
      });
      if (existing) {
        throw new Error(`Coupon code "${parsed.code}" is already in use.`);
      }
    }

    // 2. Validate offer-level targets exist
    for (const target of parsed.targets) {
      await verifyTargetExists(tx, target);
    }

    // 3. Validate COMBO_SLOTS selectors exist
    if (parsed.kind === "COMBO_SLOTS" && parsed.config.slots) {
      for (const slot of parsed.config.slots) {
        await verifyTargetExists(tx, slot.selector);
      }
    }

    // 4. Validate GIFT variant exists if VARIANT gift
    if (parsed.kind === "GIFT" && parsed.config.gift?.type === "VARIANT") {
      const variantId = parsed.config.gift.variantId;
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant) {
        throw new Error(`Gift variant with ID "${variantId}" does not exist.`);
      }
      if (variant.stock <= 0) {
        warning = `Gift variant "${variant.sku || variant.size}" currently has 0 stock.`;
      }
    }

    // 5. Create Offer row and targets
    const created = await tx.offer.create({
      data: {
        name: parsed.name,
        kind: parsed.kind,
        code: parsed.code || null,
        active: parsed.active,
        startsAt: parsed.startsAt ? new Date(parsed.startsAt) : null,
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        minCartPaise: parsed.minCartPaise,
        maxUsesTotal: parsed.maxUsesTotal || null,
        maxUsesPerCustomer: parsed.maxUsesPerCustomer || null,
        priority: parsed.priority,
        audience: parsed.audience,
        config: parsed.config,
        targets: {
          create: parsed.targets.map((t) => ({
            categoryId: t.type === "category" ? t.id : null,
            productId: t.type === "product" ? t.id : null,
            collectionId: t.type === "collection" ? t.id : null,
          })),
        },
      },
      include: {
        targets: true,
      },
    });

    return created;
  });

  await writeAudit({
    actorId: staff.id,
    action: "offer.create",
    entity: "Offer",
    entityId: offer.id,
    meta: { after: offer, warning },
  });

  revalidatePath("/admin/offers");

  return { success: true, offer, warning };
}

export async function updateOffer(id: string, rawInput: unknown) {
  const staff = await requireStaff();

  const normalized = normalizeOfferFormInput(rawInput);
  const parsed: OfferInput = offerInputSchema.parse(normalized);

  let warning: string | undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.offer.findUnique({
      where: { id },
      include: { targets: true },
    });
    if (!existing) {
      throw new Error(`Offer with ID "${id}" does not exist.`);
    }

    // 1. Duplicate code check
    if (parsed.code) {
      const codeConflict = await tx.offer.findFirst({
        where: {
          code: parsed.code,
          id: { not: id },
        },
      });
      if (codeConflict) {
        throw new Error(`Coupon code "${parsed.code}" is already in use.`);
      }
    }

    // 2. Validate offer-level targets exist
    for (const target of parsed.targets) {
      await verifyTargetExists(tx, target);
    }

    // 3. Validate COMBO_SLOTS selectors exist
    if (parsed.kind === "COMBO_SLOTS" && parsed.config.slots) {
      for (const slot of parsed.config.slots) {
        await verifyTargetExists(tx, slot.selector);
      }
    }

    // 4. Validate GIFT variant exists if VARIANT gift
    if (parsed.kind === "GIFT" && parsed.config.gift?.type === "VARIANT") {
      const variantId = parsed.config.gift.variantId;
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant) {
        throw new Error(`Gift variant with ID "${variantId}" does not exist.`);
      }
      if (variant.stock <= 0) {
        warning = `Gift variant "${variant.sku || variant.size}" currently has 0 stock.`;
      }
    }

    // 5. Atomically replace targets
    await tx.offerTarget.deleteMany({
      where: { offerId: id },
    });

    if (parsed.targets.length > 0) {
      await tx.offerTarget.createMany({
        data: parsed.targets.map((t) => ({
          offerId: id,
          categoryId: t.type === "category" ? t.id : null,
          productId: t.type === "product" ? t.id : null,
          collectionId: t.type === "collection" ? t.id : null,
        })),
      });
    }

    // 6. Update Offer row
    const result = await tx.offer.update({
      where: { id },
      data: {
        name: parsed.name,
        kind: parsed.kind,
        code: parsed.code || null,
        active: parsed.active,
        startsAt: parsed.startsAt ? new Date(parsed.startsAt) : null,
        endsAt: parsed.endsAt ? new Date(parsed.endsAt) : null,
        minCartPaise: parsed.minCartPaise,
        maxUsesTotal: parsed.maxUsesTotal || null,
        maxUsesPerCustomer: parsed.maxUsesPerCustomer || null,
        priority: parsed.priority,
        audience: parsed.audience,
        config: parsed.config,
      },
      include: {
        targets: true,
      },
    });

    return result;
  });

  await writeAudit({
    actorId: staff.id,
    action: "offer.update",
    entity: "Offer",
    entityId: id,
    meta: { after: updated, warning },
  });

  revalidatePath("/admin/offers");
  revalidatePath(`/admin/offers/${id}`);

  return { success: true, offer: updated, warning };
}

export async function setOfferActive(id: string, active: boolean) {
  const staff = await requireStaff();

  const existing = await prisma.offer.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new Error(`Offer with ID "${id}" does not exist.`);
  }

  const updated = await prisma.offer.update({
    where: { id },
    data: { active },
  });

  await writeAudit({
    actorId: staff.id,
    action: "offer.setActive",
    entity: "Offer",
    entityId: id,
    meta: { before: { active: existing.active }, after: { active: updated.active } },
  });

  revalidatePath("/admin/offers");
  revalidatePath(`/admin/offers/${id}`);

  return { success: true, offer: updated };
}

export async function deleteOffer(id: string) {
  const staff = await requireStaff();

  const existing = await prisma.offer.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new Error(`Offer with ID "${id}" does not exist.`);
  }

  // Refuse if it has OfferRedemption rows
  const redemptionsCount = await prisma.offerRedemption.count({
    where: { offerId: id },
  });
  if (redemptionsCount > 0) {
    throw new Error(
      "Cannot delete offer because it has customer redemptions recorded. Deactivate the offer instead."
    );
  }

  await prisma.offer.delete({
    where: { id },
  });

  await writeAudit({
    actorId: staff.id,
    action: "offer.delete",
    entity: "Offer",
    entityId: id,
    meta: { before: existing },
  });

  revalidatePath("/admin/offers");

  return { success: true };
}

async function verifyTargetExists(
  tx: Prisma.TransactionClient,
  target: { type: "category" | "product" | "collection"; id: string }
) {
  if (target.type === "category") {
    const cat = await tx.category.findUnique({ where: { id: target.id } });
    if (!cat) {
      throw new Error(`Target category with ID "${target.id}" does not exist.`);
    }
  } else if (target.type === "product") {
    const prod = await tx.product.findUnique({ where: { id: target.id } });
    if (!prod) {
      throw new Error(`Target product with ID "${target.id}" does not exist.`);
    }
  } else if (target.type === "collection") {
    const col = await tx.collection.findUnique({ where: { id: target.id } });
    if (!col) {
      throw new Error(`Target collection with ID "${target.id}" does not exist.`);
    }
  }
}
