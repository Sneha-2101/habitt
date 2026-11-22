"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateProfile,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "@/lib/actions/account";
import { INDIAN_STATES } from "@/lib/validation/address";
import { cancelOrderAsCustomer } from "@/lib/actions/cancellation";
import { requestReturn, cancelReturn } from "@/lib/actions/returns";
import { requestStepUpAction, confirmStepUpAction } from "@/lib/actions/step-up";
import { requestContactChangeAction, confirmContactChangeAction } from "@/lib/actions/contact";
import { signOutEverywhereAction } from "@/lib/actions/sessions";
import { formatINR } from "@/lib/money";
import { useCartStore } from "@/lib/cart-store";
import OrderStatusTimeline from "./OrderStatusTimeline";
import type { ReturnStatus } from "@prisma/client";

export interface AddressItem {
  id: string;
  fullName: string;
  phone: string;
  street: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  label: string;
  isDefault: boolean;
}

interface AccountClientProps {
  user: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    dateOfBirth?: Date | null;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
    storeCreditBalance?: number;
    storeCreditTransactions?: Array<{
      id: string;
      amount: number;
      reason: string;
      relatedOrderId?: string | null;
      createdAt: Date;
    }>;
  };
  addresses?: AddressItem[];
  address?: AddressItem | null;
  orders: Array<{
    id: string;
    displayId: string;
    status: string;
    statusLabel?: string;
    hasInvoice?: boolean;
    hasCreditNote?: boolean;
    paymentStatus?: string;
    fulfilmentStatus?: string;
    paymentMethod?: string;
    total: number;
    subtotal: number;
    shippingFee: number;
    storeCreditApplied?: number;
    courierName?: string | null;
    awbNumber?: string | null;
    trackingUrl?: string | null;
    shipment?: {
      status: string;
      courierName?: string | null;
      awb?: string | null;
      trackingUrl?: string | null;
      events?: Array<{
        id: string;
        status: string;
        rawStatus?: string | null;
        location?: string | null;
        occurredAt: Date;
      }>;
    } | null;
    createdAt: Date;
    statusEvents?: Array<{
      id: string;
      status?: string | null;
      fulfilmentStatus?: string | null;
      paymentStatus?: string | null;
      note?: string | null;
      createdAt: Date;
    }>;
    isReturnWindowOpen?: boolean;
    returnRequests?: Array<{
      id: string;
      reason: string;
      reasonCode?: string;
      status: ReturnStatus;
      adminNote?: string | null;
      customerNote?: string | null;
      createdAt: Date;
      items?: Array<{
        id: string;
        orderItemId: string;
        qty: number;
      }>;
    }>;
    items: Array<{
      id: string;
      productId: string;
      variantId: string;
      name: string;
      size: string;
      color?: string;
      unitPrice: number;
      qty: number;
      currentStock?: number;
      isGift?: boolean;
      remainingReturnable?: number;
    }>;
  }>;
}

