"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { normalizeInfluencerCode } from "@/lib/influencers/code";
import { upsertInfluencerOfferInTx } from "@/lib/actions/offers";

function safeRevalidateInfluencers() {
  try {
    revalidatePath("/admin/influencers");
  } catch {
    // Safe outside Next.js request context
  }
}

const influencerInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name must be 80 characters or fewer"),
  code: z.string().trim().min(1, "Code is required"),
  email: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? v.trim().toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "Invalid email address",
    }),
  notes: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? v.trim() : null))
    .refine((v) => v === null || v.length <= 500, {
      message: "Notes must be 500 characters or fewer",
    }),
  discountPercent: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return 0;
      const n = typeof v === "string" ? Number(v.trim()) : v;
      return n;
    })
    .refine((n) => Number.isInteger(n) && n >= 0 && n <= 100, {
      message: "Discount percent must be an integer between 0 and 100",
    }),
});

export interface CreateOrUpdateInfluencerInput {
  name: string;
  code: string;
  email?: string | null;
  notes?: string | null;
  discountPercent?: number | string | null;
}

export async function createInfluencerAction(rawInput: CreateOrUpdateInfluencerInput) {
  const owner = await requireRole("OWNER");
  const parsed = influencerInputSchema.parse(rawInput);

  const normalizedCode = normalizeInfluencerCode(parsed.code);
  if (!normalizedCode) {
    throw new Error(
      "Code must be 3 to 32 characters (letters, numbers, - or _), starting with a letter or number."
    );
  }

  const settings = await getSettings();
  const rawCap =
    "discountCapPercent" in settings
      ? (settings as Record<string, unknown>).discountCapPercent
      : null;
  const cap = typeof rawCap === "number" && rawCap > 0 ? rawCap : 100;
  if (parsed.discountPercent > cap) {
    throw new Error(`Discount percent cannot exceed the global discount cap (${cap}%).`);
  }

  const created = await prisma.$transaction(async (tx) => {
    const existingInf = await tx.influencer.findFirst({
      where: { code: { equals: normalizedCode, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingInf) {
      throw new Error(`Influencer code "${normalizedCode}" is assigned to another influencer.`);
    }

    const existingOffer = await tx.offer.findFirst({
      where: { code: { equals: normalizedCode, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingOffer) {
      throw new Error(`Code "${normalizedCode}" conflicts with an existing offer code.`);
    }

    let offerId: string | null = null;
    if (parsed.discountPercent > 0) {
      const offer = await upsertInfluencerOfferInTx(tx, {
        name: `Influencer ${parsed.name}`,
        code: normalizedCode,
        active: true,
        percent: parsed.discountPercent,
      });
      offerId = offer.id;
    }

    return tx.influencer.create({
      data: {
        name: parsed.name,
        code: normalizedCode,
        email: parsed.email,
        notes: parsed.notes,
        active: true,
        offerId,
      },
    });
  });

  await writeAudit({
    actorId: owner.id,
    action: "influencer.create",
    entity: "Influencer",
    entityId: created.id,
    meta: {
      changedFields: ["name", "code", ...(created.email ? ["email"] : []), ...(created.notes ? ["notes"] : []), ...(created.offerId ? ["offerId"] : [])],
    },
  });

  safeRevalidateInfluencers();
  return { success: true, influencerId: created.id };
}

export async function updateInfluencerAction(
  id: string,
  rawInput: CreateOrUpdateInfluencerInput
) {
  const owner = await requireRole("OWNER");
  const parsed = influencerInputSchema.parse(rawInput);

  const normalizedCode = normalizeInfluencerCode(parsed.code);
  if (!normalizedCode) {
    throw new Error(
      "Code must be 3 to 32 characters (letters, numbers, - or _), starting with a letter or number."
    );
  }

  const settings = await getSettings();
  const rawCap =
    "discountCapPercent" in settings
      ? (settings as Record<string, unknown>).discountCapPercent
      : null;
  const cap = typeof rawCap === "number" && rawCap > 0 ? rawCap : 100;
  if (parsed.discountPercent > cap) {
    throw new Error(`Discount percent cannot exceed the global discount cap (${cap}%).`);
  }

  const { updated, changedFields } = await prisma.$transaction(async (tx) => {
    const current = await tx.influencer.findUnique({
      where: { id },
      include: {
        offer: {
          select: { active: true, endsAt: true, config: true },
        },
      },
    });
    if (!current) {
      throw new Error("Influencer not found.");
    }

    const now = new Date();
    const prevCfg = current.offer?.config as { percent?: unknown } | null | undefined;
    const prevActivePercent =
      current.offer &&
      current.offer.active &&
      (!current.offer.endsAt || current.offer.endsAt > now) &&
      typeof prevCfg?.percent === "number"
        ? prevCfg.percent
        : 0;

    const existingInf = await tx.influencer.findFirst({
      where: {
        code: { equals: normalizedCode, mode: "insensitive" },
        id: { not: id },
      },
      select: { id: true },
    });
    if (existingInf) {
      throw new Error(`Influencer code "${normalizedCode}" is assigned to another influencer.`);
    }

    const existingOffer = await tx.offer.findFirst({
      where: {
        code: { equals: normalizedCode, mode: "insensitive" },
        ...(current.offerId ? { id: { not: current.offerId } } : {}),
      },
      select: { id: true },
    });
    if (existingOffer) {
      throw new Error(`Code "${normalizedCode}" conflicts with an existing offer code.`);
    }

    let nextOfferId = current.offerId;
    if (parsed.discountPercent > 0) {
      const offer = await upsertInfluencerOfferInTx(tx, {
        offerId: current.offerId,
        name: `Influencer ${parsed.name}`,
        code: normalizedCode,
        active: current.active,
        percent: parsed.discountPercent,
      });
      nextOfferId = offer.id;
    } else if (current.offerId) {
      await tx.offer.update({
        where: { id: current.offerId },
        data: { active: false, endsAt: now },
      });
    }

    const row = await tx.influencer.update({
      where: { id },
      data: {
        name: parsed.name,
        code: normalizedCode,
        email: parsed.email,
        notes: parsed.notes,
        offerId: nextOfferId,
      },
    });

    const fields: string[] = [];
    if (current.name !== row.name) fields.push("name");
    if (current.code !== row.code) fields.push("code");
    if (current.email !== row.email) fields.push("email");
    if (current.notes !== row.notes) fields.push("notes");
    if (prevActivePercent !== parsed.discountPercent) {
      fields.push("discountPercent");
    }

    return { updated: row, changedFields: fields };
  });

  await writeAudit({
    actorId: owner.id,
    action: "influencer.update",
    entity: "Influencer",
    entityId: updated.id,
    meta: { changedFields },
  });

  safeRevalidateInfluencers();
  return { success: true, influencerId: updated.id };
}

export async function setInfluencerActiveAction(id: string, active: boolean) {
  const owner = await requireRole("OWNER");

  await prisma.$transaction(async (tx) => {
    const current = await tx.influencer.findUnique({ where: { id } });
    if (!current) {
      throw new Error("Influencer not found.");
    }

    await tx.influencer.update({
      where: { id },
      data: { active },
    });

    if (current.offerId) {
      await tx.offer.update({
        where: { id: current.offerId },
        data: { active },
      });
    }
  });

  await writeAudit({
    actorId: owner.id,
    action: active ? "influencer.activate" : "influencer.deactivate",
    entity: "Influencer",
    entityId: id,
    meta: { changedFields: ["active"] },
  });

  safeRevalidateInfluencers();
  return { success: true };
}

const cookieDaysSchema = z.object({
  influencerCookieDays: z
    .number()
    .int("Cookie days must be an integer")
    .min(1, "Cookie days must be at least 1")
    .max(90, "Cookie days cannot exceed 90"),
});

export async function updateInfluencerSettingsAction(input: {
  influencerCookieDays: number;
}) {
  const owner = await requireRole("OWNER");
  const parsed = cookieDaysSchema.parse(input);
  const current = await getSettings();

  await prisma.siteSettings.update({
    where: { id: "default" },
    data: { influencerCookieDays: parsed.influencerCookieDays },
  });

  await writeAudit({
    actorId: owner.id,
    action: "SETTINGS_UPDATED",
    entity: "SiteSettings",
    entityId: "default",
    meta: {
      changes: {
        influencerCookieDays: {
          before: current.influencerCookieDays,
          after: parsed.influencerCookieDays,
        },
      },
      changedKeys: ["influencerCookieDays"],
    },
  });

  safeRevalidateInfluencers();
  return { success: true, influencerCookieDays: parsed.influencerCookieDays };
}
