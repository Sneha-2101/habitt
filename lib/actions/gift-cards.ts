"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/guards";
import { writeAudit } from "@/lib/audit";
import { limit, peekLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";
import { creditWalletLot, lockUserWallet } from "@/lib/wallet/service";
import {
  generateGiftCardCode,
  getCodeLast4,
  hashCode,
  normalizeCode,
} from "@/lib/gift-cards/code";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const GENERIC_REDEEM_ERROR = "This code isn't valid or can't be used.";

function safeRevalidate(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Safe outside Next.js request context
  }
}

async function resolveClientIp(): Promise<string> {
  try {
    const h = await headers();
    return getClientIp(h);
  } catch {
    return "unknown";
  }
}

/**
 * Converts a YYYY-MM-DD string (or Date) to the end of that IST calendar day
 * (23:59:59.999 IST) expressed as a UTC Date.
 */
function parseEndOfDayIst(input: string | Date): Date {
  if (typeof input === "string") {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      const probe = new Date(Date.UTC(year, month, day));
      if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month ||
        probe.getUTCDate() !== day
      ) {
        throw new Error("Invalid redeem-by date.");
      }
      const istEndUtcMs = Date.UTC(year, month, day, 23, 59, 59, 999);
      return new Date(istEndUtcMs - IST_OFFSET_MS);
    }
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("Invalid redeem-by date.");
    }
    input = parsed;
  }

  if (Number.isNaN(input.getTime())) {
    throw new Error("Invalid redeem-by date.");
  }
  const ist = new Date(input.getTime() + IST_OFFSET_MS);
  const istEndUtcMs = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
    23,
    59,
    59,
    999
  );
  return new Date(istEndUtcMs - IST_OFFSET_MS);
}

const issueGiftCardsSchema = z.object({
  amountRupees: z
    .number()
    .int("Amount must be in whole rupees.")
    .min(1, "Amount must be at least ₹1."),
  redeemBy: z.union([z.string().min(1, "Redeem-by date is required."), z.date()]),
  quantity: z
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be between 1 and 20.")
    .max(20, "Quantity must be between 1 and 20."),
  note: z
    .string()
    .nullish()
    .transform((v) => (v?.trim() ? v.trim() : null))
    .refine((v) => v === null || v.length <= 200, {
      message: "Note must be 200 characters or fewer.",
    }),
});

export interface IssueGiftCardsInput {
  amountRupees: number;
  redeemBy: string | Date;
  quantity: number;
  note?: string | null;
}

export interface IssuedGiftCardResult {
  id: string;
  code: string;
  last4: string;
  amountPaise: number;
  redeemBy: Date;
  note: string | null;
}

