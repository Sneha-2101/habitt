import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import {
  allocateWalletDebit,
  computeActiveWalletBalance,
} from "@/lib/wallet/allocate";
import type { Prisma, WalletEntryType, WalletLotKind } from "@prisma/client";

type DbClient = Prisma.TransactionClient | typeof prisma;

async function runInTx<T>(
  tx: Prisma.TransactionClient | undefined,
  fn: (client: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (tx) {
    return fn(tx);
  }
  return prisma.$transaction(fn);
}

async function getActiveLotsForUser(
  db: DbClient,
  userId: string,
  now: Date
) {
  return db.walletLot.findMany({
    where: {
      userId,
      remainingPaise: { gt: 0 },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export interface WalletSummary {
  balancePaise: number;
  byKind: Record<WalletLotKind, number>;
  activeLots: Array<{
    id: string;
    kind: WalletLotKind;
    originalPaise: number;
    remainingPaise: number;
    expiresAt: Date | null;
    sourceType: string | null;
    sourceId: string | null;
    note: string | null;
    createdAt: Date;
  }>;
  recentEntries: Array<{
    id: string;
    lotId: string | null;
    type: WalletEntryType;
    amountPaise: number;
    balanceAfterPaise: number;
    orderId: string | null;
    actorId: string | null;
    reason: string;
    createdAt: Date;
  }>;
}

export async function getWalletSummary(
  userId: string,
  now: Date = new Date()
): Promise<WalletSummary> {
  const [activeLots, recentEntries] = await Promise.all([
    getActiveLotsForUser(prisma, userId, now),
    prisma.walletEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const byKind: Record<WalletLotKind, number> = {
    REFUND: 0,
    PROMO: 0,
    ADJUST: 0,
  };
  for (const lot of activeLots) {
    byKind[lot.kind] += lot.remainingPaise;
  }

  return {
    balancePaise: computeActiveWalletBalance(activeLots, now),
    byKind,
    activeLots,
    recentEntries,
  };
}

export interface CreditWalletLotInput {
  userId: string;
  kind: WalletLotKind;
  amountPaise: number;
  expiresAt?: Date | null;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
  reason: string;
  actorId?: string | null;
  orderId?: string | null;
  idempotencyKey?: string | null;
  now?: Date;
}

export async function creditWalletLot(
  input: CreditWalletLotInput,
  tx?: Prisma.TransactionClient
) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error("Credit amount must be a positive integer (paise).");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Reason is required.");
  }
  const now = input.now ?? new Date();

  return runInTx(tx, async (db) => {
    if (input.idempotencyKey) {
      const existing = await db.walletEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const lots = await getActiveLotsForUser(db, input.userId, now);
        const lot = existing.lotId
          ? await db.walletLot.findUnique({ where: { id: existing.lotId } })
          : null;
        return {
          idempotent: true,
          lot,
          entry: existing,
          balancePaise: computeActiveWalletBalance(lots, now),
        };
      }
    }

    const lot = await db.walletLot.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        originalPaise: input.amountPaise,
        remainingPaise: input.amountPaise,
        expiresAt: input.expiresAt ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        note: input.note ?? null,
      },
    });

    const lotsAfter = await getActiveLotsForUser(db, input.userId, now);
    const balanceAfterPaise = computeActiveWalletBalance(lotsAfter, now);

    const entryType: WalletEntryType =
      input.kind === "ADJUST" ? "ADJUST" : "CREDIT";

    const entry = await db.walletEntry.create({
      data: {
        userId: input.userId,
        lotId: lot.id,
        type: entryType,
        amountPaise: input.amountPaise,
        balanceAfterPaise,
        orderId: input.orderId ?? null,
        actorId: input.actorId ?? null,
        reason,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    return {
      idempotent: false,
      lot,
      entry,
      balancePaise: balanceAfterPaise,
    };
  });
}

export interface DebitWalletInput {
  userId: string;
  amountPaise: number;
  reason: string;
  orderId?: string | null;
  actorId?: string | null;
  idempotencyKey?: string | null;
  type?: "DEBIT" | "ADJUST";
  now?: Date;
}

export async function debitWallet(
  input: DebitWalletInput,
  tx?: Prisma.TransactionClient
) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error("Debit amount must be a positive integer (paise).");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Reason is required.");
  }
  const now = input.now ?? new Date();
  const entryType: WalletEntryType = input.type ?? "DEBIT";

  return runInTx(tx, async (db) => {
    if (input.idempotencyKey) {
      const existing = await db.walletEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const lots = await getActiveLotsForUser(db, input.userId, now);
        return {
          idempotent: true,
          entries: [existing],
          balancePaise: computeActiveWalletBalance(lots, now),
        };
      }
    }

    const activeLots = await getActiveLotsForUser(db, input.userId, now);
    const plan = allocateWalletDebit(activeLots, input.amountPaise, now);
    if (plan.shortfallPaise > 0) {
      throw new Error("Insufficient wallet balance.");
    }

    let runningBalance = computeActiveWalletBalance(activeLots, now);
    const entries = [];

    for (let i = 0; i < plan.allocations.length; i++) {
      const alloc = plan.allocations[i];
      const updated = await db.walletLot.updateMany({
        where: {
          id: alloc.lotId,
          remainingPaise: { gte: alloc.amountPaise },
        },
        data: {
          remainingPaise: { decrement: alloc.amountPaise },
        },
      });
      if (updated.count === 0) {
        throw new Error("Wallet balance changed concurrently, please retry.");
      }

      runningBalance -= alloc.amountPaise;
      const key =
        input.idempotencyKey == null
          ? null
          : i === 0
          ? input.idempotencyKey
          : `${input.idempotencyKey}:lot:${alloc.lotId}`;

      const entry = await db.walletEntry.create({
        data: {
          userId: input.userId,
          lotId: alloc.lotId,
          type: entryType,
          amountPaise: -alloc.amountPaise,
          balanceAfterPaise: runningBalance,
          orderId: input.orderId ?? null,
          actorId: input.actorId ?? null,
          reason,
          idempotencyKey: key,
        },
      });
      entries.push(entry);
    }

    return {
      idempotent: false,
      entries,
      balancePaise: runningBalance,
    };
  });
}

export interface AdminAdjustWalletInput {
  actorId: string;
  userId: string;
  deltaPaise: number;
  reason: string;
  note?: string | null;
  idempotencyKey?: string | null;
}

export async function adminAdjustWallet(input: AdminAdjustWalletInput) {
  if (!Number.isInteger(input.deltaPaise) || input.deltaPaise === 0) {
    throw new Error("Adjustment amount must be a non-zero integer (paise).");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Adjustment reason is required.");
  }

  const settings = await prisma.siteSettings.findUnique({
    where: { id: "default" },
    select: { maxAdminAdjustPaise: true },
  });
  const maxAdjust = settings?.maxAdminAdjustPaise ?? 500000;
  if (Math.abs(input.deltaPaise) > maxAdjust) {
    throw new Error(
      `Adjustment exceeds maximum allowed limit of ${maxAdjust} paise.`
    );
  }

  const result =
    input.deltaPaise > 0
      ? await creditWalletLot({
          userId: input.userId,
          kind: "ADJUST",
          amountPaise: input.deltaPaise,
          sourceType: "ADMIN",
          note: input.note ?? null,
          reason,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey ?? null,
        })
      : await debitWallet({
          userId: input.userId,
          amountPaise: Math.abs(input.deltaPaise),
          reason,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey ?? null,
          type: "ADJUST",
        });

  await writeAudit({
    actorId: input.actorId,
    action: "WALLET_ADMIN_ADJUST",
    entity: "User",
    entityId: input.userId,
    meta: {
      deltaPaise: input.deltaPaise,
      reason,
      balancePaise: result.balancePaise,
    },
  });

  return result;
}

export async function expireWalletLots(now: Date = new Date()) {
  const candidates = await prisma.walletLot.findMany({
    where: {
      remainingPaise: { gt: 0 },
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });

  let expiredCount = 0;
  let expiredPaise = 0;

  for (const lot of candidates) {
    const idempotencyKey = `expire:${lot.id}`;
    await prisma.$transaction(async (db) => {
      const existing = await db.walletEntry.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return;

      const updated = await db.walletLot.updateMany({
        where: {
          id: lot.id,
          remainingPaise: lot.remainingPaise,
        },
        data: { remainingPaise: 0 },
      });
      if (updated.count === 0) return;

      const remainingLots = await getActiveLotsForUser(db, lot.userId, now);
      const balanceAfterPaise = computeActiveWalletBalance(remainingLots, now);

      await db.walletEntry.create({
        data: {
          userId: lot.userId,
          lotId: lot.id,
          type: "EXPIRE",
          amountPaise: -lot.remainingPaise,
          balanceAfterPaise,
          reason: `Expired ${lot.kind} wallet lot`,
          idempotencyKey,
        },
      });

      expiredCount += 1;
      expiredPaise += lot.remainingPaise;
    });
  }

  return { expiredCount, expiredPaise };
}
