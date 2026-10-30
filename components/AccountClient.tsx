"use client";

import { useState, useTransition } from "react";
import { updateProfile, saveAddress } from "@/lib/actions/account";
import { cancelOrderAsCustomer } from "@/lib/actions/cancellation";
import { requestReturn } from "@/lib/actions/returns";
import { requestOtpAction } from "@/lib/actions/otp";
import { linkIdentifierAction } from "@/lib/actions/account-linking";
import { signOutEverywhereAction } from "@/lib/actions/sessions";
import { formatINR } from "@/lib/money";
import { useCartStore } from "@/lib/cart-store";
import OrderStatusTimeline from "./OrderStatusTimeline";
import type { OrderStatus, ReturnStatus } from "@prisma/client";

interface AccountClientProps {
  user: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: Date | null;
    storeCreditBalance?: number;
    storeCreditTransactions?: Array<{
      id: string;
      amount: number;
      reason: string;
      relatedOrderId?: string | null;
      createdAt: Date;
    }>;
  };
  address: {
    id: string;
    street: string;
    city: string;
    state: string;
    pincode: string;
  } | null;
  orders: Array<{
    id: string;
    displayId: string;
    status: string;
    total: number;
    subtotal: number;
    shippingFee: number;
    storeCreditApplied?: number;
    courierName?: string | null;
    awbNumber?: string | null;
    trackingUrl?: string | null;
    createdAt: Date;
    statusEvents?: Array<{
      id: string;
      status: OrderStatus;
      note?: string | null;
      createdAt: Date;
    }>;
    returnRequests?: Array<{
      id: string;
      reason: string;
      status: ReturnStatus;
      adminNote?: string | null;
      createdAt: Date;
    }>;
    items: Array<{
      id: string;
      productId: string;
      variantId: string;
      name: string;
      size: string;
      unitPrice: number;
      qty: number;
      currentStock?: number;
    }>;
  }>;
}