export async function issueGiftCardsAction(
  rawInput: IssueGiftCardsInput
): Promise<{ cards: IssuedGiftCardResult[] }> {
  const owner = await requireRole("OWNER");
  const parsed = issueGiftCardsSchema.parse(rawInput);

  const amountPaise = parsed.amountRupees * 100;
  const settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: { maxAdminAdjustPaise: true },
  });
  const maxPaise = settings?.maxAdminAdjustPaise ?? 500000;
  if (amountPaise > maxPaise) {
    throw new Error(
      `Amount exceeds the maximum allowed limit of ₹${Math.floor(maxPaise / 100)}.`
    );
  }

  const now = new Date();
  const redeemByUtc = parseEndOfDayIst(parsed.redeemBy);
  if (redeemByUtc.getTime() <= now.getTime()) {
    throw new Error("Redeem-by date must be in the future.");
  }

  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const maxIstEndUtcMs = Date.UTC(
    istNow.getUTCFullYear() + 3,
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
    23,
    59,
    59,
    999
  );
  const maxRedeemByUtc = new Date(maxIstEndUtcMs - IST_OFFSET_MS);
  if (redeemByUtc.getTime() > maxRedeemByUtc.getTime()) {
    throw new Error("Redeem-by date cannot be more than 3 years ahead.");
  }

  const createdCards: IssuedGiftCardResult[] = [];

  for (let i = 0; i < parsed.quantity; i += 1) {
    let created: { id: string; last4: string; amountPaise: number; redeemBy: Date; note: string | null } | null = null;
    let plaintextCode = "";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateGiftCardCode();
      const normalized = normalizeCode(candidate);
      if (!normalized) {
        throw new Error("Failed to generate valid gift card code.");
      }
      const codeHash = hashCode(normalized);
      const last4 = getCodeLast4(normalized);

      try {
        created = await prisma.$transaction(async (tx) => {
          const card = await tx.giftCard.create({
            data: {
              codeHash,
              last4,
              amountPaise,
              status: "ISSUED",
              redeemBy: redeemByUtc,
              note: parsed.note,
              createdById: owner.id,
            },
            select: {
              id: true,
              last4: true,
              amountPaise: true,
              redeemBy: true,
              note: true,
            },
          });

          await writeAudit(
            {
              actorId: owner.id,
              action: "gift_card.issue",
              entity: "GiftCard",
              entityId: card.id,
              meta: {
                id: card.id,
                last4: card.last4,
                amountPaise: card.amountPaise,
              },
            },
            tx
          );

          return card;
        });
        plaintextCode = candidate;
        break;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      throw new Error("Failed to issue gift card after collision retries.");
    }

    createdCards.push({
      id: created.id,
      code: plaintextCode,
      last4: created.last4,
      amountPaise: created.amountPaise,
      redeemBy: created.redeemBy,
      note: created.note,
    });
  }

  safeRevalidate("/admin/gift-cards");
  return { cards: createdCards };
}

export async function voidGiftCardAction(id: string): Promise<{ success: true }> {
  const owner = await requireRole("OWNER");
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.giftCard.updateMany({
      where: { id, status: "ISSUED" },
      data: {
        status: "VOID",
        voidedById: owner.id,
        voidedAt: now,
      },
    });

    if (updated.count === 0) {
      throw new Error("Only issued gift cards can be voided.");
    }

    const card = await tx.giftCard.findUnique({
      where: { id },
      select: { id: true, last4: true, amountPaise: true },
    });

    if (card) {
      await writeAudit(
        {
          actorId: owner.id,
          action: "gift_card.void",
          entity: "GiftCard",
          entityId: card.id,
          meta: {
            id: card.id,
            last4: card.last4,
            amountPaise: card.amountPaise,
          },
        },
        tx
      );
    }
  });

  safeRevalidate("/admin/gift-cards");
  return { success: true };
}

export type GiftCardDisplayState = "ISSUED" | "REDEEMED" | "VOID" | "EXPIRED";

export interface GiftCardListItem {
  id: string;
  last4: string;
  amountPaise: number;
  state: GiftCardDisplayState;
  redeemBy: Date;
  note: string | null;
  createdAt: Date;
  redeemedAt: Date | null;
  voidedAt: Date | null;
}

export async function listGiftCards(): Promise<{
  cards: GiftCardListItem[];
  outstandingLiabilityPaise: number;
}> {
  await requireRole("OWNER");
  const now = new Date();

  const [rows, liabilityAgg] = await Promise.all([
    prisma.giftCard.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        last4: true,
        amountPaise: true,
        status: true,
        redeemBy: true,
        note: true,
        createdAt: true,
        redeemedAt: true,
        voidedAt: true,
      },
    }),
    prisma.giftCard.aggregate({
      where: {
        status: "ISSUED",
        redeemBy: { gt: now },
      },
      _sum: { amountPaise: true },
    }),
  ]);

  const cards: GiftCardListItem[] = rows.map((row) => {
    let state: GiftCardDisplayState = row.status;
    if (row.status === "ISSUED" && row.redeemBy.getTime() <= now.getTime()) {
      state = "EXPIRED";
    }
    return {
      id: row.id,
      last4: row.last4,
      amountPaise: row.amountPaise,
      state,
      redeemBy: row.redeemBy,
      note: row.note,
      createdAt: row.createdAt,
      redeemedAt: row.redeemedAt,
      voidedAt: row.voidedAt,
    };
  });

  return {
    cards,
    outstandingLiabilityPaise: liabilityAgg._sum.amountPaise ?? 0,
  };
}

