import { z } from "zod";

/**
 * Money conversion helper: converts rupee amount to paise integer.
 * Throws on NaN, non-finite or invalid input.
 */
export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === "string" ? parseFloat(rupees.trim()) : rupees;
  if (typeof num !== "number" || isNaN(num) || !isFinite(num)) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  return Math.round(num * 100);
}

/**
 * Converts paise integer to rupee number.
 */
export function paiseToRupees(paise: number): number {
  if (typeof paise !== "number" || isNaN(paise) || !isFinite(paise)) {
    throw new Error(`Invalid paise amount: ${paise}`);
  }
  return paise / 100;
}

/**
 * Normalizes input coming from admin forms where money is entered in Rupees.
 * Converts rupee fields to paise integers at the action boundary.
 */
export function normalizeOfferFormInput(raw: unknown): Record<string, unknown> | unknown {
  if (!raw || typeof raw !== "object") return raw;

  const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  // 1. Min cart paise
  if ("minCartRupees" in copy && copy.minCartRupees !== undefined && copy.minCartRupees !== null && copy.minCartRupees !== "") {
    copy.minCartPaise = rupeesToPaise(copy.minCartRupees as number | string);
    delete copy.minCartRupees;
  } else if ("minCartPaise" in copy && typeof copy.minCartPaise === "string") {
    copy.minCartPaise = parseInt(copy.minCartPaise, 10);
  }

  // 2. Config conversion depending on kind
  if (copy.config && typeof copy.config === "object") {
    const cfg: Record<string, unknown> = { ...(copy.config as Record<string, unknown>) };

    if (copy.kind === "FLAT_OFF") {
      if ("amountRupees" in cfg && cfg.amountRupees !== undefined && cfg.amountRupees !== null && cfg.amountRupees !== "") {
        cfg.amountPaise = rupeesToPaise(cfg.amountRupees as number | string);
        delete cfg.amountRupees;
      }
    } else if (copy.kind === "COMBO_ANY") {
      if ("fixedPriceRupees" in cfg && cfg.fixedPriceRupees !== undefined && cfg.fixedPriceRupees !== null && cfg.fixedPriceRupees !== "") {
        cfg.fixedPricePaise = rupeesToPaise(cfg.fixedPriceRupees as number | string);
        delete cfg.fixedPriceRupees;
      }
    } else if (copy.kind === "COMBO_SLOTS") {
      if ("fixedPriceRupees" in cfg && cfg.fixedPriceRupees !== undefined && cfg.fixedPriceRupees !== null && cfg.fixedPriceRupees !== "") {
        cfg.fixedPricePaise = rupeesToPaise(cfg.fixedPriceRupees as number | string);
        delete cfg.fixedPriceRupees;
      }
    } else if (copy.kind === "TIER" && Array.isArray(cfg.tiers)) {
      cfg.tiers = cfg.tiers.map((t: Record<string, unknown>) => {
        const tCopy = { ...t };
        if (tCopy.type === "FLAT_PER_UNIT" && "valueRupees" in tCopy && tCopy.valueRupees !== undefined && tCopy.valueRupees !== null && tCopy.valueRupees !== "") {
          tCopy.value = rupeesToPaise(tCopy.valueRupees as number | string);
          delete tCopy.valueRupees;
        }
        return tCopy;
      });
    }

    copy.config = cfg;
  }

  return copy;
}

// ── Offer Config Schemas ──

export const percentOffConfigSchema = z.object({
  percent: z.number().int("Percent must be an integer").min(1, "Percent must be at least 1").max(100, "Percent cannot exceed 100"),
});

export const flatOffConfigSchema = z.object({
  amountPaise: z.number().int("Amount must be an integer in paise").positive("Amount must be greater than 0"),
});

export const tierItemSchema = z.object({
  minQty: z.number().int("Min quantity must be an integer").min(2, "Min quantity must be at least 2"),
  type: z.enum(["PERCENT", "FLAT_PER_UNIT"]),
  value: z.number().int("Value must be an integer").positive("Value must be greater than 0"),
});

export const tierConfigSchema = z.object({
  tiers: z
    .array(tierItemSchema)
    .min(1, "At least one tier is required")
    .max(6, "At most 6 tiers allowed"),
}).superRefine((data, ctx) => {
  for (let i = 0; i < data.tiers.length; i++) {
    const tier = data.tiers[i];
    if (tier.type === "PERCENT" && tier.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PERCENT tier value cannot exceed 100",
        path: ["tiers", i, "value"],
      });
    }
    if (i > 0) {
      const prev = data.tiers[i - 1];
      if (tier.minQty <= prev.minQty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Tier minQty must be strictly ascending",
          path: ["tiers", i, "minQty"],
        });
      }
    }
  }
});