export default function AccountClient({
  user,
  addresses: initialAddresses = [],
  address,
  orders,
}: AccountClientProps) {
  const router = useRouter();
  const { add: addCartItem, open: openCart } = useCartStore();

  const [name, setName] = useState(user.name || "");
  const [dateOfBirth, setDateOfBirth] = useState<string>(
    user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split("T")[0] : ""
  );

  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPendingProfile, startProfileTransition] = useTransition();

  // Address state
  const fallbackList = address ? [address] : [];
  const allAddresses = initialAddresses.length > 0 ? initialAddresses : fallbackList;
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressMsg, setAddressMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPendingAddress, startAddressTransition] = useTransition();

  // Form fields
  const [addrFullName, setAddrFullName] = useState("");
  const [addrPhone, setAddrPhone] = useState("");
  const [addrLine1, setAddrLine1] = useState("");
  const [addrLine2, setAddrLine2] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState<string>(INDIAN_STATES[0]);
  const [addrPincode, setAddrPincode] = useState("");
  const [addrLabel, setAddrLabel] = useState<"Home" | "Work" | "Other">("Home");
  const [addrIsDefault, setAddrIsDefault] = useState(false);

  function resetAddressForm() {
    setAddrFullName("");
    setAddrPhone("");
    setAddrLine1("");
    setAddrLine2("");
    setAddrCity("");
    setAddrState(INDIAN_STATES[0]);
    setAddrPincode("");
    setAddrLabel("Home");
    setAddrIsDefault(false);
    setIsAddingAddress(false);
    setEditingAddressId(null);
  }

  function startEditAddress(addr: AddressItem) {
    setAddrFullName(addr.fullName || "");
    setAddrPhone(addr.phone || "");
    setAddrLine1(addr.street || "");
    setAddrLine2(addr.line2 || "");
    setAddrCity(addr.city || "");
    setAddrState(addr.state || INDIAN_STATES[0]);
    setAddrPincode(addr.pincode || "");
    setAddrLabel((addr.label as "Home" | "Work" | "Other") || "Home");
    setAddrIsDefault(addr.isDefault || false);
    setEditingAddressId(addr.id);
    setIsAddingAddress(false);
    setAddressMsg(null);
  }

  function handleSaveAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddressMsg(null);
    startAddressTransition(async () => {
      try {
        const payload = {
          fullName: addrFullName,
          phone: addrPhone,
          line1: addrLine1,
          line2: addrLine2 || null,
          city: addrCity,
          state: addrState,
          pincode: addrPincode,
          label: addrLabel,
          isDefault: addrIsDefault,
        };
        if (editingAddressId) {
          await updateAddress(editingAddressId, payload);
          setAddressMsg({ type: "success", text: "Address updated successfully." });
        } else {
          await createAddress(payload);
          setAddressMsg({ type: "success", text: "Address added successfully." });
        }
        resetAddressForm();
        router.refresh();
      } catch (err) {
        setAddressMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to save address" });
      }
    });
  }

  function handleDeleteAddress(id: string) {
    if (!confirm("Are you sure you want to delete this address?")) return;
    setAddressMsg(null);
    startAddressTransition(async () => {
      try {
        await deleteAddress(id);
        setAddressMsg({ type: "success", text: "Address deleted successfully." });
        router.refresh();
      } catch (err) {
        setAddressMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to delete address" });
      }
    });
  }

  function handleSetDefaultAddress(id: string) {
    setAddressMsg(null);
    startAddressTransition(async () => {
      try {
        await setDefaultAddress(id);
        setAddressMsg({ type: "success", text: "Default address updated." });
        router.refresh();
      } catch (err) {
        setAddressMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to set default address" });
      }
    });
  }

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
  const [returningItemQtys, setReturningItemQtys] = useState<Record<string, number>>({});
  const [returnReasonCode, setReturnReasonCode] = useState<
    "WRONG_SIZE" | "DEFECTIVE" | "NOT_AS_DESCRIBED" | "CHANGED_MIND" | "OTHER"
  >("WRONG_SIZE");
  const [returnCustomerNote, setReturnCustomerNote] = useState("");
  const [cancellingReturnId, setCancellingReturnId] = useState<string | null>(null);
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

  function handleReorder(items: Array<{ productId: string; variantId: string; name: string; size: string; color?: string; unitPrice: number; qty: number; currentStock?: number }>) {
    const warnings: string[] = [];
    let addedCount = 0;

    items.forEach((item) => {
      const stock = item.currentStock ?? 99;
      if (stock <= 0) {
        warnings.push(`Skipped "${item.name}" (Size ${item.size}${item.color ? ` · ${item.color}` : ""}) — currently out of stock.`);
        return;
      }

      const availableQty = Math.min(item.qty, stock);
      if (availableQty < item.qty) {
        warnings.push(`Added "${item.name}" (Size ${item.size}${item.color ? ` · ${item.color}` : ""}) with available stock of ${availableQty} (requested ${item.qty}).`);
      }

      addCartItem({
        productId: item.productId,
        variantId: item.variantId,
        name: item.name,
        size: item.size,
        color: item.color || undefined,
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
    const itemsToReturn = Object.entries(returningItemQtys)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, qty]) => ({ orderItemId, qty }));

    if (itemsToReturn.length === 0) {
      setReturnErrorMsg("Please select at least one item to return.");
      return;
    }

    startReturnTransition(async () => {
      try {
        await requestReturn({
          orderId,
          items: itemsToReturn,
          reasonCode: returnReasonCode,
          note: returnCustomerNote,
        });
        setReturningOrderId(null);
        setReturningItemQtys({});
        setReturnCustomerNote("");
        router.refresh();
      } catch (err) {
        setReturnErrorMsg(err instanceof Error ? err.message : "Failed to submit return request");
      }
    });
  }

  function handleCancelReturn(returnId: string) {
    setReturnErrorMsg(null);
    setCancellingReturnId(returnId);
    startReturnTransition(async () => {
      try {
        await cancelReturn(returnId);
        setCancellingReturnId(null);
        router.refresh();
      } catch (err) {
        setReturnErrorMsg(err instanceof Error ? err.message : "Failed to cancel return");
        setCancellingReturnId(null);
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

      {/* Contact Details Card */}
      <ContactDetailsCard user={user} />

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
              useCartStore.getState().clear();
              useCartStore.getState().setOwner(null);
              await signOutEverywhereAction();
              window.location.href = "/login";
            }
          }}
          className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-xs font-semibold rounded-xs hover:bg-red-100 transition-colors"
        >
          Sign out of all devices
        </button>
      </section>

      {/* Shipping Addresses Section */}
      <section className="border border-stone p-6 bg-white rounded-none">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Shipping Addresses</h2>
            <p className="text-xs text-stone-dark">Manage your delivery addresses and default shipping location.</p>
          </div>
          {!isAddingAddress && !editingAddressId && allAddresses.length < 10 && (
            <button
              type="button"
              onClick={() => {
                resetAddressForm();
                setIsAddingAddress(true);
                setAddressMsg(null);
              }}
              className="min-h-[44px] px-4 py-2 bg-ink text-paper text-[12.5px] font-medium tracking-[0.04em] rounded-none hover:bg-opacity-90 transition-opacity"
            >
              Add Address
            </button>
          )}
        </div>

        {addressMsg && (
          <p className={`text-xs mb-4 ${addressMsg.type === "success" ? "text-moss" : "text-clay"}`}>
            {addressMsg.text}
          </p>
        )}

        {/* Address Form (Add or Edit) */}
        {(isAddingAddress || editingAddressId) && (
          <form onSubmit={handleSaveAddress} className="space-y-4 mb-6 p-4 border border-stone bg-paper rounded-none">
            <h3 className="text-sm font-semibold text-ink">
              {editingAddressId ? "Edit Address" : "Add New Address"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">Full Name</label>
                <input
                  name="fullName"
                  type="text"
                  required
                  placeholder="Receiver's name"
                  value={addrFullName}
                  onChange={(e) => setAddrFullName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">Phone</label>
                <input
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  required
                  placeholder="10-digit mobile number"
                  value={addrPhone}
                  onChange={(e) => setAddrPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-stone-dark mb-1">Address Line 1</label>
              <input
                name="line1"
                type="text"
                required
                placeholder="Street address, house/flat number"
                value={addrLine1}
                onChange={(e) => setAddrLine1(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-stone-dark mb-1">Address Line 2 (optional)</label>
              <input
                name="line2"
                type="text"
                placeholder="Apartment, suite, landmark, floor"
                value={addrLine2}
                onChange={(e) => setAddrLine2(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">City</label>
                <input
                  name="city"
                  type="text"
                  required
                  placeholder="City"
                  value={addrCity}
                  onChange={(e) => setAddrCity(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">State</label>
                <select
                  name="state"
                  required
                  value={addrState}
                  onChange={(e) => setAddrState(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                >
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">Pincode</label>
                <input
                  name="pincode"
                  type="text"
                  inputMode="numeric"
                  required
                  placeholder="6-digit pincode"
                  value={addrPincode}
                  onChange={(e) => setAddrPincode(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">Address Type</label>
                <select
                  name="label"
                  value={addrLabel}
                  onChange={(e) => setAddrLabel(e.target.value as "Home" | "Work" | "Other")}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                >
                  <option value="Home">Home</option>
                  <option value="Work">Work</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="flex items-center min-h-[44px] sm:pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-[13px] text-ink select-none">
                  <input
                    name="isDefault"
                    type="checkbox"
                    checked={addrIsDefault}
                    onChange={(e) => setAddrIsDefault(e.target.checked)}
                    className="h-4 w-4 rounded-none border border-stone accent-ink"
                  />
                  <span>Make default shipping address</span>
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isPendingAddress}
                className="min-h-[44px] px-5 py-2.5 bg-ink text-paper text-[12.5px] font-medium tracking-[0.04em] rounded-none hover:bg-opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isPendingAddress ? "SAVING..." : editingAddressId ? "UPDATE ADDRESS" : "SAVE ADDRESS"}
              </button>
              <button
                type="button"
                disabled={isPendingAddress}
                onClick={resetAddressForm}
                className="min-h-[44px] px-4 py-2.5 border border-stone text-ink text-[12.5px] font-medium rounded-none hover:bg-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Address Cards List */}
        {allAddresses.length === 0 ? (
          <p className="text-xs text-stone-dark py-4">No shipping addresses saved yet.</p>
        ) : (
          <div className="divide-y divide-stone border border-stone bg-white rounded-none">
            {allAddresses.map((addr) => (
              <div key={addr.id} className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{addr.fullName || "Unnamed"}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 border border-stone text-stone-dark">
                      {addr.label}
                    </span>
                    {addr.isDefault && (
                      <span className="text-[10px] font-semibold bg-moss text-paper px-2 py-0.5">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  {addr.phone && <p className="text-xs text-stone-dark">Phone: {addr.phone}</p>}
                  <p className="text-xs text-ink">{addr.street}</p>
                  {addr.line2 && <p className="text-xs text-stone-dark">{addr.line2}</p>}
                  <p className="text-xs text-stone-dark">
                    {addr.city}, {addr.state} - {addr.pincode}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!addr.isDefault && (
                    <button
                      type="button"
                      disabled={isPendingAddress}
                      onClick={() => handleSetDefaultAddress(addr.id)}
                      className="min-h-[44px] px-3 py-1.5 text-xs border border-stone text-ink rounded-none hover:bg-paper transition-colors"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isPendingAddress}
                    onClick={() => startEditAddress(addr)}
                    className="min-h-[44px] px-3 py-1.5 text-xs border border-stone text-ink rounded-none hover:bg-paper transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPendingAddress}
                    onClick={() => handleDeleteAddress(addr.id)}
                    className="min-h-[44px] px-3 py-1.5 text-xs border border-stone text-clay rounded-none hover:bg-red-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
                      {o.statusLabel || o.status}
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
                        currentStatus={o.status}
                        events={o.statusEvents}
                        courierName={o.shipment?.courierName || o.courierName}
                        awbNumber={o.shipment?.awb || o.awbNumber}
                        trackingUrl={o.shipment?.trackingUrl || o.trackingUrl}
                      />
                      {o.shipment?.events && o.shipment.events.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-stone/30 space-y-1.5 text-xs">
                          <p className="text-[11px] font-semibold text-stone-dark uppercase tracking-wider">Tracking Updates</p>
                          {o.shipment.events.map((ev) => (
                            <div key={ev.id} className="flex justify-between items-center text-stone-dark py-0.5">
                              <div>
                                <span className="font-medium text-ink">{ev.status}</span>
                                {ev.rawStatus && ev.rawStatus !== ev.status && <span> - {ev.rawStatus}</span>}
                                {ev.location && <span className="font-mono text-[11px] ml-1">({ev.location})</span>}
                              </div>
                              <span className="font-mono text-[10px] text-stone-dark">
                                {new Date(ev.occurredAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="text-xs font-semibold text-stone-dark uppercase tracking-wider">
                      Order Items
                    </p>
                    <div className="divide-y divide-stone/40 border border-stone/40 rounded bg-paper">
                      {o.items.map((item) => (
                        <div key={item.id} className="flex justify-between p-3 text-[13px]">
                          <div>
                            <p className="font-medium text-ink">{item.name}</p>
                            <p className="text-xs text-stone-dark">Size: {item.size}{item.color ? ` · ${item.color}` : ""} • Qty: {item.qty}</p>
                          </div>
                          <p className="font-mono font-medium text-ink">{formatINR(item.unitPrice * item.qty)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-stone/40 text-xs">
                      <div className="flex items-center gap-3">
                        {o.hasInvoice && (
                          <a
                            href={`/api/orders/${o.id}/invoice`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-ink underline hover:text-moss"
                          >
                            📄 Download Invoice
                          </a>
                        )}
                        {o.hasCreditNote && (
                          <a
                            href={`/api/orders/${o.id}/credit-note`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-ink underline hover:text-moss"
                          >
                            📋 Credit Note
                          </a>
                        )}
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
                      <div className="pt-3 border-t border-stone/50 space-y-3">
                        {/* List Existing Return Requests */}
                        {o.returnRequests && o.returnRequests.length > 0 && (
                          <div className="space-y-2">
                            {o.returnRequests.map((req) => (
                              <div
                                key={req.id}
                                className="p-3 bg-paper border border-stone rounded-sm text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-ink">Return Status:</span>
                                    <span
                                      className={`font-semibold px-2 py-0.5 rounded uppercase text-[10px] ${
                                        req.status === "REFUNDED"
                                          ? "bg-emerald-100 text-emerald-800"
                                          : req.status === "REJECTED" || req.status === "CANCELLED"
                                          ? "bg-stone-200 text-stone-700"
                                          : "bg-amber-100 text-amber-800"
                                      }`}
                                    >
                                      {req.status}
                                    </span>
                                  </div>
                                  {req.status === "REQUESTED" && (
                                    <button
                                      type="button"
                                      disabled={isPendingReturn || cancellingReturnId === req.id}
                                      onClick={() => handleCancelReturn(req.id)}
                                      className="text-[11px] text-clay hover:underline disabled:opacity-50"
                                    >
                                      {cancellingReturnId === req.id ? "Cancelling..." : "Cancel Return"}
                                    </button>
                                  )}
                                </div>
                                <p className="text-stone-dark">
                                  <strong>Reason:</strong> {req.reason || req.reasonCode || "Return requested"}
                                </p>
                                {req.customerNote && (
                                  <p className="text-stone-dark">
                                    <strong>Your Note:</strong> {req.customerNote}
                                  </p>
                                )}
                                {req.adminNote && (
                                  <p className="text-stone-dark border-t border-stone/30 pt-1 mt-1">
                                    <strong>Admin Note:</strong> {req.adminNote}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Request Return Panel */}
                        {returningOrderId === o.id ? (
                          <div className="p-4 bg-amber-50 border border-amber-300 rounded-sm space-y-3 text-xs">
                            <p className="font-semibold text-amber-900 uppercase tracking-wider text-[11px]">
                              Select Items to Return
                            </p>

                            <div className="space-y-2 border border-amber-200 bg-white p-3 rounded-sm">
                              {o.items
                                .filter((item) => !item.isGift && (item.remainingReturnable ?? item.qty) > 0)
                                .map((item) => {
                                  const maxQty = item.remainingReturnable ?? item.qty;
                                  const currentSelected = returningItemQtys[item.id] || 0;
                                  const isChecked = currentSelected > 0;

                                  return (
                                    <div
                                      key={item.id}
                                      className="flex items-center justify-between py-1.5 border-b border-stone/20 last:border-0"
                                    >
                                      <label className="flex items-center gap-2 cursor-pointer flex-1">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              setReturningItemQtys((prev) => ({
                                                ...prev,
                                                [item.id]: 1,
                                              }));
                                            } else {
                                              setReturningItemQtys((prev) => {
                                                const next = { ...prev };
                                                delete next[item.id];
                                                return next;
                                              });
                                            }
                                          }}
                                          className="rounded text-ink focus:ring-0"
                                        />
                                        <div>
                                          <p className="font-medium text-ink">
                                            {item.name} ({item.size})
                                          </p>
                                          <p className="text-[11px] text-stone-dark">
                                            {formatINR(item.unitPrice)} · Returnable: {maxQty}
                                          </p>
                                        </div>
                                      </label>

                                      {isChecked && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (currentSelected > 1) {
                                                setReturningItemQtys((prev) => ({
                                                  ...prev,
                                                  [item.id]: currentSelected - 1,
                                                }));
                                              }
                                            }}
                                            className="w-6 h-6 border border-stone bg-paper rounded flex items-center justify-center font-mono hover:bg-stone/10"
                                          >
                                            -
                                          </button>
                                          <span className="w-6 text-center font-mono font-medium">
                                            {currentSelected}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (currentSelected < maxQty) {
                                                setReturningItemQtys((prev) => ({
                                                  ...prev,
                                                  [item.id]: currentSelected + 1,
                                                }));
                                              }
                                            }}
                                            className="w-6 h-6 border border-stone bg-paper rounded flex items-center justify-center font-mono hover:bg-stone/10"
                                          >
                                            +
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-stone-dark mb-1">
                                Reason for Return
                              </label>
                              <select
                                value={returnReasonCode}
                                onChange={(e) =>
                                  setReturnReasonCode(
                                    e.target.value as
                                      | "WRONG_SIZE"
                                      | "DEFECTIVE"
                                      | "NOT_AS_DESCRIBED"
                                      | "CHANGED_MIND"
                                      | "OTHER"
                                  )
                                }
                                className="w-full px-3 py-1.5 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
                              >
                                <option value="WRONG_SIZE">Wrong Size / Fit Issue</option>
                                <option value="DEFECTIVE">Defective / Damaged</option>
                                <option value="NOT_AS_DESCRIBED">Not as Described</option>
                                <option value="CHANGED_MIND">Changed Mind</option>
                                <option value="OTHER">Other Reason</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-medium text-stone-dark mb-1">
                                Additional Notes (optional)
                              </label>
                              <input
                                type="text"
                                placeholder="Details about fit or defect"
                                value={returnCustomerNote}
                                onChange={(e) => setReturnCustomerNote(e.target.value)}
                                className="w-full px-3 py-2 text-xs border border-stone bg-white rounded-sm focus:outline-none focus:border-ink"
                              />
                            </div>

                            {returnErrorMsg && <p className="text-xs text-clay">{returnErrorMsg}</p>}

                            <div className="flex gap-2 pt-1">
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
                                  setReturningItemQtys({});
                                  setReturnCustomerNote("");
                                  setReturnErrorMsg(null);
                                }}
                                className="px-3 py-2 text-xs text-stone-dark hover:text-ink"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          o.isReturnWindowOpen !== false &&
                          o.items.some(
                            (item) => !item.isGift && (item.remainingReturnable ?? item.qty) > 0
                          ) && (
                            <button
                              type="button"
                              onClick={() => {
                                setReturningOrderId(o.id);
                                setReturningItemQtys({});
                                setReturnCustomerNote("");
                                setReturnErrorMsg(null);
                              }}
                              className="text-xs font-medium text-moss hover:underline"
                            >
                              Return Items
                            </button>
                          )
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

function ContactDetailsCard({
  user,
}: {
  user: {
    email?: string | null;
    phone?: string | null;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
  };
}) {
  const router = useRouter();
  const [activeChannel, setActiveChannel] = useState<"PHONE" | "EMAIL" | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [stepUpChannel, setStepUpChannel] = useState<"EMAIL" | "PHONE">(
    !user.email && user.phone ? "PHONE" : "EMAIL"
  );
  const [stepUpCode, setStepUpCode] = useState("");
  const [newValue, setNewValue] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [stepUpSentMsg, setStepUpSentMsg] = useState<string | null>(null);
  const [neutralMsg, setNeutralMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasCurrentContact = Boolean(user.email || user.phone);

  function startChange(channel: "PHONE" | "EMAIL") {
    setActiveChannel(channel);
    setNewValue("");
    setConfirmCode("");
    setStepUpCode("");
    setErrorMsg(null);
    setSuccessMsg(null);
    setStepUpSentMsg(null);
    setNeutralMsg(null);

    if (!user.email && user.phone) {
      setStepUpChannel("PHONE");
    } else {
      setStepUpChannel("EMAIL");
    }

    if (hasCurrentContact) {
      setStep(1);
    } else {
      setStep(2);
    }
  }

  function handleSendStepUp() {
    setErrorMsg(null);
    startTransition(async () => {
      try {
        const res = await requestStepUpAction(stepUpChannel);
        setStepUpSentMsg(res.message);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to send verification code");
      }
    });
  }

  function handleVerifyStepUp(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!stepUpCode.trim() || stepUpCode.trim().length !== 6) {
      setErrorMsg("Please enter 6-digit verification code");
      return;
    }
    startTransition(async () => {
      try {
        await confirmStepUpAction(stepUpCode.trim(), stepUpChannel);
        setStep(2);
        setErrorMsg(null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Invalid or expired code");
      }
    });
  }

  function handleRequestNewValue(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!newValue.trim()) return;

    startTransition(async () => {
      try {
        const res = await requestContactChangeAction({
          channel: activeChannel!,
          newValue: newValue.trim(),
        });
        setNeutralMsg(res.message);
        setStep(3);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Failed to process request");
      }
    });
  }

  function handleConfirmContactChange(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!confirmCode.trim() || confirmCode.trim().length !== 6) {
      setErrorMsg("Please enter 6-digit verification code");
      return;
    }

    startTransition(async () => {
      try {
        await confirmContactChangeAction({
          channel: activeChannel!,
          newValue: newValue.trim(),
          code: confirmCode.trim(),
        });
        setSuccessMsg(`Contact details updated successfully.`);
        setActiveChannel(null);
        router.refresh();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Invalid or expired code");
      }
    });
  }

  return (
    <section className="border border-stone p-6 bg-white rounded-none space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Contact Details</h2>
        <p className="text-xs text-stone-dark">
          Manage your verified email and phone number for notifications and sign-in.
        </p>
      </div>

      {successMsg && <p className="text-xs font-medium text-moss">{successMsg}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Email Address */}
        <div className="p-4 border border-stone bg-paper rounded-none space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Email Address</span>
            {user.email ? (
              <span className="text-[10px] font-semibold bg-moss text-paper px-2 py-0.5">
                Verified
              </span>
            ) : (
              <span className="text-[10px] font-semibold bg-stone text-stone-dark px-2 py-0.5">
                Not set
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-ink font-medium">
            {user.email || "No email address set"}
          </p>
          <button
            type="button"
            onClick={() => startChange("EMAIL")}
            className="min-h-[44px] text-xs text-ink font-medium underline hover:text-stone-dark pt-1 block"
          >
            {user.email ? "Change Email" : "+ Add Email"}
          </button>
        </div>

        {/* Mobile Phone */}
        <div className="p-4 border border-stone bg-paper rounded-none space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Mobile Phone</span>
            {user.phone ? (
              <span className="text-[10px] font-semibold bg-moss text-paper px-2 py-0.5">
                Verified
              </span>
            ) : (
              <span className="text-[10px] font-semibold bg-stone text-stone-dark px-2 py-0.5">
                Not set
              </span>
            )}
          </div>
          <p className="text-xs font-mono text-ink font-medium">
            {user.phone || "No phone number set"}
          </p>
          <button
            type="button"
            onClick={() => startChange("PHONE")}
            className="min-h-[44px] text-xs text-ink font-medium underline hover:text-stone-dark pt-1 block"
          >
            {user.phone ? "Change Phone" : "+ Add Phone"}
          </button>
        </div>
      </div>

      {/* Change / Add Sheet */}
      {activeChannel && (
        <div className="mt-4 p-5 border border-stone bg-white rounded-none space-y-4">
          <div className="flex justify-between items-center border-b border-stone pb-3">
            <h3 className="text-sm font-semibold text-ink">
              {activeChannel === "EMAIL" ? "Update Email Address" : "Update Mobile Phone"}
            </h3>
            <button
              type="button"
              onClick={() => setActiveChannel(null)}
              className="text-xs text-stone-dark hover:text-ink min-h-[44px] px-2 flex items-center"
            >
              Cancel
            </button>
          </div>

          {errorMsg && <p className="text-xs text-clay">{errorMsg}</p>}

          {/* Step 1: Confirm it's you */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-stone-dark">
                Step 1 of 3: For your security, please verify your identity before updating contact details.
              </p>
              {user.email && user.phone && (
                <div className="space-y-2">
                  <label className="block text-[12px] font-medium text-stone-dark">Send security code to:</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                      <input
                        type="radio"
                        name="stepUpChannel"
                        checked={stepUpChannel === "EMAIL"}
                        onChange={() => {
                          setStepUpChannel("EMAIL");
                          setStepUpSentMsg(null);
                        }}
                      />
                      <span>Email ({user.email})</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                      <input
                        type="radio"
                        name="stepUpChannel"
                        checked={stepUpChannel === "PHONE"}
                        onChange={() => {
                          setStepUpChannel("PHONE");
                          setStepUpSentMsg(null);
                        }}
                      />
                      <span>Phone ({user.phone})</span>
                    </label>
                  </div>
                </div>
              )}

              {!stepUpSentMsg ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleSendStepUp}
                  className="min-h-[44px] px-4 py-2 bg-ink text-paper text-xs font-medium rounded-none hover:bg-opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Sending code..." : "Send Verification Code"}
                </button>
              ) : (
                <form onSubmit={handleVerifyStepUp} className="space-y-3">
                  <p className="text-xs text-moss">{stepUpSentMsg}</p>
                  <div>
                    <label className="block text-[12px] font-medium text-stone-dark mb-1">
                      Enter 6-digit security code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      placeholder="123456"
                      value={stepUpCode}
                      onChange={(e) => setStepUpCode(e.target.value.replace(/\D/g, ""))}
                      className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white font-mono text-center tracking-widest text-[14px] rounded-none focus:outline-none focus:border-ink"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="min-h-[44px] px-4 py-2 bg-ink text-paper text-xs font-medium rounded-none hover:bg-opacity-90 disabled:opacity-50"
                    >
                      {isPending ? "Verifying..." : "Verify & Continue"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={handleSendStepUp}
                      className="min-h-[44px] px-3 py-2 text-xs border border-stone text-stone-dark hover:text-ink rounded-none"
                    >
                      Resend
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Step 2: New Value */}
          {step === 2 && (
            <form onSubmit={handleRequestNewValue} className="space-y-4">
              <p className="text-xs text-stone-dark">
                Step 2 of 3: Enter your new {activeChannel === "EMAIL" ? "email address" : "phone number"}.
              </p>
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">
                  {activeChannel === "EMAIL" ? "New Email Address" : "New Mobile Number"}
                </label>
                <input
                  type={activeChannel === "EMAIL" ? "email" : "tel"}
                  inputMode={activeChannel === "PHONE" ? "numeric" : undefined}
                  required
                  placeholder={activeChannel === "EMAIL" ? "you@example.com" : "10-digit mobile number"}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white text-[13.5px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
              <button
                type="submit"
                disabled={isPending}
                className="min-h-[44px] px-4 py-2 bg-ink text-paper text-xs font-medium rounded-none hover:bg-opacity-90 disabled:opacity-50"
              >
                {isPending ? "Sending code..." : "Continue"}
              </button>
            </form>
          )}

          {/* Step 3: Enter Code */}
          {step === 3 && (
            <form onSubmit={handleConfirmContactChange} className="space-y-4">
              <p className="text-xs text-stone-dark">
                Step 3 of 3: Confirm verification code.
              </p>
              {neutralMsg && <p className="text-xs text-stone-dark font-medium">{neutralMsg}</p>}
              <div>
                <label className="block text-[12px] font-medium text-stone-dark mb-1">
                  Enter 6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full min-h-[44px] px-3.5 py-2.5 border border-stone bg-white font-mono text-center tracking-widest text-[14px] rounded-none focus:outline-none focus:border-ink"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="min-h-[44px] px-4 py-2 bg-ink text-paper text-xs font-medium rounded-none hover:bg-opacity-90 disabled:opacity-50"
                >
                  {isPending ? "Confirming..." : "Confirm Change"}
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="min-h-[44px] px-3 py-2 text-xs border border-stone text-stone-dark hover:text-ink rounded-none"
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