export type RedeemGiftCardResult =
  | { ok: true; amountPaise: number; balancePaise: number }
  | { ok: false; error: string };

export async function redeemGiftCardAction(
  rawCode: string
): Promise<RedeemGiftCardResult> {
  const user = await requireUser();
  const ip = await resolveClientIp();

  const [userPeek, ipPeek] = await Promise.all([
    peekLimit("giftCardRedeemUser", user.id),
    peekLimit("giftCardRedeemIp", ip),
  ]);
  if (userPeek.blocked || ipPeek.blocked) {
    return {
      ok: false,
      error: "Too many failed attempts. Please try again later.",
    };
  }

  const normalized = normalizeCode(rawCode);
  if (!normalized) {
    const [userRl, ipRl] = await Promise.all([
      limit("giftCardRedeemUser", user.id),
      limit("giftCardRedeemIp", ip),
    ]);
    if (!userRl.ok || !ipRl.ok) {
      return {
        ok: false,
        error: "Too many failed attempts. Please try again later.",
      };
    }
    return { ok: false, error: GENERIC_REDEEM_ERROR };
  }

  const codeHash = hashCode(normalized);
  const now = new Date();

  const txResult = await prisma.$transaction(async (tx) => {
    await lockUserWallet(tx, user.id);

    const claim = await tx.giftCard.updateMany({
      where: {
        codeHash,
        status: "ISSUED",
        redeemBy: { gt: now },
      },
      data: {
        status: "REDEEMED",
        redeemedById: user.id,
        redeemedAt: now,
      },
    });

    if (claim.count === 0) {
      return { claimed: false as const };
    }

    const card = await tx.giftCard.findUniqueOrThrow({
      where: { codeHash },
      select: { id: true, last4: true, amountPaise: true },
    });

    const credit = await creditWalletLot(
      {
        userId: user.id,
        kind: "ADJUST",
        amountPaise: card.amountPaise,
        expiresAt: null,
        sourceType: "GIFT_CARD",
        sourceId: card.id,
        note: `Gift card ****${card.last4}`,
        reason: `Gift card redeemed (****${card.last4})`,
        actorId: user.id,
        idempotencyKey: `gift-card-redeem:${card.id}`,
        now,
      },
      tx
    );

    if (credit.lot) {
      await tx.giftCard.update({
        where: { id: card.id },
        data: { walletLotId: credit.lot.id },
      });
    }

    await writeAudit(
      {
        actorId: user.id,
        action: "gift_card.redeem",
        entity: "GiftCard",
        entityId: card.id,
        meta: {
          id: card.id,
          last4: card.last4,
          amountPaise: card.amountPaise,
        },
      },
      tx
    );

    return {
      claimed: true as const,
      card,
      balancePaise: credit.balancePaise,
    };
  });

  if (!txResult.claimed) {
    const [userRl, ipRl] = await Promise.all([
      limit("giftCardRedeemUser", user.id),
      limit("giftCardRedeemIp", ip),
    ]);
    if (!userRl.ok || !ipRl.ok) {
      return {
        ok: false,
        error: "Too many failed attempts. Please try again later.",
      };
    }
    return { ok: false, error: GENERIC_REDEEM_ERROR };
  }

  safeRevalidate("/account/wallet");
  safeRevalidate("/admin/gift-cards");

  return {
    ok: true,
    amountPaise: txResult.card.amountPaise,
    balancePaise: txResult.balancePaise,
  };
}
