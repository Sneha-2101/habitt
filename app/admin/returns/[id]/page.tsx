import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { requireStaff } from "@/lib/guards";
import {
  approveReturn,
  rejectReturn,
  receiveReturn,
  refundReturn,
} from "@/lib/actions/returns";
import { computeRefund } from "@/lib/returns/rules";

export default async function AdminReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();
  const { id } = await params;

  const returnReq = await prisma.returnRequest.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          orderItem: {
            select: {
              id: true,
              name: true,
              size: true,
              color: true,
              unitPrice: true,
              qty: true,
              discountPaise: true,
              isGift: true,
            },
          },
        },
      },
      order: {
        include: {
          items: {
            select: {
              id: true,
              name: true,
              size: true,
              unitPrice: true,
              qty: true,
              discountPaise: true,
              isGift: true,
            },
          },
          refunds: true,
          returnRequests: {
            where: { status: { notIn: ["REJECTED", "CANCELLED"] } },
            include: { items: true },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          storeCreditBalance: true,
        },
      },
      refunds: true,
    },
  });

  if (!returnReq) notFound();

  // Compute refund preview
  const existingReturnedQtys: Record<string, number> = {};
  for (const otherReq of returnReq.order.returnRequests) {
    if (otherReq.id !== returnReq.id) {
      for (const it of otherReq.items) {
        existingReturnedQtys[it.orderItemId] =
          (existingReturnedQtys[it.orderItemId] || 0) + it.qty;
      }
    }
  }

  const returningQtys: Record<string, number> = {};
  for (const it of returnReq.items) {
    returningQtys[it.orderItemId] = it.qty;
  }

  const refundCalc = computeRefund({
    orderItems: returnReq.order.items,
    returningQtys,
    existingReturnedQtys,
    shippingFeePaise: returnReq.order.shippingFee,
    codFeePaise: 0,
    feesAlreadyRefunded: returnReq.order.refunds.some(
      (r) => r.status === "PROCESSED" && r.returnId !== returnReq.id
    ),
    totalPaidPaise: returnReq.order.total,
    cumulativeRefundedPaise: returnReq.order.refunds
      .filter((r) => r.status === "PROCESSED")
      .reduce((s, r) => s + r.amountPaise, 0),
  });

  const now = Date.now();
  const SLA_MS = 36 * 60 * 60 * 1000;
  const isAwaitingRefund =
    (returnReq.status === "APPROVED" || returnReq.status === "RECEIVED") &&
    !returnReq.refundInitiatedAt;
  const relevantTimestamp =
    returnReq.approvedAt || returnReq.receivedAt || returnReq.updatedAt;
  const isSlaBreached =
    isAwaitingRefund && now - new Date(relevantTimestamp).getTime() > SLA_MS;

  const defaultRefundMethod =
    returnReq.order.paymentMethod === "COD" ? "STORE_CREDIT" : "RAZORPAY";

  return (
    <main className="px-7 py-9 max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-medium">
              Return Request #{returnReq.id.slice(-8)}
            </h1>
            <span
              className={`text-xs font-semibold px-2.5 py-0.5 rounded uppercase ${
                returnReq.status === "REFUNDED"
                  ? "bg-emerald-100 text-emerald-800"
                  : returnReq.status === "REJECTED" || returnReq.status === "CANCELLED"
                  ? "bg-stone-200 text-stone-700"
                  : returnReq.status === "RECEIVED"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {returnReq.status}
            </span>
            {isSlaBreached && (
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-red-600 text-white animate-pulse">
                SLA &gt; 36h: REFUND DUE
              </span>
            )}
          </div>
          <p className="text-xs text-stone-dark mt-1">
            Created on {new Date(returnReq.createdAt).toLocaleString("en-IN")}
          </p>
        </div>
        <Link href="/admin/returns" className="text-xs text-stone-dark hover:text-ink underline">
          ← Back to Returns Queue
        </Link>
      </div>

      {/* Order & Customer Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="border border-stone bg-white p-4 rounded-sm space-y-2">
          <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
            Order Information
          </p>
          <div className="space-y-1">
            <p>
              <strong className="text-stone-dark">Order ID:</strong>{" "}
              <Link
                href={`/admin/orders/${returnReq.order.id}`}
                className="font-mono text-ink underline"
              >
                #{returnReq.order.displayId}
              </Link>
            </p>
            <p>
              <strong className="text-stone-dark">Total:</strong>{" "}
              <span className="font-mono font-medium">{formatINR(returnReq.order.total)}</span>
            </p>
            <p>
              <strong className="text-stone-dark">Payment Method:</strong>{" "}
              <span className="font-medium">{returnReq.order.paymentMethod}</span>
            </p>
            <p>
              <strong className="text-stone-dark">Payment Status:</strong>{" "}
              <span className="font-medium">{returnReq.order.paymentStatus}</span>
            </p>
            <p>
              <strong className="text-stone-dark">Fulfilment:</strong>{" "}
              <span className="font-medium">{returnReq.order.fulfilmentStatus}</span>
            </p>
          </div>
        </div>

        <div className="border border-stone bg-white p-4 rounded-sm space-y-2">
          <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
            Customer Details
          </p>
          <div className="space-y-1">
            <p>
              <strong className="text-stone-dark">Name:</strong> {returnReq.user.name}
            </p>
            <p>
              <strong className="text-stone-dark">Email:</strong> {returnReq.user.email}
            </p>
            <p>
              <strong className="text-stone-dark">Phone:</strong> {returnReq.user.phone || "N/A"}
            </p>
            <p>
              <strong className="text-stone-dark">Store Credit Balance:</strong>{" "}
              <span className="font-mono">{formatINR(returnReq.user.storeCreditBalance)}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Return Request Details */}
      <div className="border border-stone bg-white p-5 rounded-sm space-y-3 text-xs">
        <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
          Return Request Details
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p>
              <strong className="text-stone-dark">Reason Code:</strong> {returnReq.reasonCode}
            </p>
            <p className="mt-1">
              <strong className="text-stone-dark">Description:</strong> {returnReq.reason}
            </p>
            {returnReq.customerNote && (
              <p className="mt-1">
                <strong className="text-stone-dark">Customer Note:</strong> {returnReq.customerNote}
              </p>
            )}
          </div>
          <div className="space-y-1">
            {returnReq.approvedAt && (
              <p>
                <strong className="text-stone-dark">Approved At:</strong>{" "}
                {new Date(returnReq.approvedAt).toLocaleString("en-IN")}
              </p>
            )}
            {returnReq.receivedAt && (
              <p>
                <strong className="text-stone-dark">Received At:</strong>{" "}
                {new Date(returnReq.receivedAt).toLocaleString("en-IN")}
              </p>
            )}
            {returnReq.refundInitiatedAt && (
              <p>
                <strong className="text-stone-dark">Refund Initiated At:</strong>{" "}
                {new Date(returnReq.refundInitiatedAt).toLocaleString("en-IN")}
              </p>
            )}
            {returnReq.rejectedReason && (
              <p className="text-clay">
                <strong>Rejection Reason:</strong> {returnReq.rejectedReason}
              </p>
            )}
            {returnReq.adminNote && (
              <p>
                <strong className="text-stone-dark">Admin Note:</strong> {returnReq.adminNote}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Items in this Return */}
      <div className="border border-stone bg-white rounded-sm overflow-hidden text-xs">
        <div className="p-4 bg-paper border-b border-stone font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
          Items to Return
        </div>
        <div className="divide-y divide-stone">
          {returnReq.items.map((it) => (
            <div key={it.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">
                  {it.orderItem.name} ({it.orderItem.size})
                </p>
                <p className="text-stone-dark mt-0.5">
                  Unit Price: {formatINR(it.orderItem.unitPrice)}
                </p>
                {it.condition && (
                  <p className="text-stone-dark mt-0.5">
                    Condition: <span className="font-medium text-ink">{it.condition}</span> ·
                    Restocked:{" "}
                    <span className="font-medium text-ink">{it.restock ? "Yes" : "No"}</span>
                  </p>
                )}
              </div>
              <div className="text-right">
                <span className="font-mono text-sm font-semibold">Qty: {it.qty}</span>
                <p className="text-[11px] text-stone-dark mt-0.5">
                  Est. Refund: {formatINR(refundCalc.itemRefunds[it.orderItemId] || 0)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Refund Calculation & Actions */}
      <div className="border border-stone bg-white p-5 rounded-sm space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-stone/50 pb-3">
          <div>
            <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
              Computed Refund Breakdown
            </p>
            <p className="text-stone-dark text-[11px] mt-0.5">
              Net line values rounded pro-rata. Fees refunded only when full order return completes.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-stone-dark">Total Refund Amount</p>
            <p className="font-mono text-lg font-bold text-ink">
              {formatINR(refundCalc.totalRefundPaise)}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 text-stone-dark">
          <div className="flex justify-between">
            <span>Items Subtotal:</span>
            <span className="font-mono text-ink">{formatINR(refundCalc.itemsSubtotalPaise)}</span>
          </div>
          <div className="flex justify-between">
            <span>
              Shipping Fee Refund (
              {refundCalc.isCompleteReturn ? "Complete return" : "Partial return — not refunded"}):
            </span>
            <span className="font-mono text-ink">
              {formatINR(refundCalc.shippingFeeRefundPaise)}
            </span>
          </div>
          {refundCalc.codFeeRefundPaise > 0 && (
            <div className="flex justify-between">
              <span>COD Fee Refund:</span>
              <span className="font-mono text-ink">
                {formatINR(refundCalc.codFeeRefundPaise)}
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons based on status */}
        <div className="border-t border-stone/50 pt-4 space-y-4">
          {/* Action 1: If REQUESTED -> Approve or Reject */}
          {returnReq.status === "REQUESTED" && (
            <div className="space-y-3">
              <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
                Staff Actions: Approve or Reject
              </p>
              <div className="flex flex-wrap gap-4 items-start">
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const note = formData.get("note") as string;
                    await approveReturn(returnReq.id, note);
                  }}
                  className="flex flex-col gap-2 p-3 bg-paper border border-stone rounded-sm flex-1"
                >
                  <label className="font-medium text-stone-dark">Approve Return Request</label>
                  <input
                    name="note"
                    type="text"
                    placeholder="Approval note (optional)"
                    className="px-3 py-1.5 border border-stone text-xs rounded-sm bg-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-800 text-white font-medium rounded-sm hover:bg-emerald-900 self-start"
                  >
                    APPROVE RETURN
                  </button>
                </form>

                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const note = formData.get("note") as string;
                    await rejectReturn(returnReq.id, note);
                  }}
                  className="flex flex-col gap-2 p-3 bg-paper border border-stone rounded-sm flex-1"
                >
                  <label className="font-medium text-clay">Reject Return Request</label>
                  <input
                    name="note"
                    type="text"
                    required
                    placeholder="Rejection reason (required)"
                    className="px-3 py-1.5 border border-stone text-xs rounded-sm bg-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-clay text-white font-medium rounded-sm hover:bg-red-800 self-start"
                  >
                    REJECT RETURN
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Action 2: If APPROVED -> Mark Received */}
          {returnReq.status === "APPROVED" && (
            <div className="p-4 bg-paper border border-stone rounded-sm space-y-3">
              <p className="font-semibold text-stone-dark uppercase tracking-wider text-[11px]">
                Mark Returned Items as Received & Restock
              </p>
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const itemActions = returnReq.items.map((it) => {
                    const restock = formData.get(`restock_${it.id}`) === "on";
                    const condition = (formData.get(`condition_${it.id}`) as string) || "Good";
                    return { returnItemId: it.id, restock, condition };
                  });
                  const note = formData.get("adminNote") as string;
                  await receiveReturn(returnReq.id, itemActions, note);
                }}
                className="space-y-3"
              >
                <div className="space-y-2">
                  {returnReq.items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between p-2.5 bg-white border border-stone/50 rounded-sm"
                    >
                      <div>
                        <p className="font-medium text-ink">
                          {it.orderItem.name} ({it.orderItem.size}) × {it.qty}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            name={`restock_${it.id}`}
                            defaultChecked
                            className="rounded text-ink focus:ring-0"
                          />
                          <span>Restock Inventory</span>
                        </label>
                        <input
                          type="text"
                          name={`condition_${it.id}`}
                          defaultValue="Good"
                          placeholder="Condition (e.g. Good, Damaged)"
                          className="px-2 py-1 border border-stone rounded-sm text-xs w-36 bg-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 items-center pt-1">
                  <input
                    name="adminNote"
                    type="text"
                    placeholder="Inspection note (optional)"
                    className="px-3 py-1.5 border border-stone text-xs rounded-sm flex-1 bg-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-800 text-white font-medium rounded-sm hover:bg-indigo-900"
                  >
                    MARK RECEIVED & RESTOCK
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Action 3: If RECEIVED or APPROVED -> Initiate Refund */}
          {(returnReq.status === "RECEIVED" || returnReq.status === "APPROVED") && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-sm space-y-3">
              <p className="font-semibold text-emerald-950 uppercase tracking-wider text-[11px]">
                Initiate Refund ({formatINR(refundCalc.totalRefundPaise)})
              </p>
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const override = formData.get("overrideToStoreCredit") === "on";
                  await refundReturn(returnReq.id, {
                    overrideMethod: override ? "STORE_CREDIT" : undefined,
                  });
                }}
                className="space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-ink">
                      Default Destination:{" "}
                      <strong className="uppercase">
                        {defaultRefundMethod === "RAZORPAY"
                          ? "Razorpay (Original Payment Method)"
                          : "Store Credit"}
                      </strong>
                    </p>
                    {defaultRefundMethod === "RAZORPAY" && (
                      <label className="flex items-center gap-2 mt-2 cursor-pointer">
                        <input
                          type="checkbox"
                          name="overrideToStoreCredit"
                          className="rounded text-ink focus:ring-0"
                        />
                        <span className="text-stone-dark font-medium">
                          Override destination to Store Credit wallet
                        </span>
                      </label>
                    )}
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-emerald-800 text-white font-semibold rounded-sm hover:bg-emerald-900 shadow-sm"
                  >
                    EXECUTE REFUND ({formatINR(refundCalc.totalRefundPaise)})
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Refunded confirmation */}
          {returnReq.status === "REFUNDED" && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-sm text-xs space-y-2">
              <p className="font-semibold text-emerald-900 uppercase tracking-wider text-[11px]">
                Refund Completed
              </p>
              {returnReq.refunds && returnReq.refunds.length > 0 ? (
                returnReq.refunds.map((rf) => (
                  <div key={rf.id} className="space-y-1 text-emerald-950">
                    <p>
                      <strong>Ledger Refund ID:</strong> <span className="font-mono">{rf.id}</span>
                    </p>
                    <p>
                      <strong>Method:</strong> {rf.method} · <strong>Status:</strong> {rf.status}
                    </p>
                    <p>
                      <strong>Amount:</strong> {formatINR(rf.amountPaise)}
                    </p>
                    {rf.providerRefundId && (
                      <p>
                        <strong>Provider Refund Ref:</strong>{" "}
                        <span className="font-mono">{rf.providerRefundId}</span>
                      </p>
                    )}
                    {rf.processedAt && (
                      <p>
                        <strong>Processed At:</strong>{" "}
                        {new Date(rf.processedAt).toLocaleString("en-IN")}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-emerald-900">
                  Refund of {formatINR(refundCalc.totalRefundPaise)} recorded.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