export default function AccountClient({ user, address, orders }: AccountClientProps) {
  const { add: addCartItem, open: openCart } = useCartStore();

  const [name, setName] = useState(user.name || "");
  const [dateOfBirth, setDateOfBirth] = useState<string>(
    user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split("T")[0] : ""
  );

  const [street, setStreet] = useState(address?.street || "");
  const [city, setCity] = useState(address?.city || "");
  const [state, setState] = useState(address?.state || "");
  const [pincode, setPincode] = useState(address?.pincode || "");

  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [addressMsg, setAddressMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [isPendingProfile, startProfileTransition] = useTransition();
  const [isPendingAddress, startAddressTransition] = useTransition();

  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelErrorMsg, setCancelErrorMsg] = useState<string | null>(null);
  const [isPendingCancel, startCancelTransition] = useTransition();

  function handleCancelSubmit(orderId: string) {
    setCancelErrorMsg(null);
    startCancelTransition(async () => {
      try {
        await cancelOrderAsCustomer(orderId, cancelReason);
        setCancellingOrderId(null);
        setCancelReason("");
      } catch (err) {
        setCancelErrorMsg(err instanceof Error ? err.message : "Failed to cancel order");
      }
    });
  }

  const [returningOrderId, setReturningOrderId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("ALL");

  const filteredOrders = orders.filter((o) => {
    const matchesStatus = orderStatusFilter === "ALL" || o.status === orderStatusFilter;
    const q = orderSearchQuery.toLowerCase().trim();
    const matchesQuery =
      !q ||
      o.displayId.toLowerCase().includes(q) ||
      o.items.some((item) => item.name.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const [returnErrorMsg, setReturnErrorMsg] = useState<string | null>(null);
  const [isPendingReturn, startReturnTransition] = useTransition();

  function handleReorder(items: Array<{ productId: string; variantId: string; name: string; size: string; unitPrice: number; qty: number; currentStock?: number }>) {
    const warnings: string[] = [];
    let addedCount = 0;

    items.forEach((item) => {
      const stock = item.currentStock ?? 99;
      if (stock <= 0) {
        warnings.push(`Skipped "${item.name}" (Size ${item.size}) — currently out of stock.`);
        return;
      }

      const availableQty = Math.min(item.qty, stock);
      if (availableQty < item.qty) {
        warnings.push(`Added "${item.name}" (Size ${item.size}) with available stock of ${availableQty} (requested ${item.qty}).`);
      }

      addCartItem({
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        size: item.size,
        unitPrice: item.unitPrice,
        qty: availableQty,
      });
      addedCount++;
    });

    if (warnings.length > 0) {
      alert(warnings.join("\n"));
    }
    if (addedCount > 0) {
      openCart();
    }
  }

  function handleReturnSubmit(orderId: string) {
    setReturnErrorMsg(null);
    startReturnTransition(async () => {
      try {
        await requestReturn(orderId, returnReason);
        setReturningOrderId(null);
        setReturnReason("");
      } catch (err) {
        setReturnErrorMsg(err instanceof Error ? err.message : "Failed to submit return request");
      }
    });
  }

  function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileMsg(null);
    const formData = new FormData(e.currentTarget);
    startProfileTransition(async () => {
      try {
        await updateProfile(formData);
        setProfileMsg({ type: "success", text: "Profile updated successfully." });
      } catch (err) {
        setProfileMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to update profile" });
      }
    });
  }

  function handleAddressSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddressMsg(null);
    const formData = new FormData(e.currentTarget);
    startAddressTransition(async () => {
      try {
        await saveAddress(formData);
        setAddressMsg({ type: "success", text: "Shipping address saved successfully." });
      } catch (err) {
        setAddressMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to save address" });
      }
    });
  }

  return (
    <div className="space-y-10">
      {/* Store Credit Balance & Voucher Ledger */}
      <section className="border border-emerald-300 bg-emerald-50/40 p-6 rounded-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-emerald-950 flex items-center gap-2">
              <span>💳 Store Credit Balance</span>
            </h2>
            <p className="text-xs text-emerald-800">
              Usable on all future orders. Automatically debits at checkout.
            </p>
          </div>
          <div className="text-right">
            <span className="font-mono text-2xl font-bold text-emerald-900 block">
              {formatINR(user.storeCreditBalance || 0)}
            </span>
          </div>
        </div>

        {user.storeCreditTransactions && user.storeCreditTransactions.length > 0 && (
          <div className="pt-3 border-t border-emerald-200 space-y-2">
            <p className="text-xs font-semibold text-emerald-900 uppercase tracking-wider">Transaction Ledger</p>
            <div className="divide-y divide-emerald-200/60 bg-white border border-emerald-200 rounded-sm">
              {user.storeCreditTransactions.map((tx) => (
                <div key={tx.id} className="p-3 flex justify-between items-center text-xs">
                  <div>
                    <p className="font-medium text-ink">{tx.reason}</p>
                    <p className="text-[11px] text-stone-dark font-mono">
                      {new Date(tx.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <span
                    className={`font-mono font-semibold ${
                      tx.amount > 0 ? "text-emerald-700" : "text-clay"
                    }`}
                  >
                    {tx.amount > 0 ? `+${formatINR(tx.amount)}` : formatINR(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Profile Details */}
      <section className="border border-stone p-6 bg-white rounded-sm">
        <h2 className="text-base font-semibold mb-4 text-ink">Personal Profile</h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Email</label>
            <input
              type="email"
              value={user.email || ""}
              placeholder="No email linked"
              disabled
              className="w-full px-3.5 py-2.5 border border-stone bg-paper text-[13.5px] text-stone-dark cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Full Name</label>
            <input
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Phone Number</label>
            <input
              type="tel"
              value={user.phone || ""}
              placeholder="No phone linked"
              disabled
              className="w-full px-3.5 py-2.5 border border-stone bg-paper text-[13.5px] text-stone-dark cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Date of Birth (Optional)</label>
            <p className="text-[11px] text-stone-dark mb-1">We send an exclusive discount coupon on your birthday!</p>
            <input
              name="dateOfBirth"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
            />
          </div>

          {profileMsg && (
            <p className={`text-xs ${profileMsg.type === "success" ? "text-moss" : "text-clay"}`}>
              {profileMsg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={isPendingProfile}
            className="px-5 py-2.5 bg-ink text-paper text-[12.5px] font-medium tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPendingProfile ? "SAVING..." : "SAVE PROFILE"}
          </button>
        </form>
      </section>

      {/* Account Linking & Verification */}
      <LinkedContactMethods user={user} />

      {/* Account Security & Sessions */}
      <section className="border border-stone p-6 bg-white rounded-sm space-y-3">
        <h2 className="text-base font-semibold text-ink">Account Security</h2>
        <p className="text-xs text-stone-dark">
          Sign out of all active sessions across phones, tablets, and computers.
        </p>
        <button
          type="button"
          onClick={async () => {
            if (confirm("Are you sure you want to sign out of all devices? This will invalidate all your active sessions.")) {
              await signOutEverywhereAction();
              window.location.href = "/login";
            }
          }}
          className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-xs font-semibold rounded-xs hover:bg-red-100 transition-colors"
        >
          Sign out of all devices
        </button>
      </section>

      {/* Default Shipping Address */}
      <section className="border border-stone p-6 bg-white rounded-sm">
        <h2 className="text-base font-semibold mb-4 text-ink">Default Shipping Address</h2>
        <form onSubmit={handleAddressSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Street Address</label>
            <input
              name="street"
              type="text"
              required
              placeholder="123 Main Street, Apt 4B"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-stone-dark mb-1">City</label>
              <input
                name="city"
                type="text"
                required
                placeholder="Mumbai"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-stone-dark mb-1">State</label>
              <input
                name="state"
                type="text"
                required
                placeholder="Maharashtra"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
              />
            </div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-stone-dark mb-1">Pincode</label>
            <input
              name="pincode"
              type="text"
              required
              placeholder="400001"
              value={pincode}
              onChange={(e) => setPincode(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-stone bg-white text-[13.5px] focus:outline-none focus:border-ink"
            />
          </div>

          {addressMsg && (
            <p className={`text-xs ${addressMsg.type === "success" ? "text-moss" : "text-clay"}`}>
              {addressMsg.text}
            </p>
          )}

          <button
            type="submit"
            disabled={isPendingAddress}
            className="px-5 py-2.5 bg-ink text-paper text-[12.5px] font-medium tracking-[0.04em] hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isPendingAddress ? "SAVING..." : "SAVE ADDRESS"}
          </button>
        </form>
      </section>

      {/* Order History */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-ink">Order History</h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search order ID or item..."
              value={orderSearchQuery}
              onChange={(e) => setOrderSearchQuery(e.target.value)}
              className="px-3 py-1 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
            />
            <select
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value)}
              className="px-2.5 py-1 text-xs border border-stone bg-white rounded-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PAID">Paid</option>
              <option value="SHIPPED">Shipped</option>
              <option value="DELIVERED">Delivered</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>

        <div className="border border-stone bg-white rounded-sm divide-y divide-stone">
          {filteredOrders.map((o) => {
            const isExpanded = expandedOrderId === o.id;
            return (
              <div key={o.id} className="p-4">
                <div
                  onClick={() => setExpandedOrderId(isExpanded ? null : o.id)}
                  className="flex items-center justify-between cursor-pointer hover:bg-paper -mx-4 -my-4 p-4 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <span className="font-mono font-medium text-[13.5px] text-ink">#{o.displayId}</span>
                    <span className="text-xs text-stone-dark">
                      {new Date(o.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        o.status === "PAID"
                          ? "bg-emerald-100 text-emerald-800"
                          : o.status === "SHIPPED" || o.status === "DELIVERED"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {o.status}
                    </span>
                    <span className="font-mono font-medium text-[13.5px]">{formatINR(o.total)}</span>
                    <span className="text-xs text-stone-dark">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                {/* Itemized Order Details & Tracking */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-stone space-y-5">
                    {/* Visual Tracking Timeline */}
                    <div className="p-4 bg-paper/60 border border-stone/50 rounded-sm">
                      <p className="text-xs font-semibold text-stone-dark uppercase tracking-wider mb-3">
                        Delivery Status
                      </p>
                      <OrderStatusTimeline
                        currentStatus={o.status as OrderStatus}
                        events={o.statusEvents}
                        courierName={o.courierName}
                        awbNumber={o.awbNumber}
                        trackingUrl={o.trackingUrl}
                      />
                    </div>

                    <p className="text-xs font-semibold text-stone-dark uppercase tracking-wider">
                      Order Items
                    </p>
                    <div className="divide-y divide-stone/40 border border-stone/40 rounded bg-paper">
                      {o.items.map((item) => (
                        <div key={item.id} className="flex justify-between p-3 text-[13px]">
                          <div>
                            <p className="font-medium text-ink">{item.name}</p>
                            <p className="text-xs text-stone-dark">Size: {item.size} • Qty: {item.qty}</p>
                          </div>
                          <p className="font-mono font-medium text-ink">{formatINR(item.unitPrice * item.qty)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-stone/40 text-xs">
                      <div className="flex items-center gap-3">
                        <a
                          href={`/api/orders/${o.id}/invoice`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-ink underline hover:text-moss"
                        >
                          📄 Download Invoice
                        </a>
                        <button
                          type="button"
                          onClick={() => handleReorder(o.items)}
                          className="inline-flex items-center gap-1 font-medium text-moss hover:underline"
                        >
                          🔁 Reorder Items
                        </button>
                      </div>
                      <div className="text-right text-stone-dark space-y-0.5">
                        <p>Subtotal: {formatINR(o.subtotal)}</p>
                        <p>Shipping: {o.shippingFee === 0 ? "FREE" : formatINR(o.shippingFee)}</p>
                        {!!o.storeCreditApplied && o.storeCreditApplied > 0 && (
                          <p className="text-emerald-700 font-medium">Store Credit: -{formatINR(o.storeCreditApplied)}</p>
                        )}
                        <p className="font-semibold text-ink text-sm">
                          {!!o.storeCreditApplied && o.storeCreditApplied > 0 ? "Remaining Paid: " : "Total: "}
                          {formatINR(Math.max(0, o.total - (o.storeCreditApplied || 0)))}
                        </p>
                      </div>
                    </div>

                    {/* Order Cancellation Control */}
                    {(o.status === "PENDING" || o.status === "PAID") && (
                      <div className="pt-3 border-t border-stone/50">
                        {cancellingOrderId === o.id ? (
                          <div className="p-4 bg-red-50 border border-clay/30 rounded-sm space-y-3">
                            <p className="text-xs font-semibold text-clay uppercase tracking-wider">
                              Confirm Order Cancellation {o.status === "PAID" ? "(Instant Razorpay Refund)" : ""}
                            </p>
                            <input
                              type="text"
                              placeholder="Reason for cancellation (e.g. Ordered by mistake, wrong size)"
                              value={cancelReason}
                              onChange={(e) => setCancelReason(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
                            />
                            {cancelErrorMsg && <p className="text-xs text-clay">{cancelErrorMsg}</p>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={isPendingCancel}
                                onClick={() => handleCancelSubmit(o.id)}
                                className="px-4 py-2 bg-clay text-white text-xs font-medium rounded-sm disabled:opacity-50"
                              >
                                {isPendingCancel ? "PROCESSING..." : "CONFIRM CANCEL"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingOrderId(null);
                                  setCancelErrorMsg(null);
                                }}
                                className="px-3 py-2 text-xs text-stone-dark hover:text-ink"
                              >
                                Keep Order
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setCancellingOrderId(o.id);
                              setCancelReason("");
                              setCancelErrorMsg(null);
                            }}
                            className="text-xs text-clay hover:underline font-medium"
                          >
                            Cancel Order {o.status === "PAID" ? "& Request Refund" : ""}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Return Request Control for Delivered Orders */}
                    {o.status === "DELIVERED" && (
                      <div className="pt-3 border-t border-stone/50">
                        {o.returnRequests && o.returnRequests.length > 0 ? (
                          <div className="p-3 bg-paper border border-stone rounded-sm text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-ink">Return Status:</span>
                              <span className="font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-800 uppercase">
                                {o.returnRequests[0].status}
                              </span>
                            </div>
                            <p className="text-stone-dark">Reason: {o.returnRequests[0].reason}</p>
                            {o.returnRequests[0].adminNote && (
                              <p className="text-stone-dark">Note: {o.returnRequests[0].adminNote}</p>
                            )}
                          </div>
                        ) : returningOrderId === o.id ? (
                          <div className="p-4 bg-amber-50 border border-amber-300 rounded-sm space-y-3">
                            <p className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                              Request Return & Refund
                            </p>
                            <input
                              type="text"
                              required
                              placeholder="Reason for return (e.g. Size didn't fit, defective material)"
                              value={returnReason}
                              onChange={(e) => setReturnReason(e.target.value)}
                              className="w-full px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
                            />
                            {returnErrorMsg && <p className="text-xs text-clay">{returnErrorMsg}</p>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={isPendingReturn}
                                onClick={() => handleReturnSubmit(o.id)}
                                className="px-4 py-2 bg-ink text-white text-xs font-medium rounded-sm disabled:opacity-50"
                              >
                                {isPendingReturn ? "SUBMITTING..." : "SUBMIT RETURN REQUEST"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReturningOrderId(null);
                                  setReturnErrorMsg(null);
                                }}
                                className="px-3 py-2 text-xs text-stone-dark hover:text-ink"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReturningOrderId(o.id);
                              setReturnReason("");
                              setReturnErrorMsg(null);
                            }}
                            className="text-xs font-medium text-moss hover:underline"
                          >
                            Request Return / Refund
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {orders.length === 0 && <p className="p-6 text-sm text-stone-dark text-center">No orders placed yet.</p>}
        </div>
      </section>
    </div>
  );
}

function LinkedContactMethods({ user }: { user: { email?: string | null; phone?: string | null } }) {
  const [activeChannel, setActiveChannel] = useState<"PHONE" | "EMAIL" | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [step, setStep] = useState<"INPUT" | "OTP">("INPUT");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startLinking(channel: "PHONE" | "EMAIL") {
    setActiveChannel(channel);
    setInputVal("");
    setOtpCode("");
    setStep("INPUT");
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!inputVal.trim()) return;

    startTransition(async () => {
      const res = await requestOtpAction(inputVal, activeChannel!);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to send verification code");
      } else {
        setStep("OTP");
      }
    });
  }

  function handleVerifyAndLink(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setErrorMsg("Please enter 6-digit verification code");
      return;
    }

    startTransition(async () => {
      const res = await linkIdentifierAction(inputVal, otpCode, activeChannel!);
      if (!res.success) {
        setErrorMsg(res.error || "Failed to link identifier");
      } else {
        setSuccessMsg(`Successfully linked ${activeChannel === "PHONE" ? "phone number" : "email address"}.`);
        setActiveChannel(null);
      }
    });
  }

  return (
    <section className="border border-stone p-6 bg-white rounded-sm space-y-4">
      <h2 className="text-base font-semibold text-ink">Linked Contact Methods</h2>
      <p className="text-xs text-stone-dark">
        Attach both a phone number and an email address to your account for fast multi-channel OTP sign in.
      </p>

      {successMsg && <p className="text-xs font-medium text-moss">{successMsg}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Phone Number Linking Status */}
        <div className="p-4 border border-stone/60 bg-paper/50 rounded-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Mobile Phone</span>
            {user.phone ? (
              <span className="text-xs font-medium text-moss bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-xs">
                ✓ Linked
              </span>
            ) : (
              <span className="text-xs font-medium text-clay bg-red-50 border border-red-200 px-2 py-0.5 rounded-xs">
                Not Linked
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-ink font-medium">
            {user.phone || "No phone number linked to account"}
          </p>
          {!user.phone && activeChannel !== "PHONE" && (
            <button
              type="button"
              onClick={() => startLinking("PHONE")}
              className="text-xs text-ink font-medium underline hover:text-stone-dark pt-1 block"
            >
              + Link & Verify Phone Number
            </button>
          )}
        </div>

        {/* Email Address Linking Status */}
        <div className="p-4 border border-stone/60 bg-paper/50 rounded-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Email Address</span>
            {user.email ? (
              <span className="text-xs font-medium text-moss bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-xs">
                ✓ Linked
              </span>
            ) : (
              <span className="text-xs font-medium text-clay bg-red-50 border border-red-200 px-2 py-0.5 rounded-xs">
                Not Linked
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-ink font-medium">
            {user.email || "No email address linked to account"}
          </p>
          {!user.email && activeChannel !== "EMAIL" && (
            <button
              type="button"
              onClick={() => startLinking("EMAIL")}
              className="text-xs text-ink font-medium underline hover:text-stone-dark pt-1 block"
            >
              + Link & Verify Email Address
            </button>
          )}
        </div>
      </div>

      {/* Linking Modal Form */}
      {activeChannel && (
        <div className="mt-4 p-4 border border-stone bg-paper rounded-sm space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">
              Link {activeChannel === "PHONE" ? "Phone Number" : "Email Address"}
            </h3>
            <button
              type="button"
              onClick={() => setActiveChannel(null)}
              className="text-xs text-stone-dark hover:text-ink"
            >
              Cancel
            </button>
          </div>

          {step === "INPUT" ? (
            <form onSubmit={handleSendOtp} className="space-y-3">
              <input
                type={activeChannel === "PHONE" ? "tel" : "email"}
                required
                placeholder={activeChannel === "PHONE" ? "Enter phone number (e.g. +91 98765 43210)" : "Enter email address"}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
              />
              {errorMsg && <p className="text-xs text-clay">{errorMsg}</p>}
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-ink text-paper text-xs font-medium rounded-sm disabled:opacity-50"
              >
                {isPending ? "SENDING CODE..." : "SEND VERIFICATION CODE"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyAndLink} className="space-y-3">
              <p className="text-xs text-stone-dark">
                Enter the 6-digit code sent to <span className="font-mono text-ink">{inputVal}</span>:
              </p>
              <input
                type="text"
                maxLength={6}
                required
                placeholder="6-digit code"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-2 text-xs border border-stone bg-white font-mono text-center tracking-widest rounded-sm focus:outline-none focus:border-ink"
              />
              {errorMsg && <p className="text-xs text-clay">{errorMsg}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-ink text-paper text-xs font-medium rounded-sm disabled:opacity-50"
                >
                  {isPending ? "VERIFYING..." : "VERIFY & LINK TO ACCOUNT"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("INPUT")}
                  className="px-3 py-2 text-xs text-stone-dark hover:text-ink"
                >
                  Back
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
