import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { revalidatePath } from "next/cache";
import type { OrderStatus } from "@prisma/client";
import { markOrderShipped, markOrderDelivered } from "@/lib/actions/fulfillment";
import { cancelOrderAsAdmin } from "@/lib/actions/cancellation";
import { addOrderNote } from "@/lib/actions/notes";
import { requireStaff } from "@/lib/guards";
import { canTransition, nextStatusOptions } from "@/lib/orders/transitions";
import { updateOrderShippingAddress } from "@/lib/actions/order-address";

async function updateStatus(orderId: string, formData: FormData) {
  "use server";
  await requireStaff();
  const targetStatus = formData.get("status") as OrderStatus;

  // Never allow manual transition to PAID, PENDING, or FAILED
  if (targetStatus === "PAID" || targetStatus === "PENDING" || targetStatus === "FAILED") {
    throw new Error("Invalid manual status change");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, paymentMethod: true },
  });
  if (!order) throw new Error("Order not found");

  if (!canTransition(order.paymentMethod, order.status, targetStatus)) {
    throw new Error(`Illegal status transition from ${order.status} to ${targetStatus}`);
  }

  const priorStatus = order.status;

  await prisma.$transaction(async (tx) => {
    const updateRes = await tx.order.updateMany({
      where: { id: orderId, status: priorStatus },
      data: { status: targetStatus },
    });

    if (updateRes.count === 0) {
      throw new Error("Order already changed");
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: targetStatus,
        note: `Status updated manually to ${targetStatus}`,
      },
    });
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const order = await prisma.order.findUnique({
    where: { id: resolvedParams.id },
    include: {
      items: true,
      statusEvents: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) notFound();

  const updateWithId = updateStatus.bind(null, order.id);
  const updateAddressWithId = async (formData: FormData) => {
    "use server";
    await updateOrderShippingAddress(order.id, formData);
  };
  const availableStatuses = nextStatusOptions({ paymentMethod: order.paymentMethod, status: order.status });

  const variantIds = order.items.map((i) => i.variantId).filter(Boolean);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, stock: true },
  });
  const variantStockMap = new Map(variants.map((v) => [v.id, v.stock]));

  const address = typeof order.shippingAddress === "object" && order.shippingAddress !== null
    ? (order.shippingAddress as Record<string, string | undefined>)
    : {};

  const formattedAddress = [
    address.addressLine1 || address.street || address.line1,
    address.addressLine2 || address.line2,
    address.city,
    address.state,
    address.pincode || address.postalCode,
  ].filter(Boolean).join(", ");

  return (
    <main className="px-7 py-9 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl mb-1">{order.displayId}</h1>
          <p className="text-[13px] text-stone-dark">
            {order.customerName} · {order.customerPhone} {order.customerEmail ? `· ${order.customerEmail}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/orders/${order.id}/invoice`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-1 border border-stone bg-white rounded hover:bg-paper font-medium"
          >
            📄 Print Invoice
          </a>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded ${
              order.paymentMethod === "STORE_CREDIT"
                ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                : order.paymentMethod === "COD"
                ? "bg-amber-100 text-amber-900 border border-amber-300"
                : "bg-paper text-stone-dark border border-stone/50"
            }`}
          >
            {order.storeCreditApplied > 0
              ? order.paymentMethod === "STORE_CREDIT"
                ? "100% Paid via Store Credit"
                : `${formatINR(order.storeCreditApplied)} Store Credit + ${formatINR(order.total - order.storeCreditApplied)} ${order.paymentMethod === "COD" ? "COD" : "Razorpay"}`
              : order.paymentMethod === "COD"
              ? "Cash on Delivery (COD)"
              : "Prepaid (Razorpay)"}
          </span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded ${
              order.status === "PAID" || order.status === "DELIVERED"
                ? "bg-emerald-100 text-emerald-800"
                : order.status === "SHIPPED"
                ? "bg-blue-100 text-blue-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {order.status}
          </span>
        </div>
      </div>

      {/* Order Items */}
      <div className="border border-stone bg-white p-5 rounded-sm">
        <h2 className="text-xs font-semibold text-stone-dark uppercase tracking-wider mb-3">Order Items</h2>
        {order.items.map((i) => {
          const currentStock = variantStockMap.get(i.variantId);
          return (
            <div key={i.id} className="flex justify-between items-center text-[13px] mb-2 pb-2 border-b border-stone/30 last:border-0">
              <div>
                <span>{i.name} — {i.size} × {i.qty}</span>
                {currentStock !== undefined && (
                  <span
                    className={`ml-2 text-[11px] font-mono px-1.5 py-0.5 rounded ${
                      currentStock === 0
                        ? "bg-red-100 text-red-800 font-semibold"
                        : currentStock < 5
                        ? "bg-amber-100 text-amber-800"
                        : "bg-stone/20 text-stone-dark"
                    }`}
                  >
                    Stock: {currentStock} left
                  </span>
                )}
              </div>
              <span className="font-mono">{formatINR(i.unitPrice * i.qty)}</span>
            </div>
          );
        })}
        <div className="pt-2 mt-2 border-t border-stone text-[13.5px] space-y-1">
          {order.storeCreditApplied > 0 && (
            <div className="flex justify-between text-emerald-800 text-xs font-medium">
              <span>Store Credit Applied</span>
              <span className="font-mono">-{formatINR(order.storeCreditApplied)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold pt-1">
            <span>Gross Total</span>
            <span className="font-mono">{formatINR(order.total)}</span>
          </div>
          {order.storeCreditApplied > 0 && (
            <div className="flex justify-between font-semibold text-ink pt-1 border-t border-stone/30">
              <span>Remaining Payable ({order.paymentMethod === "COD" ? "COD" : order.paymentMethod === "STORE_CREDIT" ? "Paid" : "Razorpay"})</span>
              <span className="font-mono">{formatINR(Math.max(0, order.total - order.storeCreditApplied))}</span>
            </div>
          )}
        </div>
      </div>

      {/* Shipping Address */}
      <div className="border border-stone bg-white p-5 rounded-sm text-[13px] space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wider text-stone-dark uppercase">Shipping Address</div>
          {(order.status === "PENDING" || order.status === "PAID") && (
            <span className="text-[11px] text-moss font-medium">Editable before dispatch</span>
          )}
        </div>
        <p className="text-ink">{formattedAddress || "Standard Delivery Address"}</p>

        {(order.status === "PENDING" || order.status === "PAID") && (
          <details className="mt-3 pt-3 border-t border-stone/40">
            <summary className="text-xs text-ink font-medium cursor-pointer hover:underline">
              ✏️ Edit Delivery Address
            </summary>
            <form action={updateAddressWithId} className="mt-3 space-y-2">
              <div>
                <label className="block text-[11px] text-stone-dark">Address Line 1</label>
                <input
                  name="line1"
                  defaultValue={address.line1 || address.addressLine1 || address.street || ""}
                  required
                  className="w-full px-2.5 py-1.5 border border-stone text-xs rounded-sm bg-paper"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-dark">Address Line 2 (Optional)</label>
                <input
                  name="line2"
                  defaultValue={address.line2 || address.addressLine2 || ""}
                  className="w-full px-2.5 py-1.5 border border-stone text-xs rounded-sm bg-paper"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-stone-dark">City</label>
                  <input
                    name="city"
                    defaultValue={address.city || ""}
                    required
                    className="w-full px-2.5 py-1.5 border border-stone text-xs rounded-sm bg-paper"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-stone-dark">State</label>
                  <input
                    name="state"
                    defaultValue={address.state || ""}
                    required
                    className="w-full px-2.5 py-1.5 border border-stone text-xs rounded-sm bg-paper"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-stone-dark">Pincode</label>
                  <input
                    name="pincode"
                    defaultValue={address.pincode || address.postalCode || ""}
                    required
                    pattern="\d{6}"
                    className="w-full px-2.5 py-1.5 border border-stone text-xs rounded-sm bg-paper"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="mt-2 px-3 py-1.5 bg-ink text-paper text-xs font-medium uppercase tracking-[0.04em] rounded-sm hover:opacity-90"
              >
                Save Updated Address
              </button>
            </form>
          </details>
        )}
      </div>

      {/* Payment / Reference Info */}
      {order.razorpayPaymentId && (
        <p className="text-[12px] text-stone-dark font-mono bg-paper p-3 border border-stone">
          Razorpay payment: {order.razorpayPaymentId}
        </p>
      )}

      {/* Fulfillment Actions Section */}
      <div className="border border-stone bg-white p-6 rounded-sm space-y-6">
        <h2 className="text-sm font-semibold text-ink">Shipping Fulfillment</h2>

        {/* Existing Shipment Info if Shipped */}
        {order.courierName && (
          <div className="p-4 bg-paper border border-stone text-[13px] space-y-1">
            <p><strong>Courier:</strong> {order.courierName}</p>
            <p><strong>AWB / Tracking Number:</strong> <span className="font-mono">{order.awbNumber}</span></p>
            {order.trackingUrl && (
              <p>
                <strong>Tracking Link:</strong>{" "}
                <a href={order.trackingUrl} target="_blank" className="underline text-ink">
                  {order.trackingUrl}
                </a>
              </p>
            )}
            {order.shippedAt && (
              <p className="text-xs text-stone-dark pt-1">
                Shipped on: {new Date(order.shippedAt).toLocaleString("en-IN")}
              </p>
            )}
            {order.deliveredAt && (
              <p className="text-xs text-emerald-700 font-medium">
                Delivered on: {new Date(order.deliveredAt).toLocaleString("en-IN")}
              </p>
            )}
          </div>
        )}

        {/* Form to Mark Shipped */}
        {order.status !== "SHIPPED" && order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const courierName = formData.get("courierName") as string;
              const awbNumber = formData.get("awbNumber") as string;
              const trackingUrl = formData.get("trackingUrl") as string;
              const note = formData.get("note") as string;

              await markOrderShipped(order.id, { courierName, awbNumber, trackingUrl, note });
            }}
            className="space-y-3 pt-2 border-t border-stone/50"
          >
            <p className="text-xs font-medium text-stone-dark">Dispatch & Mark as Shipped</p>
            <div className="grid grid-cols-2 gap-3">
              <input
                name="courierName"
                type="text"
                required
                placeholder="Courier Partner (e.g. Delhivery, Bluedart)"
                className="px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
              />
              <input
                name="awbNumber"
                type="text"
                required
                placeholder="AWB / Tracking Number"
                className="px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
              />
            </div>
            <input
              name="trackingUrl"
              type="url"
              placeholder="Public Tracking URL (optional)"
              className="w-full px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
            />
            <input
              name="note"
              type="text"
              placeholder="Note / Remark (optional)"
              className="w-full px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
            />
            <button type="submit" className="px-5 py-2.5 bg-ink text-paper text-[12.5px] font-medium tracking-[0.04em]">
              MARK AS SHIPPED & SEND EMAIL
            </button>
          </form>
        )}

        {/* Form to Mark Delivered */}
        {order.status === "SHIPPED" && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const note = formData.get("note") as string;
              await markOrderDelivered(order.id, note);
            }}
            className="space-y-3 pt-2 border-t border-stone/50"
          >
            <p className="text-xs font-medium text-stone-dark">Confirm Delivery</p>
            {order.paymentMethod === "COD" && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-xs text-amber-900 rounded-sm font-medium flex items-center gap-2">
                <span>💵</span>
                <span>
                  <strong>Cash Collection Required:</strong> Please confirm that <strong>{formatINR(order.total)}</strong> cash has been collected upon delivery.
                </span>
              </div>
            )}
            <input
              name="note"
              type="text"
              placeholder={order.paymentMethod === "COD" ? "Delivery & cash collection note (e.g. ₹" + (order.total/100) + " cash collected on delivery)" : "Delivery note (e.g. Delivered to customer at front door)"}
              className="w-full px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
            />
            <button type="submit" className="px-5 py-2.5 bg-emerald-800 text-paper text-[12.5px] font-medium tracking-[0.04em]">
              {order.paymentMethod === "COD" ? "CONFIRM CASH COLLECTED & MARK DELIVERED" : "MARK AS DELIVERED"}
            </button>
          </form>
        )}

        {/* Form to Mark COD Refused / RTO */}
        {order.paymentMethod === "COD" && (order.status === "SHIPPED" || order.status === "PENDING") && (
          <form
            action={async (formData: FormData) => {
              "use server";
              const { markCodRefused } = await import("@/lib/actions/cod-refusal");
              const note = formData.get("note") as string;
              await markCodRefused(order.id, note);
            }}
            className="space-y-3 pt-4 border-t border-red-200 bg-red-50/50 p-4 rounded-sm"
          >
            <div>
              <p className="text-xs font-semibold text-clay uppercase tracking-wider">COD Delivery Refusal / Return to Origin (RTO)</p>
              <p className="text-[11px] text-stone-dark">Mark order as cancelled, restock item inventory, and record refusal event.</p>
            </div>
            <input
              name="note"
              type="text"
              placeholder="Refusal note (e.g. Customer rejected package at doorstep / Unreachable)"
              className="w-full px-3.5 py-2 border border-stone text-[13px] bg-white rounded-sm focus:outline-none focus:border-ink"
            />
            <button type="submit" className="px-4 py-2 bg-clay text-white text-[12.5px] font-medium rounded-sm hover:bg-opacity-90">
              MARK AS COD REFUSED / RTO (RESTOCK INVENTORY)
            </button>
          </form>
        )}
      </div>

      {/* Manual Status Override */}
      <div className="border border-stone bg-white p-5 rounded-sm">
        <p className="text-xs font-medium text-stone-dark mb-3">Manual Status Override</p>
        {availableStatuses.length > 0 ? (
          <form action={updateWithId} className="flex gap-3 items-center">
            <select name="status" className="px-3.5 py-2 border border-stone text-[13px] rounded-sm">
              {availableStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button type="submit" className="px-4 py-2 border border-stone text-[12.5px] font-medium hover:bg-paper">
              Update Status
            </button>
          </form>
        ) : (
          <p className="text-[12.5px] text-stone-dark italic">No manual transitions available from current status ({order.status}).</p>
        )}
      </div>

      {/* Admin Order Cancellation & Razorpay Refund */}
      <div className="border border-stone bg-white p-5 rounded-sm space-y-3">
        <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Cancellation & Refund</h3>
        {order.status === "CANCELLED" ? (
          <div className="p-3.5 bg-red-50 border border-clay/30 rounded-sm text-xs space-y-1">
            <p className="font-semibold text-clay">Order Cancelled</p>
            {order.cancellationReason && <p className="text-stone-dark">Reason: {order.cancellationReason}</p>}
            {order.razorpayRefundId && (
              <p className="text-emerald-800 font-mono font-medium pt-1">
                Razorpay Refund ID: {order.razorpayRefundId} ({formatINR(order.refundAmount || order.total)})
              </p>
            )}
            {order.paymentMethod === "COD" && (
              <p className="text-amber-800 font-mono text-[11px] pt-1">
                (COD Order — No online refund was required)
              </p>
            )}
          </div>
        ) : (
          <form
            action={async (formData: FormData) => {
              "use server";
              const reason = formData.get("reason") as string;
              await cancelOrderAsAdmin(order.id, reason);
            }}
            className="space-y-3 pt-1"
          >
            <input
              name="reason"
              type="text"
              required
              placeholder="Reason for cancellation (e.g. Out of stock, customer requested)"
              className="w-full px-3.5 py-2 border border-stone text-[13px] rounded-sm focus:outline-none focus:border-ink"
            />
            <button type="submit" className="px-4 py-2 bg-clay text-white text-[12.5px] font-medium rounded-sm">
              CANCEL ORDER {order.paymentMethod !== "COD" && order.status === "PAID" ? "& TRIGGER RAZORPAY REFUND" : ""}
            </button>
          </form>
        )}
      </div>

      {/* Status History / Timeline Events */}
      {order.statusEvents.length > 0 && (
        <div className="border border-stone bg-white p-5 rounded-sm">
          <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider mb-4">Tracking History</h3>
          <div className="space-y-3">
            {order.statusEvents.map((evt) => (
              <div key={evt.id} className="flex items-start justify-between text-[13px] pb-3 border-b border-stone/30 last:border-0">
                <div>
                  <span className="font-semibold text-ink">{evt.status}</span>
                  {evt.note && <p className="text-xs text-stone-dark mt-0.5">{evt.note}</p>}
                </div>
                <span className="text-[11px] text-stone-dark shrink-0">
                  {new Date(evt.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Internal Staff Notes (Private / Staff Only) */}
      <div className="border border-stone bg-white p-5 rounded-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Internal Staff Notes (Private)</h3>
          <span className="text-[10px] bg-stone/40 text-stone-dark px-1.5 py-0.5 rounded font-mono">STAFF ONLY</span>
        </div>

        <form
          action={async (formData: FormData) => {
            "use server";
            const body = formData.get("body") as string;
            await addOrderNote(order.id, body);
          }}
          className="space-y-2"
        >
          <textarea
            name="body"
            required
            rows={2}
            placeholder="Add a private staff comment or internal note..."
            className="w-full px-3 py-2 border border-stone text-xs rounded-sm focus:outline-none focus:border-ink bg-paper/50"
          />
          <button type="submit" className="px-4 py-1.5 bg-ink text-paper text-xs font-medium rounded-sm">
            ADD INTERNAL NOTE
          </button>
        </form>

        <div className="space-y-3 pt-2">
          {order.notes.map((note) => (
            <div key={note.id} className="p-3 bg-paper border border-stone/40 text-xs rounded-sm space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-ink">{note.authorName}</span>
                <span className="text-stone-dark font-mono">
                  {new Date(note.createdAt).toLocaleString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="text-ink whitespace-pre-wrap">{note.body}</p>
            </div>
          ))}
          {order.notes.length === 0 && (
            <p className="text-xs text-stone-dark italic">No internal staff notes added yet.</p>
          )}
        </div>
      </div>
    </main>
  );
}