export const comboAnyConfigSchema = z.object({
  quantity: z.number().int("Quantity must be an integer").min(2, "Quantity must be at least 2"),
  fixedPricePaise: z.number().int("Fixed price must be in paise").positive("Fixed price must be greater than 0"),
  repeatable: z.boolean().default(true),
});

export const comboSlotSchema = z.object({
  label: z.string().trim().min(1, "Slot label is required"),
  quantity: z.number().int("Slot quantity must be an integer").min(1, "Slot quantity must be at least 1"),
  selector: z.object({
    type: z.enum(["category", "product", "collection"]),
    id: z.string().trim().min(1, "Selector id is required"),
  }),
});

export const comboSlotsConfigSchema = z.object({
  slots: z.array(comboSlotSchema).min(2, "At least 2 slots are required for a combo"),
  fixedPricePaise: z.number().int("Fixed price must be in paise").positive("Fixed price must be greater than 0"),
  repeatable: z.boolean().default(true),
});

export const giftConfigSchema = z.object({
  buyQty: z.number().int("Buy quantity must be an integer").min(0, "Buy quantity cannot be negative"),
  giftQty: z.number().int("Gift quantity must be an integer").min(1, "Gift quantity must be at least 1"),
  gift: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("VARIANT"),
      variantId: z.string().trim().min(1, "Variant ID is required"),
    }),
    z.object({
      type: z.literal("TEXT"),
      text: z.string().trim().min(1, "Gift description is required").max(200, "Gift text cannot exceed 200 characters"),
    }),
  ]),
});

// Discriminated union for all configs
export const offerConfigUnionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERCENT_OFF"), config: percentOffConfigSchema }),
  z.object({ kind: z.literal("FLAT_OFF"), config: flatOffConfigSchema }),
  z.object({ kind: z.literal("TIER"), config: tierConfigSchema }),
  z.object({ kind: z.literal("COMBO_ANY"), config: comboAnyConfigSchema }),
  z.object({ kind: z.literal("COMBO_SLOTS"), config: comboSlotsConfigSchema }),
  z.object({ kind: z.literal("GIFT"), config: giftConfigSchema }),
]);

export const offerTargetInputSchema = z.object({
  type: z.enum(["category", "product", "collection"]),
  id: z.string().trim().min(1, "Target ID is required"),
});

export const offerKindEnum = z.enum([
  "PERCENT_OFF",
  "FLAT_OFF",
  "TIER",
  "COMBO_ANY",
  "COMBO_SLOTS",
  "GIFT",
]);

export const offerAudienceEnum = z.enum(["ALL", "FIRST_ORDER", "BIRTHDAY"]);

export const couponCodeRegex = /^[A-Z0-9_-]{3,32}$/;

// ── Offer Input Schema ──

