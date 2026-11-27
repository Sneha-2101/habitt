import { prisma } from "@/lib/prisma";
import {
  computeOrderGoodsNetPaise,
  computeRefundedGoodsPaise,
} from "@/lib/rewards/service";

export interface InfluencerOrderStatInput {
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  paymentStatus: string;
  fulfilmentStatus: string;
  totalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  refundedGoodsPaise: number;
  discountPaise: number;
  source: "COUPON" | "LINK" | null;
  isSelfOrder: boolean;
}

export interface InfluencerSummary {
  ordersPlaced: number;
  ordersDelivered: number;
  goodsSalesPaise: number;
  refundedGoodsPaise: number;
  netGoodsPaise: number;
  couponOrders: number;
  linkOrders: number;
  selfOrders: number;
}

export function isCountableOrder(
  fulfilmentStatus: string,
  paymentStatus: string
): boolean {
  return fulfilmentStatus !== "CANCELLED" && fulfilmentStatus !== "RTO" && paymentStatus !== "FAILED";
}

export function summarizeInfluencerOrders(
  rows: ReadonlyArray<InfluencerOrderStatInput>
): InfluencerSummary {
  let ordersPlaced = 0;
  let ordersDelivered = 0;
  let goodsSalesPaise = 0;
  let refundedGoodsPaise = 0;
  let netGoodsPaise = 0;
  let couponOrders = 0;
  let linkOrders = 0;
  let selfOrders = 0;

  for (const row of rows) {
    if (!isCountableOrder(row.fulfilmentStatus, row.paymentStatus)) {
      continue;
    }

    ordersPlaced++;
    if (row.fulfilmentStatus === "DELIVERED") {
      ordersDelivered++;
    }

    const orderGoodsNet = computeOrderGoodsNetPaise({
      total: row.totalPaise,
      shippingFee: row.shippingPaise,
      codFee: row.codFeePaise,
    });
    const refunded = Math.max(0, Math.trunc(row.refundedGoodsPaise));
    const netOrder = Math.max(0, orderGoodsNet - refunded);

    goodsSalesPaise += orderGoodsNet;
    refundedGoodsPaise += refunded;
    netGoodsPaise += netOrder;

    if (row.source === "COUPON") couponOrders++;
    else if (row.source === "LINK") linkOrders++;

    if (row.isSelfOrder) selfOrders++;
  }

  return {
    ordersPlaced,
    ordersDelivered,
    goodsSalesPaise,
    refundedGoodsPaise,
    netGoodsPaise,
    couponOrders,
    linkOrders,
    selfOrders,
  };
}

export interface InfluencerStatsRow {
  id: string;
  name: string;
  code: string;
  notes: string | null;
  active: boolean;
  hasEmail: boolean;
  discountPercent: number | null;
  offerActive: boolean;
  summary: InfluencerSummary;
}

export interface InfluencerOrderDetailRow {
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  paymentStatus: string;
  fulfilmentStatus: string;
  goodsNetPaise: number;
  refundedGoodsPaise: number;
  netGoodsPaise: number;
  source: "COUPON" | "LINK" | null;
  isSelfOrder: boolean;
}

export async function getInfluencerStats(params?: {
  influencerId?: string;
  from?: Date;
  to?: Date;
}): Promise<{
  influencers: InfluencerStatsRow[];
  orders: InfluencerOrderDetailRow[];
}> {
  const dateFilter =
    params?.from || params?.to
      ? {
          createdAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {};

  const influencers = await prisma.influencer.findMany({
    where: params?.influencerId ? { id: params.influencerId } : undefined,
    include: {
      offer: {
        select: { active: true, endsAt: true, config: true },
      },
      orders: {
        where: dateFilter,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          displayId: true,
          createdAt: true,
          paymentStatus: true,
          fulfilmentStatus: true,
          total: true,
          shippingFee: true,
          codFee: true,
          discountAmount: true,
          influencerSource: true,
          customerEmail: true,
          user: { select: { email: true } },
          items: {
            select: {
              id: true,
              unitPrice: true,
              qty: true,
              discountPaise: true,
              isGift: true,
            },
          },
          returnRequests: {
            select: {
              status: true,
              items: { select: { orderItemId: true, qty: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const detailOrders: InfluencerOrderDetailRow[] = [];

  const summaries: InfluencerStatsRow[] = influencers.map((inf) => {
    const infEmailNorm = inf.email?.trim().toLowerCase() || null;

    const orderInputs: InfluencerOrderStatInput[] = inf.orders.map((o) => {
      const refundedGoodsPaise = computeRefundedGoodsPaise(o);
      const goodsNetPaise = computeOrderGoodsNetPaise(o);
      const customerEmailNorm = (o.user?.email || o.customerEmail || "")
        .trim()
        .toLowerCase();
      const isSelfOrder = Boolean(
        infEmailNorm && customerEmailNorm && infEmailNorm === customerEmailNorm
      );

      if (params?.influencerId && isCountableOrder(o.fulfilmentStatus, o.paymentStatus)) {
        detailOrders.push({
          orderId: o.id,
          orderNumber: o.displayId,
          createdAt: o.createdAt,
          paymentStatus: o.paymentStatus,
          fulfilmentStatus: o.fulfilmentStatus,
          goodsNetPaise,
          refundedGoodsPaise,
          netGoodsPaise: Math.max(0, goodsNetPaise - refundedGoodsPaise),
          source: o.influencerSource,
          isSelfOrder,
        });
      }

      return {
        orderId: o.id,
        orderNumber: o.displayId,
        createdAt: o.createdAt,
        paymentStatus: o.paymentStatus,
        fulfilmentStatus: o.fulfilmentStatus,
        totalPaise: o.total,
        shippingPaise: o.shippingFee,
        codFeePaise: o.codFee,
        refundedGoodsPaise,
        discountPaise: o.discountAmount ?? 0,
        source: o.influencerSource,
        isSelfOrder,
      };
    });

    const now = new Date();
    const cfg = inf.offer?.config as { percent?: unknown } | null | undefined;
    const isOfferLive = Boolean(
      inf.offer &&
        inf.offer.active &&
        (!inf.offer.endsAt || inf.offer.endsAt > now)
    );
    const discountPercent =
      isOfferLive && typeof cfg?.percent === "number"
        ? cfg.percent
        : null;

    return {
      id: inf.id,
      name: inf.name,
      code: inf.code,
      notes: inf.notes,
      active: inf.active,
      hasEmail: Boolean(inf.email),
      discountPercent,
      offerActive: isOfferLive,
      summary: summarizeInfluencerOrders(orderInputs),
    };
  });

  return { influencers: summaries, orders: detailOrders };
}
