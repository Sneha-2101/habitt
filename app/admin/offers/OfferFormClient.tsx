"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createOffer, updateOffer } from "@/lib/actions/offers";
import type { OfferKind, OfferAudience } from "@/lib/offers/schema";

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface CollectionOption {
  id: string;
  name: string;
  slug: string;
}

interface ProductOption {
  id: string;
  name: string;
  slug: string;
  price: number;
}

interface VariantOption {
  id: string;
  size: string;
  color: string;
  sku: string | null;
  stock: number;
  product: {
    id: string;
    name: string;
  };
}

export interface ExistingOfferData {
  id: string;
  name: string;
  kind: OfferKind;
  code: string | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  minCartRupees: number;
  maxUsesTotal: number | null;
  maxUsesPerCustomer: number | null;
  priority: number;
  audience: OfferAudience;
  config: Record<string, unknown>;
  targets: Array<{
    type: "category" | "product" | "collection";
    id: string;
  }>;
}

export default function OfferFormClient({
  existingOffer,
  categories,
  collections,
  products,
  variants,
}: {
  existingOffer?: ExistingOfferData;
  categories: CategoryOption[];
  collections: CollectionOption[];
  products: ProductOption[];
  variants: VariantOption[];
}) {
  const router = useRouter();
  const isEditing = !!existingOffer;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Core fields
  const [name, setName] = useState(existingOffer?.name || "");
  const [kind, setKind] = useState<OfferKind>(existingOffer?.kind || "PERCENT_OFF");
  const [isCoupon, setIsCoupon] = useState(!!existingOffer?.code);
  const [code, setCode] = useState(existingOffer?.code || "");
  const [active, setActive] = useState(existingOffer ? existingOffer.active : true);
  const [startsAt, setStartsAt] = useState(existingOffer?.startsAt || "");
  const [endsAt, setEndsAt] = useState(existingOffer?.endsAt || "");
  const [minCartRupees, setMinCartRupees] = useState(
    existingOffer?.minCartRupees !== undefined ? String(existingOffer.minCartRupees) : "0"
  );
  const [maxUsesTotal, setMaxUsesTotal] = useState(
    existingOffer?.maxUsesTotal ? String(existingOffer.maxUsesTotal) : ""
  );
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState(
    existingOffer?.maxUsesPerCustomer ? String(existingOffer.maxUsesPerCustomer) : ""
  );
  const [priority, setPriority] = useState(
    existingOffer?.priority !== undefined ? String(existingOffer.priority) : "100"
  );
  const [audience, setAudience] = useState<OfferAudience>(existingOffer?.audience || "ALL");

  // Config states
  const cfg = (existingOffer?.config || {}) as Record<string, unknown>;
  const [percent, setPercent] = useState(
    existingOffer?.kind === "PERCENT_OFF" ? String(cfg.percent ?? "10") : "10"
  );
  const [flatAmountRupees, setFlatAmountRupees] = useState(
    existingOffer?.kind === "FLAT_OFF"
      ? String((Number(cfg.amountPaise) || 0) / 100)
      : "100"
  );

  // Tiers
  const [tiers, setTiers] = useState<
    Array<{ minQty: number; type: "PERCENT" | "FLAT_PER_UNIT"; valueRupees: number }>
  >(() => {
    if (existingOffer?.kind === "TIER" && Array.isArray(existingOffer.config.tiers)) {
      return (existingOffer.config.tiers as Array<{ minQty: number; type: "PERCENT" | "FLAT_PER_UNIT"; value: number }>).map((t) => ({
        minQty: t.minQty,
        type: t.type,
        valueRupees: t.type === "PERCENT" ? t.value : t.value / 100,
      }));
    }
    return [
      { minQty: 2, type: "PERCENT", valueRupees: 10 },
      { minQty: 3, type: "PERCENT", valueRupees: 20 },
    ];
  });

  // Combo Any
  const [comboAnyQty, setComboAnyQty] = useState(
    existingOffer?.kind === "COMBO_ANY" ? String(cfg.quantity ?? "2") : "2"
  );
  const [comboAnyPriceRupees, setComboAnyPriceRupees] = useState(
    existingOffer?.kind === "COMBO_ANY"
      ? String((Number(cfg.fixedPricePaise) || 0) / 100)
      : "999"
  );
  const [comboAnyRepeatable, setComboAnyRepeatable] = useState<boolean>(
    existingOffer?.kind === "COMBO_ANY" ? Boolean(cfg.repeatable ?? true) : true
  );

  // Combo Slots
  const [comboSlots, setComboSlots] = useState<
    Array<{
      label: string;
      quantity: number;
      selectorType: "category" | "product" | "collection";
      selectorId: string;
    }>
  >(() => {
    if (existingOffer?.kind === "COMBO_SLOTS" && Array.isArray(existingOffer.config.slots)) {
      return (existingOffer.config.slots as Array<{
        label: string;
        quantity: number;
        selector: { type: "category" | "product" | "collection"; id: string };
      }>).map((s) => ({
        label: s.label,
        quantity: s.quantity,
        selectorType: s.selector.type,
        selectorId: s.selector.id,
      }));
    }
    return [
      {
        label: "Top",
        quantity: 1,
        selectorType: "category",
        selectorId: categories[0]?.id || "",
      },
      {
        label: "Bottom",
        quantity: 1,
        selectorType: "category",
        selectorId: categories[1]?.id || categories[0]?.id || "",
      },
    ];
  });
  const [comboSlotsPriceRupees, setComboSlotsPriceRupees] = useState(
    existingOffer?.kind === "COMBO_SLOTS"
      ? String((Number(cfg.fixedPricePaise) || 0) / 100)
      : "1499"
  );
  const [comboSlotsRepeatable, setComboSlotsRepeatable] = useState<boolean>(
    existingOffer?.kind === "COMBO_SLOTS" ? Boolean(cfg.repeatable ?? true) : true
  );

  // Gift
  const giftConfig = (cfg.gift || {}) as { type?: "VARIANT" | "TEXT"; variantId?: string; text?: string };
  const [giftBuyQty, setGiftBuyQty] = useState(
    existingOffer?.kind === "GIFT" ? String(cfg.buyQty ?? "2") : "2"
  );
  const [giftQty, setGiftQty] = useState(
    existingOffer?.kind === "GIFT" ? String(cfg.giftQty ?? "1") : "1"
  );
  const [giftType, setGiftType] = useState<"VARIANT" | "TEXT">(
    existingOffer?.kind === "GIFT" ? giftConfig.type || "VARIANT" : "VARIANT"
  );
  const [giftVariantId, setGiftVariantId] = useState(
    existingOffer?.kind === "GIFT" && giftConfig.type === "VARIANT" && giftConfig.variantId
      ? giftConfig.variantId
      : variants[0]?.id || ""
  );
  const [giftText, setGiftText] = useState(
    existingOffer?.kind === "GIFT" && giftConfig.type === "TEXT" && giftConfig.text
      ? giftConfig.text
      : "Free Tote Bag"
  );

  // Targets / Scope
  const [scopeType, setScopeType] = useState<"ALL" | "CATEGORY" | "PRODUCT" | "COLLECTION">(() => {
    if (!existingOffer || existingOffer.targets.length === 0) return "ALL";
    const firstType = existingOffer.targets[0].type;
    if (firstType === "category") return "CATEGORY";
    if (firstType === "product") return "PRODUCT";
    if (firstType === "collection") return "COLLECTION";
    return "ALL";
  });

  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(() => {
    if (!existingOffer) return new Set();
    return new Set(existingOffer.targets.map((t) => t.id));
  });

  const [targetSearch, setTargetSearch] = useState("");

  const toggleTarget = (id: string) => {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddTier = () => {
    if (tiers.length >= 6) return;
    const last = tiers[tiers.length - 1];
    const nextQty = last ? last.minQty + 1 : 2;
    setTiers([...tiers, { minQty: nextQty, type: "PERCENT", valueRupees: 10 }]);
  };

  const handleRemoveTier = (index: number) => {
    if (tiers.length <= 1) return;
    setTiers(tiers.filter((_, i) => i !== index));
  };

  const handleAddSlot = () => {
    setComboSlots([
      ...comboSlots,
      {
        label: `Slot ${comboSlots.length + 1}`,
        quantity: 1,
        selectorType: "category",
        selectorId: categories[0]?.id || "",
      },
    ]);
  };

  const handleRemoveSlot = (index: number) => {
    if (comboSlots.length <= 2) return;
    setComboSlots(comboSlots.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarning(null);
    setLoading(true);

    try {
      // Build config object
      let configObj: Record<string, unknown> = {};
      if (kind === "PERCENT_OFF") {
        configObj = { percent: parseInt(percent, 10) };
      } else if (kind === "FLAT_OFF") {
        configObj = { amountRupees: parseFloat(flatAmountRupees) };
      } else if (kind === "TIER") {
        configObj = {
          tiers: tiers.map((t) => ({
            minQty: t.minQty,
            type: t.type,
            ...(t.type === "PERCENT"
              ? { value: Math.round(t.valueRupees) }
              : { valueRupees: t.valueRupees }),
          })),
        };
      } else if (kind === "COMBO_ANY") {
        configObj = {
          quantity: parseInt(comboAnyQty, 10),
          fixedPriceRupees: parseFloat(comboAnyPriceRupees),
          repeatable: comboAnyRepeatable,
        };
      } else if (kind === "COMBO_SLOTS") {
        configObj = {
          slots: comboSlots.map((s) => ({
            label: s.label.trim(),
            quantity: s.quantity,
            selector: {
              type: s.selectorType,
              id: s.selectorId,
            },
          })),
          fixedPriceRupees: parseFloat(comboSlotsPriceRupees),
          repeatable: comboSlotsRepeatable,
        };
      } else if (kind === "GIFT") {
        configObj = {
          buyQty: parseInt(giftBuyQty, 10),
          giftQty: parseInt(giftQty, 10),
          gift:
            giftType === "VARIANT"
              ? { type: "VARIANT", variantId: giftVariantId }
              : { type: "TEXT", text: giftText.trim() },
        };
      }

      // Build targets
      const targetsList: Array<{ type: "category" | "product" | "collection"; id: string }> = [];
      if (kind !== "COMBO_SLOTS" && scopeType !== "ALL") {
        const typeKey =
          scopeType === "CATEGORY"
            ? "category"
            : scopeType === "PRODUCT"
            ? "product"
            : "collection";
        for (const id of selectedTargetIds) {
          targetsList.push({ type: typeKey, id });
        }
      }

      const payload = {
        name: name.trim(),
        kind,
        code: isCoupon && code.trim() ? code.trim().toUpperCase() : null,
        active,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        minCartRupees: parseFloat(minCartRupees) || 0,
        maxUsesTotal: maxUsesTotal.trim() ? parseInt(maxUsesTotal, 10) : null,
        maxUsesPerCustomer: maxUsesPerCustomer.trim() ? parseInt(maxUsesPerCustomer, 10) : null,
        priority: parseInt(priority, 10) || 100,
        audience,
        config: configObj,
        targets: targetsList,
      };

      if (isEditing && existingOffer) {
        const res = await updateOffer(existingOffer.id, payload);
        if (res.warning) {
          setWarning(res.warning);
        }
        router.push("/admin/offers");
      } else {
        const res = await createOffer(payload);
        if (res.warning) {
          setWarning(res.warning);
        }
        router.push("/admin/offers");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save offer");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}
      {warning && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          {warning}
        </div>
      )}

      {/* Basic Offer Info */}
      <div className="bg-card border border-stone p-6 space-y-4">
        <h2 className="font-display text-base font-semibold">Offer Details</h2>

        <div>
          <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
            OFFER NAME
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Summer Linen Sale 20% Off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              PROMOTION TYPE
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as OfferKind)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            >
              <option value="PERCENT_OFF">Percentage Off</option>
              <option value="FLAT_OFF">Flat Amount Off</option>
              <option value="TIER">Tiered Quantity Discount</option>
              <option value="COMBO_ANY">Combo Any (e.g. Any 3 for ₹1999)</option>
              <option value="COMBO_SLOTS">Combo Slots (e.g. 1 Shirt + 1 Trouser for ₹2499)</option>
              <option value="GIFT">Gift / Free Item (Buy X Get Y)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              TARGET AUDIENCE
            </label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as OfferAudience)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            >
              <option value="ALL">All Customers</option>
              <option value="FIRST_ORDER">First Order Only</option>
              <option value="BIRTHDAY">Birthday Reward</option>
            </select>
          </div>
        </div>

        {/* Coupon Code Option */}
        <div className="pt-2 border-t border-stone space-y-3">
          <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={isCoupon}
              onChange={(e) => setIsCoupon(e.target.checked)}
              className="rounded border-stone text-ink focus:ring-0"
            />
            <span className="font-medium">Require a coupon code at checkout</span>
          </label>

          {isCoupon && (
            <div>
              <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                COUPON CODE (UPPERCASE)
              </label>
              <input
                type="text"
                required={isCoupon}
                placeholder="e.g. SUMMER20"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] font-mono tracking-wider uppercase rounded-none"
              />
              <p className="text-[11px] text-stone-dark mt-1">
                3–32 uppercase letters, numbers, hyphens or underscores.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Promotion Config */}
      <div className="bg-card border border-stone p-6 space-y-4">
        <h2 className="font-display text-base font-semibold">Promotion Rules</h2>

        {kind === "PERCENT_OFF" && (
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              DISCOUNT PERCENTAGE (%)
            </label>
            <input
              type="number"
              min="1"
              max="100"
              required
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
        )}

        {kind === "FLAT_OFF" && (
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              DISCOUNT AMOUNT (₹)
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              required
              value={flatAmountRupees}
              onChange={(e) => setFlatAmountRupees(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
        )}

        {kind === "TIER" && (
          <div className="space-y-3">
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark">
              QUANTITY TIERS (strictly ascending min quantity, max 6)
            </label>
            <div className="space-y-2">
              {tiers.map((t, idx) => (
                <div key={idx} className="flex items-center space-x-3">
                  <div className="w-28">
                    <label className="text-[10px] text-stone-dark block">MIN QTY</label>
                    <input
                      type="number"
                      min="2"
                      value={t.minQty}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 2;
                        setTiers(tiers.map((x, i) => (i === idx ? { ...x, minQty: val } : x)));
                      }}
                      className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                    />
                  </div>
                  <div className="w-36">
                    <label className="text-[10px] text-stone-dark block">DISCOUNT TYPE</label>
                    <select
                      value={t.type}
                      onChange={(e) => {
                        const val = e.target.value as "PERCENT" | "FLAT_PER_UNIT";
                        setTiers(tiers.map((x, i) => (i === idx ? { ...x, type: val } : x)));
                      }}
                      className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                    >
                      <option value="PERCENT">Percent (%)</option>
                      <option value="FLAT_PER_UNIT">Flat/Unit (₹)</option>
                    </select>
                  </div>
                  <div className="w-32">
                    <label className="text-[10px] text-stone-dark block">VALUE</label>
                    <input
                      type="number"
                      step={t.type === "PERCENT" ? "1" : "0.01"}
                      min="1"
                      value={t.valueRupees}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setTiers(tiers.map((x, i) => (i === idx ? { ...x, valueRupees: val } : x)));
                      }}
                      className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                    />
                  </div>
                  <div className="pt-4">
                    <button
                      type="button"
                      onClick={() => handleRemoveTier(idx)}
                      disabled={tiers.length <= 1}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {tiers.length < 6 && (
              <button
                type="button"
                onClick={handleAddTier}
                className="text-xs text-ink underline font-medium hover:text-ink/80 pt-1"
              >
                + Add another tier
              </button>
            )}
          </div>
        )}

        {kind === "COMBO_ANY" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  ITEMS QUANTITY
                </label>
                <input
                  type="number"
                  min="2"
                  required
                  value={comboAnyQty}
                  onChange={(e) => setComboAnyQty(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
              </div>
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  FIXED COMBO PRICE (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={comboAnyPriceRupees}
                  onChange={(e) => setComboAnyPriceRupees(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
              </div>
            </div>
            <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={comboAnyRepeatable}
                onChange={(e) => setComboAnyRepeatable(e.target.checked)}
                className="rounded border-stone text-ink focus:ring-0"
              />
              <span>Repeatable (applies for every N qualifying items in cart)</span>
            </label>
          </div>
        )}

        {kind === "COMBO_SLOTS" && (
          <div className="space-y-4">
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark">
              BUNDLE SLOTS (minimum 2 slots required)
            </label>
            <div className="space-y-3">
              {comboSlots.map((slot, sIdx) => (
                <div key={sIdx} className="p-3 border border-stone bg-paper/60 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-ink">Slot #{sIdx + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSlot(sIdx)}
                      disabled={comboSlots.length <= 2}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-30"
                    >
                      Delete Slot
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-stone-dark block">LABEL</label>
                      <input
                        type="text"
                        required
                        value={slot.label}
                        onChange={(e) => {
                          const val = e.target.value;
                          setComboSlots(
                            comboSlots.map((x, i) => (i === sIdx ? { ...x, label: val } : x))
                          );
                        }}
                        className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-stone-dark block">QUANTITY</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={slot.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 1;
                          setComboSlots(
                            comboSlots.map((x, i) => (i === sIdx ? { ...x, quantity: val } : x))
                          );
                        }}
                        className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-stone-dark block">SELECTOR TYPE</label>
                      <select
                        value={slot.selectorType}
                        onChange={(e) => {
                          const val = e.target.value as "category" | "product" | "collection";
                          const defaultId =
                            val === "category"
                              ? categories[0]?.id || ""
                              : val === "product"
                              ? products[0]?.id || ""
                              : collections[0]?.id || "";
                          setComboSlots(
                            comboSlots.map((x, i) =>
                              i === sIdx
                                ? { ...x, selectorType: val, selectorId: defaultId }
                                : x
                            )
                          );
                        }}
                        className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                      >
                        <option value="category">Category</option>
                        <option value="product">Product</option>
                        <option value="collection">Collection</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-stone-dark block">SELECT TARGET</label>
                    <select
                      value={slot.selectorId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setComboSlots(
                          comboSlots.map((x, i) => (i === sIdx ? { ...x, selectorId: val } : x))
                        );
                      }}
                      className="w-full h-[36px] px-2 border border-stone bg-white text-xs"
                    >
                      {slot.selectorType === "category" &&
                        categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      {slot.selectorType === "product" &&
                        products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      {slot.selectorType === "collection" &&
                        collections.map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddSlot}
              className="text-xs text-ink underline font-medium hover:text-ink/80 pt-1"
            >
              + Add another slot
            </button>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  FIXED BUNDLE PRICE (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  value={comboSlotsPriceRupees}
                  onChange={(e) => setComboSlotsPriceRupees(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
              </div>
              <div className="flex items-center pt-5">
                <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={comboSlotsRepeatable}
                    onChange={(e) => setComboSlotsRepeatable(e.target.checked)}
                    className="rounded border-stone text-ink focus:ring-0"
                  />
                  <span>Repeatable (applies for multiple complete bundles)</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {kind === "GIFT" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  QUALIFYING BUY QUANTITY
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={giftBuyQty}
                  onChange={(e) => setGiftBuyQty(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
                <p className="text-[11px] text-stone-dark mt-1">
                  Set to 0 if triggered strictly by Minimum Cart Value.
                </p>
              </div>
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  GIFT QUANTITY (FREE)
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={giftQty}
                  onChange={(e) => setGiftQty(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                GIFT TYPE
              </label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
                  <input
                    type="radio"
                    name="giftType"
                    value="VARIANT"
                    checked={giftType === "VARIANT"}
                    onChange={() => setGiftType("VARIANT")}
                  />
                  <span>Catalog Variant (tracked in stock)</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
                  <input
                    type="radio"
                    name="giftType"
                    value="TEXT"
                    checked={giftType === "TEXT"}
                    onChange={() => setGiftType("TEXT")}
                  />
                  <span>Promotional Text Gift (e.g. Free Sticker/Tote)</span>
                </label>
              </div>
            </div>

            {giftType === "VARIANT" ? (
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  SELECT GIFT VARIANT
                </label>
                <select
                  value={giftVariantId}
                  onChange={(e) => setGiftVariantId(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                >
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.product.name} — Size {v.size} {v.color ? `(${v.color})` : ""}{" "}
                      [{v.stock} in stock]
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
                  GIFT DESCRIPTION
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Free Minimalist Tote Bag"
                  value={giftText}
                  onChange={(e) => setGiftText(e.target.value)}
                  className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Scope / Targets Picker (Disabled for COMBO_SLOTS) */}
      {kind !== "COMBO_SLOTS" && (
        <div className="bg-card border border-stone p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-display text-base font-semibold">Offer Scope</h2>
            <span className="text-xs text-stone-dark">
              {scopeType === "ALL"
                ? "Entire store"
                : `${selectedTargetIds.size} target(s) selected`}
            </span>
          </div>

          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              APPLY OFFER TO
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setScopeType("ALL");
                  setSelectedTargetIds(new Set());
                }}
                className={`py-2 px-3 text-xs border text-center font-medium ${
                  scopeType === "ALL"
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-ink border-stone hover:bg-paper"
                }`}
              >
                Whole Cart
              </button>
              <button
                type="button"
                onClick={() => {
                  setScopeType("CATEGORY");
                  setSelectedTargetIds(new Set());
                }}
                className={`py-2 px-3 text-xs border text-center font-medium ${
                  scopeType === "CATEGORY"
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-ink border-stone hover:bg-paper"
                }`}
              >
                Categories
              </button>
              <button
                type="button"
                onClick={() => {
                  setScopeType("COLLECTION");
                  setSelectedTargetIds(new Set());
                }}
                className={`py-2 px-3 text-xs border text-center font-medium ${
                  scopeType === "COLLECTION"
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-ink border-stone hover:bg-paper"
                }`}
              >
                Collections
              </button>
              <button
                type="button"
                onClick={() => {
                  setScopeType("PRODUCT");
                  setSelectedTargetIds(new Set());
                }}
                className={`py-2 px-3 text-xs border text-center font-medium ${
                  scopeType === "PRODUCT"
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-ink border-stone hover:bg-paper"
                }`}
              >
                Products
              </button>
            </div>
          </div>

          {scopeType !== "ALL" && (
            <div className="space-y-2 pt-2">
              <input
                type="text"
                placeholder="Search targets..."
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                className="w-full h-[36px] px-3 border border-stone bg-white text-xs"
              />

              <div className="border border-stone bg-white max-h-56 overflow-y-auto divide-y divide-stone">
                {scopeType === "CATEGORY" &&
                  categories
                    .filter((c) =>
                      c.name.toLowerCase().includes(targetSearch.toLowerCase())
                    )
                    .map((cat) => (
                      <label
                        key={cat.id}
                        className="flex items-center space-x-2 p-2.5 text-xs text-ink cursor-pointer hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargetIds.has(cat.id)}
                          onChange={() => toggleTarget(cat.id)}
                          className="rounded border-stone text-ink focus:ring-0"
                        />
                        <span>{cat.name}</span>
                      </label>
                    ))}

                {scopeType === "COLLECTION" &&
                  collections
                    .filter((col) =>
                      col.name.toLowerCase().includes(targetSearch.toLowerCase())
                    )
                    .map((col) => (
                      <label
                        key={col.id}
                        className="flex items-center space-x-2 p-2.5 text-xs text-ink cursor-pointer hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargetIds.has(col.id)}
                          onChange={() => toggleTarget(col.id)}
                          className="rounded border-stone text-ink focus:ring-0"
                        />
                        <span>{col.name}</span>
                      </label>
                    ))}

                {scopeType === "PRODUCT" &&
                  products
                    .filter((p) =>
                      p.name.toLowerCase().includes(targetSearch.toLowerCase())
                    )
                    .map((prod) => (
                      <label
                        key={prod.id}
                        className="flex items-center space-x-2 p-2.5 text-xs text-ink cursor-pointer hover:bg-paper"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargetIds.has(prod.id)}
                          onChange={() => toggleTarget(prod.id)}
                          className="rounded border-stone text-ink focus:ring-0"
                        />
                        <span>{prod.name} (₹{prod.price / 100})</span>
                      </label>
                    ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conditions, Limits & Schedule */}
      <div className="bg-card border border-stone p-6 space-y-4">
        <h2 className="font-display text-base font-semibold">Conditions &amp; Schedule</h2>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              MIN CART TOTAL (₹)
            </label>
            <input
              type="number"
              min="0"
              value={minCartRupees}
              onChange={(e) => setMinCartRupees(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              MAX USES TOTAL
            </label>
            <input
              type="number"
              min="1"
              placeholder="Unlimited"
              value={maxUsesTotal}
              onChange={(e) => setMaxUsesTotal(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              MAX USES PER CUSTOMER
            </label>
            <input
              type="number"
              min="1"
              placeholder="Unlimited"
              value={maxUsesPerCustomer}
              onChange={(e) => setMaxUsesPerCustomer(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              STARTS AT
            </label>
            <input
              type="datetime-local"
              value={startsAt ? startsAt.slice(0, 16) : ""}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              ENDS AT
            </label>
            <input
              type="datetime-local"
              value={endsAt ? endsAt.slice(0, 16) : ""}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-[11px] tracking-[0.06em] text-stone-dark mb-1">
              PRIORITY (lower evaluates earlier)
            </label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full h-[40px] px-3.5 border border-stone bg-white text-[13px] rounded-none"
            />
          </div>
          <div className="flex items-center pt-5">
            <label className="flex items-center space-x-2 text-xs text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-stone text-ink focus:ring-0"
              />
              <span className="font-medium">Offer is Active</span>
            </label>
          </div>
        </div>
      </div>

      {/* Form Action Buttons */}
      <div className="flex items-center justify-between pt-4">
        <Link
          href="/admin/offers"
          className="text-xs text-stone-dark hover:text-ink transition-colors"
        >
          &larr; Back to Offers
        </Link>
        <button
          type="submit"
          disabled={loading}
          className="h-[44px] px-8 bg-ink text-white text-xs uppercase tracking-wider font-medium hover:bg-ink/80 transition-colors disabled:opacity-50"
        >
          {loading ? "Saving..." : isEditing ? "Update Offer" : "Create Offer"}
        </button>
      </div>
    </form>
  );
}