export const rawOfferInputSchema = z.object({
  name: z.string().trim().min(1, "Offer name is required").max(100, "Name is too long"),
  kind: offerKindEnum,
  code: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? val.toUpperCase() : null)),
  active: z.boolean().default(false),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  minCartPaise: z.number().int().min(0, "minCartPaise must be non-negative").default(0),
  maxUsesTotal: z.number().int().positive("maxUsesTotal must be positive").optional().nullable(),
  maxUsesPerCustomer: z.number().int().positive("maxUsesPerCustomer must be positive").optional().nullable(),
  priority: z.number().int().default(100),
  audience: offerAudienceEnum.default("ALL"),
  config: z.any(),
  targets: z
    .array(offerTargetInputSchema)
    .max(50, "At most 50 targets allowed")
    .default([])
    .transform((targets) => {
      // Deduplicate targets by type:id
      const seen = new Set<string>();
      return targets.filter((t) => {
        const key = `${t.type}:${t.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
});

export const offerInputSchema = rawOfferInputSchema.superRefine((data, ctx) => {
  // 1. Code regex check if code provided
  if (data.code !== null && data.code !== undefined) {
    if (!couponCodeRegex.test(data.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Coupon code must be 3-32 characters: uppercase letters, numbers, dashes, or underscores",
        path: ["code"],
      });
    }
  }

  // 2. Schedule: endsAt > startsAt
  if (data.startsAt && data.endsAt) {
    if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after start date",
        path: ["endsAt"],
      });
    }
  }

  // 3. Config validation per kind
  let configParsed: { success: boolean; error?: z.ZodError } = { success: false };
  switch (data.kind) {
    case "PERCENT_OFF":
      configParsed = percentOffConfigSchema.safeParse(data.config);
      break;
    case "FLAT_OFF":
      configParsed = flatOffConfigSchema.safeParse(data.config);
      break;
    case "TIER":
      configParsed = tierConfigSchema.safeParse(data.config);
      break;
    case "COMBO_ANY":
      configParsed = comboAnyConfigSchema.safeParse(data.config);
      break;
    case "COMBO_SLOTS":
      configParsed = comboSlotsConfigSchema.safeParse(data.config);
      break;
    case "GIFT":
      configParsed = giftConfigSchema.safeParse(data.config);
      break;
  }

  if (!configParsed.success && configParsed.error) {
    for (const issue of configParsed.error.issues) {
      ctx.addIssue({
        ...issue,
        path: ["config", ...issue.path],
      });
    }
  }

  // 4. Cross-field rules:
  // COMBO_SLOTS must have no offer-level targets
  if (data.kind === "COMBO_SLOTS" && data.targets.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "COMBO_SLOTS must not have offer-level targets (targets are defined per slot)",
      path: ["targets"],
    });
  }

  // COMBO_ANY must have at least one target (a group) or explicitly none = whole cart.
  // Both targets.length >= 1 or targets.length === 0 are structurally allowed.
});

// ── Types ──

export type OfferKind = z.infer<typeof offerKindEnum>;
export type OfferAudience = z.infer<typeof offerAudienceEnum>;
export type PercentOffConfig = z.infer<typeof percentOffConfigSchema>;
export type FlatOffConfig = z.infer<typeof flatOffConfigSchema>;
export type TierItem = z.infer<typeof tierItemSchema>;
export type TierConfig = z.infer<typeof tierConfigSchema>;
export type ComboAnyConfig = z.infer<typeof comboAnyConfigSchema>;
export type ComboSlot = z.infer<typeof comboSlotSchema>;
export type ComboSlotsConfig = z.infer<typeof comboSlotsConfigSchema>;
export type GiftConfig = z.infer<typeof giftConfigSchema>;
export type OfferTargetInput = z.infer<typeof offerTargetInputSchema>;
export type OfferInput = z.infer<typeof offerInputSchema>;

// ── Describe Offer Helper ──

export interface DescribeOfferInput {
  kind: string;
  config: Record<string, unknown> | null | undefined;
  minCartPaise?: number | null;
  code?: string | null;
}

export function describeOffer(offer: DescribeOfferInput): string {
  const cfg = (offer.config || {}) as Record<string, unknown>;
  let baseDesc = "";

  switch (offer.kind) {
    case "PERCENT_OFF":
      baseDesc = `${Number(cfg.percent) || 0}% off`;
      break;
    case "FLAT_OFF":
      baseDesc = `₹${((Number(cfg.amountPaise) || 0) / 100).toFixed(0)} off`;
      break;
    case "TIER": {
      const tiers = Array.isArray(cfg.tiers) ? (cfg.tiers as TierItem[]) : [];
      const tierDesc = tiers
        .map((t) => `${t.minQty}+ (${t.type === "PERCENT" ? `${t.value}%` : `₹${(t.value / 100).toFixed(0)}/ea`})`)
        .join(", ");
      baseDesc = `Tiered: Buy ${tierDesc}`;
      break;
    }
    case "COMBO_ANY":
      baseDesc = `Any ${Number(cfg.quantity) || 2} for ₹${((Number(cfg.fixedPricePaise) || 0) / 100).toFixed(0)}`;
      break;
    case "COMBO_SLOTS": {
      const slots = Array.isArray(cfg.slots) ? (cfg.slots as ComboSlot[]) : [];
      const slotDesc = slots.map((s) => `${s.quantity}x ${s.label}`).join(" + ");
      baseDesc = `Bundle: ${slotDesc} for ₹${((Number(cfg.fixedPricePaise) || 0) / 100).toFixed(0)}`;
      break;
    }
    case "GIFT": {
      const gift = cfg.gift as { type?: string; text?: string; variantId?: string } | undefined;
      const giftDesc = gift?.type === "VARIANT" ? "gift item" : `"${gift?.text || "gift"}"`;
      const buyQty = Number(cfg.buyQty) || 0;
      const giftQty = Number(cfg.giftQty) || 1;
      baseDesc = buyQty > 0
        ? `Buy ${buyQty}, get ${giftQty} free ${giftDesc}`
        : `Free ${giftDesc} with order`;
      break;
    }
    default:
      baseDesc = offer.kind;
  }

  if (offer.minCartPaise && offer.minCartPaise > 0) {
    baseDesc += ` (min cart ₹${(offer.minCartPaise / 100).toFixed(0)})`;
  }

  return baseDesc;
}
