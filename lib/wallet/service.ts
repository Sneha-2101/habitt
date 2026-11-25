import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import {
  allocateWalletDebit,
  computeActiveWalletBalance,
  WALLET_RESTORE_GRACE_DAYS,
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

async function lockUserWallet(
  db: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
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

/**
 * Read-only active wallet balance (no advisory lock), used by quote & UI.
 */
export async function getWalletBalance(
  db: DbClient,
  userId: string,
  now: Date = new Date()
): Promise<number> {
  const activeLots = await getActiveLotsForUser(db, userId, now);
  return computeActiveWalletBalance(activeLots, now);
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
    await lockUserWallet(db, input.userId);

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
    await lockUserWallet(db, input.userId);

    if (input.idempotencyKey) {
      const existing = await db.walletEntry.findMany({
        where: {
          OR: [
            { idempotencyKey: input.idempotencyKey },
            { idempotencyKey: { startsWith: `${input.idempotencyKey}:lot:` } },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (existing.length > 0) {
        const lots = await getActiveLotsForUser(db, input.userId, now);
        return {
          idempotent: true,
          entries: existing,
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
        throw new Error("Insufficient wallet balance.");
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

export interface RestoreWalletDebitInput {
  userId: string;
  orderId: string;
  amountPaise?: number;
  reason: string;
  actorId?: string | null;
  idempotencyKey?: string | null;
  now?: Date;
}

/**
 * Restore debited wallet funds for an order in LIFO order back into original lots.
 * If an original lot is expired, creates a new lot of the same kind with
 * expiresAt = now + WALLET_RESTORE_GRACE_DAYS.
 */
export async function restoreWalletDebit(
  tx: Prisma.TransactionClient,
  input: RestoreWalletDebitInput
) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Restore reason is required.");
  }
  const now = input.now ?? new Date();

  await lockUserWallet(tx, input.userId);

  if (input.idempotencyKey) {
    const existing = await tx.walletEntry.findMany({
      where: {
        OR: [
          { idempotencyKey: input.idempotencyKey },
          { idempotencyKey: { startsWith: `${input.idempotencyKey}:lot:` } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (existing.length > 0) {
      const lots = await getActiveLotsForUser(tx, input.userId, now);
      return {
        idempotent: true,
        restoredPaise: existing.reduce((s, e) => s + e.amountPaise, 0),
        entries: existing,
        balancePaise: computeActiveWalletBalance(lots, now),
      };
    }
  }

  const orderEntries = await tx.walletEntry.findMany({
    where: {
      userId: input.userId,
      orderId: input.orderId,
      type: { in: ["DEBIT", "RESTORE"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const totalDebited = orderEntries
    .filter((e) => e.type === "DEBIT")
    .reduce((s, e) => s + Math.abs(e.amountPaise), 0);
  const totalRestored = orderEntries
    .filter((e) => e.type === "RESTORE")
    .reduce((s, e) => s + e.amountPaise, 0);

  const restorable = Math.max(0, totalDebited - totalRestored);
  if (restorable === 0) {
    const lots = await getActiveLotsForUser(tx, input.userId, now);
    return {
      idempotent: false,
      restoredPaise: 0,
      entries: [],
      balancePaise: computeActiveWalletBalance(lots, now),
    };
  }

  const targetRestore =
    input.amountPaise !== undefined
      ? Math.min(input.amountPaise, restorable)
      : restorable;

  if (!Number.isInteger(targetRestore) || targetRestore <= 0) {
    const lots = await getActiveLotsForUser(tx, input.userId, now);
    return {
      idempotent: false,
      restoredPaise: 0,
      entries: [],
      balancePaise: computeActiveWalletBalance(lots, now),
    };
  }

  // Track how much was already restored per lot (if any)
  const restoredByLot = new Map<string, number>();
  for (const e of orderEntries) {
    if (e.type === "RESTORE" && e.lotId) {
      restoredByLot.set(e.lotId, (restoredByLot.get(e.lotId) ?? 0) + e.amountPaise);
    }
  }

  // Walk DEBIT entries in LIFO order
  const debitEntriesLifo = orderEntries
    .filter((e) => e.type === "DEBIT" && e.lotId !== null)
    .slice()
    .reverse();

  let remainingToRestore = targetRestore;
  let runningBalance = computeActiveWalletBalance(
    await getActiveLotsForUser(tx, input.userId, now),
    now
  );
  const createdEntries = [];
  let entryIdx = 0;

  for (const deb of debitEntriesLifo) {
    if (remainingToRestore <= 0) break;
    const lotId = deb.lotId!;
    const debitedFromLot = Math.abs(deb.amountPaise);
    const alreadyRestoredFromLot = restoredByLot.get(lotId) ?? 0;
    const lotRestorable = Math.max(0, debitedFromLot - alreadyRestoredFromLot);
    if (lotRestorable === 0) continue;

    const take = Math.min(lotRestorable, remainingToRestore);
    restoredByLot.set(lotId, alreadyRestoredFromLot + take);

    const origLot = await tx.walletLot.findUnique({ where: { id: lotId } });
    if (!origLot) continue;

    const isExpired =
      origLot.expiresAt !== null && origLot.expiresAt.getTime() <= now.getTime();

    let targetLotId = origLot.id;

    if (!isExpired && origLot.remainingPaise + take <= origLot.originalPaise) {
      const upd = await tx.walletLot.updateMany({
        where: {
          id: origLot.id,
          remainingPaise: { lte: origLot.originalPaise - take },
        },
        data: {
          remainingPaise: { increment: take },
        },
      });
      if (upd.count === 0) {
        throw new Error("Failed to restore wallet lot within original cap.");
      }
    } else {
      const graceExpiresAt = new Date(
        now.getTime() + WALLET_RESTORE_GRACE_DAYS * 24 * 60 * 60 * 1000
      );
      const graceLot = await tx.walletLot.create({
        data: {
          userId: input.userId,
          kind: origLot.kind,
          originalPaise: take,
          remainingPaise: take,
          expiresAt: graceExpiresAt,
          sourceType: "RESTORE_GRACE",
          sourceId: `${input.orderId}:${origLot.id}:${entryIdx}`,
          note: `Grace lot restored from expired lot ${origLot.id}`,
        },
      });
      targetLotId = graceLot.id;
    }

    runningBalance += take;
    const key =
      input.idempotencyKey == null
        ? null
        : entryIdx === 0
        ? input.idempotencyKey
        : `${input.idempotencyKey}:lot:${targetLotId}:${entryIdx}`;

    const entry = await tx.walletEntry.create({
      data: {
        userId: input.userId,
        lotId: targetLotId,
        type: "RESTORE",
        amountPaise: take,
        balanceAfterPaise: runningBalance,
        orderId: input.orderId,
        actorId: input.actorId ?? null,
        reason,
        idempotencyKey: key,
      },
    });

    createdEntries.push(entry);
    remainingToRestore -= take;
    entryIdx += 1;
  }

  return {
    idempotent: false,
    restoredPaise: targetRestore - remainingToRestore,
    entries: createdEntries,
    balancePaise: runningBalance,
  };
}

export interface RefundToWalletInput {
  userId: string;
  orderId: string;
  amountPaise: number;
  refundId: string;
  reason: string;
  actorId?: string | null;
  now?: Date;
}

/**
 * Refunds an amount to the user's wallet inside the caller's transaction:
 * restores any restorable order debit first, then credits a non-expiring REFUND lot
 * for any remainder. Idempotent per refundId.
 */
export async function refundToWallet(
  tx: Prisma.TransactionClient,
  input: RefundToWalletInput
) {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error("Refund amount must be a positive integer (paise).");
  }
  const now = input.now ?? new Date();
  await lockUserWallet(tx, input.userId);

  const restoreRes = await restoreWalletDebit(tx, {
    userId: input.userId,
    orderId: input.orderId,
    amountPaise: input.amountPaise,
    reason: input.reason,
    actorId: input.actorId ?? null,
    idempotencyKey: `refund-restore:${input.refundId}`,
    now,
  });

  const remainder = input.amountPaise - restoreRes.restoredPaise;
  let creditedPaise = 0;
  let finalBalance = restoreRes.balancePaise;

  if (remainder > 0) {
    const creditRes = await creditWalletLot(
      {
        userId: input.userId,
        kind: "REFUND",
        amountPaise: remainder,
        expiresAt: null,
        sourceType: "REFUND",
        sourceId: input.refundId,
        reason: input.reason,
        actorId: input.actorId ?? null,
        orderId: input.orderId,
        idempotencyKey: `refund-credit:${input.refundId}`,
        now,
      },
      tx
    );
    creditedPaise = remainder;
    finalBalance = creditRes.balancePaise;
  }

  return {
    restoredPaise: restoreRes.restoredPaise,
    creditedPaise,
    balancePaise: finalBalance,
  };
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
      await lockUserWallet(db, lot.userId);

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
