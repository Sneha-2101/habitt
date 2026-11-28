"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatINR } from "@/lib/money";
import { getMarginTabState } from "@/lib/admin/reports-view";
import type {
  SalesReportResult,
  GstSummaryResult,
  ReturnsReportResult,
  StockReportResult,
  OffersUsageReportResult,
  MarginReportResult,
} from "@/lib/admin/reports";

interface ReportsClientProps {
  initialTab: string;
  from: string;
  to: string;
  isOwner: boolean;
  salesData: SalesReportResult | null;
  gstData: GstSummaryResult | null;
  returnsData: ReturnsReportResult | null;
  stockData: StockReportResult | null;
  offersData: OffersUsageReportResult | null;
  marginData: MarginReportResult | null;
  marginError?: boolean;
}

export default function ReportsClient({
  initialTab,
  from,
  to,
  isOwner,
  salesData,
  gstData,
  returnsData,
  stockData,
  offersData,
  marginData,
  marginError = false,
}: ReportsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState(initialTab || "sales");
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);

  const applyDateRange = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", activeTab);
    params.set("from", fromDate);
    params.set("to", toDate);
    router.push(`/admin/reports?${params.toString()}`);
  };

  const tabs = [
    { id: "sales", label: "Sales & Revenue" },
    { id: "gst", label: "GST Summary" },
    { id: "returns", label: "Returns & SLAs" },
    { id: "stock", label: "Inventory & Stock" },
    { id: "offers", label: "Offers & Promotions" },
    ...(isOwner ? [{ id: "margin", label: "Gross Margin (Owner)" }] : []),
  ];

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabId);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    router.push(`/admin/reports?${params.toString()}`);
  };

  const getCsvDownloadUrl = () => {
    return `/api/admin/reports/${activeTab}?from=${fromDate}&to=${toDate}`;
  };

  return (
    <div className="space-y-6">
      {/* Date controls and CSV download */}
      <div className="bg-card border border-stone p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-stone-dark">From (IST):</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1 bg-white border border-stone text-xs font-mono"
            />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-stone-dark">To (IST):</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1 bg-white border border-stone text-xs font-mono"
            />
          </div>
          <button
            type="button"
            onClick={applyDateRange}
            className="px-3 py-1 bg-moss text-paper text-xs font-mono uppercase tracking-wider hover:opacity-90"
          >
            Apply
          </button>
        </div>

        <a
          href={getCsvDownloadUrl()}
          download
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-paper border border-stone text-xs font-mono uppercase tracking-wider hover:bg-stone/20 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Export {tabs.find((t) => t.id === activeTab)?.label} CSV
        </a>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-stone space-x-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "border-moss text-moss font-semibold bg-paper/50"
                : "border-transparent text-stone-dark hover:text-ink hover:border-stone"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="space-y-6">
        {activeTab === "sales" && salesData && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Paid Orders</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{salesData.total.orders}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Gross Merchandise Value</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{formatINR(salesData.total.grossPaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Discounts</div>
                <div className="text-2xl font-mono mt-1 font-semibold text-clay">-{formatINR(salesData.total.discountPaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Net Realized Revenue</div>
                <div className="text-2xl font-mono mt-1 text-moss font-bold">{formatINR(salesData.total.netPaise)}</div>
              </div>
            </div>

            <div className="border border-stone bg-white overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase">
                  <tr>
                    <th className="p-3">Date (IST)</th>
                    <th className="p-3">Orders</th>
                    <th className="p-3 text-right">Gross</th>
                    <th className="p-3 text-right">Discounts</th>
                    <th className="p-3 text-right">Fees</th>
                    <th className="p-3 text-right">Refunds</th>
                    <th className="p-3 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {salesData.daily.map((d) => (
                    <tr key={d.date} className="hover:bg-paper/50">
                      <td className="p-3 font-medium">{d.date}</td>
                      <td className="p-3">{d.orders}</td>
                      <td className="p-3 text-right">{formatINR(d.grossPaise)}</td>
                      <td className="p-3 text-right text-clay">-{formatINR(d.discountPaise)}</td>
                      <td className="p-3 text-right">+{formatINR(d.shippingCodFeesPaise)}</td>
                      <td className="p-3 text-right text-clay">-{formatINR(d.refundsPaise)}</td>
                      <td className="p-3 text-right font-bold">{formatINR(d.netPaise)}</td>
                    </tr>
                  ))}
                  {salesData.daily.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-stone-dark">
                        No orders recorded during this IST period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "gst" && gstData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Tax Invoices Issued</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{gstData.taxInvoiceCount}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Receipts Issued</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{gstData.receiptCount}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Taxable Value</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{formatINR(gstData.total.taxablePaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Tax Payable (Net)</div>
                <div className="text-2xl font-mono mt-1 text-moss font-bold">{formatINR(gstData.total.totalTaxPaise)}</div>
              </div>
            </div>

            <div className="border border-stone bg-white overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase">
                  <tr>
                    <th className="p-3">GST Rate</th>
                    <th className="p-3 text-right">Taxable Value</th>
                    <th className="p-3 text-right">CGST</th>
                    <th className="p-3 text-right">SGST</th>
                    <th className="p-3 text-right">IGST</th>
                    <th className="p-3 text-right">Total Tax</th>
                    <th className="p-3 text-right">Net Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {gstData.rates.map((r) => (
                    <tr key={r.ratePercent} className="hover:bg-paper/50">
                      <td className="p-3 font-medium">{r.ratePercent}%</td>
                      <td className="p-3 text-right">{formatINR(r.taxablePaise)}</td>
                      <td className="p-3 text-right">{formatINR(r.cgstPaise)}</td>
                      <td className="p-3 text-right">{formatINR(r.sgstPaise)}</td>
                      <td className="p-3 text-right">{formatINR(r.igstPaise)}</td>
                      <td className="p-3 text-right font-semibold">{formatINR(r.totalTaxPaise)}</td>
                      <td className="p-3 text-right font-bold">{formatINR(r.netPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gstData.creditNotes.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-mono uppercase tracking-wider text-stone-dark font-medium">
                  Credit Notes Subtracted ({gstData.creditNotes.length})
                </h3>
                <div className="border border-stone bg-white overflow-x-auto">
                  <table className="w-full text-xs font-mono text-left">
                    <thead className="bg-paper border-b border-stone text-stone-dark uppercase">
                      <tr>
                        <th className="p-2">Date (IST)</th>
                        <th className="p-2">Credit Note #</th>
                        <th className="p-2">Invoice #</th>
                        <th className="p-2 text-right">Tax Reversal</th>
                        <th className="p-2 text-right">Total Credited</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone/40">
                      {gstData.creditNotes.map((cn) => (
                        <tr key={cn.id}>
                          <td className="p-2">{cn.date}</td>
                          <td className="p-2 font-medium">{cn.creditNoteNumber}</td>
                          <td className="p-2">{cn.invoiceNumber}</td>
                          <td className="p-2 text-right text-clay">-{formatINR(cn.totalTaxPaise)}</td>
                          <td className="p-2 text-right text-clay">-{formatINR(cn.totalPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "returns" && returnsData && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Requests Raised</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{returnsData.requests}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Refunds Processed</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{returnsData.refunded}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Refunded</div>
                <div className="text-2xl font-mono mt-1 font-semibold text-clay">{formatINR(returnsData.refundTotalPaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Avg Turnaround</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{returnsData.avgApprovalToRefundHours}h</div>
                {returnsData.slaBreaches > 0 && (
                  <div className="text-[10.5px] text-clay mt-1">{returnsData.slaBreaches} SLA breaches (&gt;48h)</div>
                )}
              </div>
            </div>

            <div className="border border-stone bg-white p-4 space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-stone-dark">Top Return Reasons</h4>
              <div className="divide-y divide-stone/40">
                {returnsData.topReasonCodes.map((rc) => (
                  <div key={rc.code} className="py-2 flex justify-between text-xs font-mono">
                    <span className="text-ink font-medium">{rc.code}</span>
                    <span className="text-stone-dark">{rc.count} requests</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "stock" && stockData && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total SKUs / Variants</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{stockData.totalVariants}</div>
                <div className="text-[10.5px] text-stone-dark mt-1">{stockData.totalStockUnits} total units in stock</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Low Stock Alerts</div>
                <div className="text-2xl font-mono mt-1 font-semibold text-amber-800">{stockData.lowStockCount}</div>
                <div className="text-[10.5px] text-stone-dark mt-1">Threshold: &le; {stockData.lowStockThreshold} units</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Out of Stock</div>
                <div className="text-2xl font-mono mt-1 font-semibold text-clay">{stockData.outOfStockCount}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Retail Value</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{formatINR(stockData.totalValueListPaise)}</div>
                {isOwner && stockData.totalValueCostPaise !== null && (
                  <div className="text-[10.5px] text-stone-dark mt-1">Cost: {formatINR(stockData.totalValueCostPaise)}</div>
                )}
              </div>
            </div>

            <div className="border border-stone bg-white overflow-x-auto max-h-[500px]">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase sticky top-0">
                  <tr>
                    <th className="p-2.5">Product</th>
                    <th className="p-2.5">Color</th>
                    <th className="p-2.5">Size</th>
                    <th className="p-2.5">SKU</th>
                    <th className="p-2.5 text-right">Stock</th>
                    <th className="p-2.5 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {stockData.variants.slice(0, 100).map((v) => (
                    <tr key={v.variantId} className="hover:bg-paper/50">
                      <td className="p-2.5 font-medium">{v.productName}</td>
                      <td className="p-2.5">{v.color || "—"}</td>
                      <td className="p-2.5">{v.size}</td>
                      <td className="p-2.5 text-stone-dark">{v.sku || "—"}</td>
                      <td className={`p-2.5 text-right font-bold ${v.stock === 0 ? "text-clay" : v.isLowStock ? "text-amber-800" : "text-ink"}`}>
                        {v.stock}
                      </td>
                      <td className="p-2.5 text-right">{formatINR(v.pricePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "offers" && offersData && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Redemptions</div>
                <div className="text-2xl font-mono mt-1 font-semibold">{offersData.totalRedemptions}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Discounts Distributed</div>
                <div className="text-2xl font-mono mt-1 font-semibold text-clay">{formatINR(offersData.totalDiscountPaise)}</div>
              </div>
            </div>

            <div className="border border-stone bg-white overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase">
                  <tr>
                    <th className="p-3">Offer Name</th>
                    <th className="p-3">Coupon Code</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-right">Redemptions</th>
                    <th className="p-3 text-right">Discount Given</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {offersData.offers.map((o) => (
                    <tr key={o.offerId} className="hover:bg-paper/50">
                      <td className="p-3 font-medium">{o.name}</td>
                      <td className="p-3 font-mono text-stone-dark">{o.code || "Automatic"}</td>
                      <td className="p-3">{o.kind}</td>
                      <td className="p-3 text-right">{o.redemptions}</td>
                      <td className="p-3 text-right font-bold text-clay">-{formatINR(o.totalDiscountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "margin" && getMarginTabState(isOwner, marginData, marginError) === "error" && (
          <div
            role="alert"
            className="p-6 bg-red-50 border border-red-200 text-red-900 text-sm font-mono"
          >
            Could not load margin data. Please refresh the page or try again later.
          </div>
        )}

        {activeTab === "margin" && getMarginTabState(isOwner, marginData, marginError) === "data" && marginData && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Revenue</div>
                <div className="text-2xl font-mono mt-1">{formatINR(marginData.totalRevenuePaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Total Cost of Goods</div>
                <div className="text-2xl font-mono mt-1 text-stone-dark">{formatINR(marginData.totalCostPaise)}</div>
              </div>
              <div className="p-4 bg-white border border-stone">
                <div className="text-[11px] font-mono text-stone-dark uppercase">Gross Margin</div>
                <div className="text-2xl font-mono mt-1 text-moss font-bold">
                  {formatINR(marginData.grossMarginPaise)} ({marginData.marginPercent}%)
                </div>
              </div>
            </div>

            <div className="border border-stone bg-white overflow-x-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="bg-paper border-b border-stone text-stone-dark uppercase">
                  <tr>
                    <th className="p-3">Product</th>
                    <th className="p-3 text-right">Units Sold</th>
                    <th className="p-3 text-right">Revenue</th>
                    <th className="p-3 text-right">Cost</th>
                    <th className="p-3 text-right">Gross Profit</th>
                    <th className="p-3 text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone/40">
                  {marginData.items.map((it) => (
                    <tr key={it.productSlug} className="hover:bg-paper/50">
                      <td className="p-3 font-medium">{it.productName}</td>
                      <td className="p-3 text-right">{it.unitsSold}</td>
                      <td className="p-3 text-right">{formatINR(it.revenuePaise)}</td>
                      <td className="p-3 text-right text-stone-dark">{formatINR(it.costPaise)}</td>
                      <td className="p-3 text-right font-semibold text-moss">{formatINR(it.marginPaise)}</td>
                      <td className="p-3 text-right font-bold">{it.marginPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
