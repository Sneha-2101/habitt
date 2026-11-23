import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/guards";
import { getSettings } from "@/lib/settings";

export const KNOWN_CRON_SCHEDULES: Record<string, number> = {
  "outbox": 10 * 60 * 1000, // 10 min
  "shipment-sync": 2 * 60 * 60 * 1000, // 2 hr
  "ticket-sla": 2 * 60 * 60 * 1000, // 2 hr
  "close-stale-orders": 2 * 60 * 60 * 1000, // 2 hr
  "abandoned-cart": 2 * 60 * 60 * 1000, // 2 hr
  "birthday-discount": 24 * 60 * 60 * 1000, // 24 hr
};

export function checkCronStaleness(
  jobName: string,
  lastRun: { ok: boolean | null; startedAt: Date } | null | undefined,
  now: Date = new Date(),
  customIntervalMs?: number
): { isStale: boolean; isFailed: boolean; reason?: string } {
  if (!lastRun) {
    return { isStale: true, isFailed: false, reason: "Never executed" };
  }
  const isFailed = lastRun.ok === false;
  const interval = customIntervalMs || KNOWN_CRON_SCHEDULES[jobName] || 2 * 60 * 60 * 1000;
  const elapsed = now.getTime() - new Date(lastRun.startedAt).getTime();
  const isStale = elapsed > 2 * interval;
  let reason: string | undefined;
  if (isFailed) reason = "Last run failed";
  else if (isStale) reason = `Last run was ${Math.round(elapsed / 60000)}m ago (> 2x interval)`;
  return { isStale, isFailed, reason };
}

export interface LowStockGroup {
  productId: string;
  productName: string;
  color: string;
  items: {
    variantId: string;
    size: string;
    stock: number;
  }[];
}

export interface DashboardStats {
  ordersToShip: number;
  shipped7d: number;
  delivered7d: number;
  pendingReturns: number;
  returnsSlaBreach: number;
  openTickets: number;
  overdueTickets: number;
  failedOutbox: number;
  staleCrons: { jobName: string; reason: string }[];
  revenueToday: number;
  revenue7d: number;
  lowStockGroups: LowStockGroup[];
  lowStockThreshold: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  await requireStaff();
  const settings = await getSettings();
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtySixHoursAgo = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const [
    ordersToShip,
    shipped7d,
    delivered7d,
    pendingReturns,
    returnsSlaBreach,
    openTickets,
    overdueTickets,
    failedOutbox,
    ordersToday,
    ordersWeek,
    lowStockVariants,
    recentCronRuns,
  ] = await Promise.all([
    // 1. Orders to ship: PAID or COD with fulfilment PLACED, CONFIRMED, or PACKED
    prisma.order.count({
      where: {
        OR: [
          {
            paymentStatus: "PAID",
            fulfilmentStatus: { in: ["PLACED", "CONFIRMED", "PACKED"] },
          },
          {
            paymentMethod: "COD",
            paymentStatus: { in: ["COD_PENDING", "PAID"] },
            fulfilmentStatus: { in: ["PLACED", "CONFIRMED", "PACKED"] },
          },
        ],
      },
    }),

    // 2. Shipped (last 7 days)
    prisma.order.count({
      where: {
        fulfilmentStatus: "SHIPPED",
        updatedAt: { gte: sevenDaysAgo },
      },
    }),

    // 3. Delivered (last 7 days)
    prisma.order.count({
      where: {
        fulfilmentStatus: "DELIVERED",
        OR: [
          { deliveredAt: { gte: sevenDaysAgo } },
          { deliveredAt: null, updatedAt: { gte: sevenDaysAgo } },
        ],
      },
    }),

    // 4. Pending returns (REQUESTED, APPROVED, RECEIVED)
    prisma.returnRequest.count({
      where: {
        status: { in: ["REQUESTED", "APPROVED", "RECEIVED"] },
      },
    }),

    // 5. Returns with SLA breach (> 36 hours since REQUESTED)
    prisma.returnRequest.count({
      where: {
        status: "REQUESTED",
        createdAt: { lte: thirtySixHoursAgo },
      },
    }),

    // 6. Open tickets
    prisma.ticket.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      },
    }),

    // 7. Overdue tickets (unacknowledged past ackDueAt OR past resolveDueAt)
    prisma.ticket.count({
      where: {
        status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] },
        OR: [
          { acknowledgedAt: null, ackDueAt: { lte: now } },
          { resolveDueAt: { lte: now } },
        ],
      },
    }),

    // 8. Failed outbox rows
    prisma.eventOutbox.count({
      where: {
        status: "FAILED",
      },
    }),

    // 9. Revenue today from PAID or COD_COLLECTED
    prisma.order.findMany({
      where: {
        createdAt: { gte: startOfToday },
        paymentStatus: { in: ["PAID", "COD_COLLECTED"] },
      },
      select: { total: true },
    }),

    // 10. Revenue last 7 days from PAID or COD_COLLECTED
    prisma.order.findMany({
      where: {
        createdAt: { gte: sevenDaysAgo },
        paymentStatus: { in: ["PAID", "COD_COLLECTED"] },
      },
      select: { total: true },
    }),

    // 11. Low stock variants
    prisma.productVariant.findMany({
      where: {
        stock: { lte: settings.lowStockThreshold },
      },
      select: {
        id: true,
        productId: true,
        size: true,
        color: true,
        stock: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: [{ productId: "asc" }, { color: "asc" }, { size: "asc" }],
      take: 40,
    }),

    // 12. Recent cron runs
    prisma.cronRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        job: true,
        ok: true,
        startedAt: true,
      },
    }),
  ]);

  const revenueToday = ordersToday.reduce((sum, o) => sum + o.total, 0);
  const revenue7d = ordersWeek.reduce((sum, o) => sum + o.total, 0);

  // Group low stock by product then color
  const groupMap = new Map<string, LowStockGroup>();
  for (const v of lowStockVariants) {
    const key = `${v.productId}:::${v.color || ""}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        productId: v.productId,
        productName: v.product.name,
        color: v.color || "Default",
        items: [],
      });
    }
    groupMap.get(key)!.items.push({
      variantId: v.id,
      size: v.size,
      stock: v.stock,
    });
  }

  // Check staleness of each known cron job
  const latestRunsByJob = new Map<string, { ok: boolean | null; startedAt: Date }>();
  for (const r of recentCronRuns) {
    if (!latestRunsByJob.has(r.job)) {
      latestRunsByJob.set(r.job, r);
    }
  }

  const staleCrons: { jobName: string; reason: string }[] = [];
  for (const jobName of Object.keys(KNOWN_CRON_SCHEDULES)) {
    const run = latestRunsByJob.get(jobName);
    const check = checkCronStaleness(jobName, run, now);
    if (check.isFailed || check.isStale) {
      staleCrons.push({
        jobName,
        reason: check.reason || "Stale execution",
      });
    }
  }

  return {
    ordersToShip,
    shipped7d,
    delivered7d,
    pendingReturns,
    returnsSlaBreach,
    openTickets,
    overdueTickets,
    failedOutbox,
    staleCrons,
    revenueToday,
    revenue7d,
    lowStockGroups: Array.from(groupMap.values()),
    lowStockThreshold: settings.lowStockThreshold,
  };
}
