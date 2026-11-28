import { requireStaff } from "@/lib/guards";
import {
  salesReport,
  gstSummary,
  returnsReport,
  stockReport,
  offersUsageReport,
  marginReport,
  parseIstDateRange,
} from "@/lib/admin/reports";
import ReportsClient from "./ReportsClient";
import { safeErrorSummary } from "@/lib/log-redact";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string }>;
}) {
  const staff = await requireStaff();
  const isOwner = staff.role === "OWNER";

  const resolved = await searchParams;
  const tab = resolved.tab || "sales";
  const { fromIst, toIst } = parseIstDateRange(resolved.from, resolved.to);

  let marginError = false;
  const [salesData, gstData, returnsData, stockData, offersData, marginData] =
    await Promise.all([
      salesReport(fromIst, toIst).catch((err) => {
        console.error("Sales report error:", safeErrorSummary(err));
        return null;
      }),
      gstSummary(fromIst, toIst).catch((err) => {
        console.error("GST summary error:", safeErrorSummary(err));
        return null;
      }),
      returnsReport(fromIst, toIst).catch((err) => {
        console.error("Returns report error:", safeErrorSummary(err));
        return null;
      }),
      stockReport(staff.role).catch((err) => {
        console.error("Stock report error:", safeErrorSummary(err));
        return null;
      }),
      offersUsageReport(fromIst, toIst).catch((err) => {
        console.error("Offers usage report error:", safeErrorSummary(err));
        return null;
      }),
      isOwner
        ? marginReport(fromIst, toIst, staff.role).catch((err) => {
            console.error("Margin report error:", safeErrorSummary(err));
            marginError = true;
            return null;
          })
        : Promise.resolve(null),
    ]);

  return (
    <main className="max-w-6xl mx-auto px-7 py-9 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="font-display text-2xl font-medium text-ink">Reports & Business Analytics</h1>
          <p className="text-xs font-mono text-stone-dark mt-1">
            Financial, inventory, GST compliance, and operations metrics calculated in Indian Standard Time (IST).
          </p>
        </div>
      </div>

      <ReportsClient
        initialTab={tab}
        from={fromIst}
        to={toIst}
        isOwner={isOwner}
        salesData={salesData}
        gstData={gstData}
        returnsData={returnsData}
        stockData={stockData}
        offersData={offersData}
        marginData={marginData}
        marginError={marginError}
      />
    </main>
  );
}
