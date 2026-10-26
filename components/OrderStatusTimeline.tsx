import type { OrderStatus } from "@prisma/client";

interface StatusEvent {
  id: string;
  status: OrderStatus;
  note?: string | null;
  createdAt: Date;
}

interface OrderStatusTimelineProps {
  currentStatus: OrderStatus;
  events?: StatusEvent[];
  courierName?: string | null;
  awbNumber?: string | null;
  trackingUrl?: string | null;
}

const STAGES: { key: OrderStatus; label: string }[] = [
  { key: "PENDING", label: "Placed" },
  { key: "PAID", label: "Paid" },
  { key: "SHIPPED", label: "Shipped" },
  { key: "DELIVERED", label: "Delivered" },
];

export default function OrderStatusTimeline({
  currentStatus,
  events = [],
  courierName,
  awbNumber,
  trackingUrl,
}: OrderStatusTimelineProps) {
  if (currentStatus === "CANCELLED" || currentStatus === "FAILED") {
    return (
      <div className="p-4 border border-clay/30 bg-red-50 rounded-sm text-clay text-xs">
        <p className="font-semibold uppercase tracking-wider">Order {currentStatus}</p>
        <p className="mt-1 text-stone-dark">This order was {currentStatus.toLowerCase()}. Contact support for assistance.</p>
      </div>
    );
  }

  // Determine stage indexes reached
  const stageIndexMap: Record<string, number> = {
    PENDING: 0,
    PAID: 1,
    SHIPPED: 2,
    DELIVERED: 3,
  };

  const currentStageIndex = stageIndexMap[currentStatus] ?? 0;

  // Find event timestamps for each stage if available
  const getStageDate = (stageKey: OrderStatus) => {
    const event = events.find((e) => e.status === stageKey);
    return event?.createdAt ? new Date(event.createdAt) : null;
  };

  return (
    <div className="space-y-4">
      {/* Step Progress Bar */}
      <div className="relative flex items-center justify-between w-full py-2">
        {/* Background Connecting Line */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-0.5 bg-stone/40 z-0" />
        
        {/* Active Progress Line */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-800 transition-all duration-300 z-0"
          style={{
            width: `${(currentStageIndex / (STAGES.length - 1)) * 100}%`,
          }}
        />

        {STAGES.map((stage, idx) => {
          const isCompleted = idx <= currentStageIndex;
          const stageDate = getStageDate(stage.key);

          return (
            <div key={stage.key} className="relative z-10 flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                  isCompleted
                    ? "bg-emerald-800 text-white"
                    : "bg-paper border-2 border-stone text-stone-dark"
                }`}
              >
                {isCompleted ? "✓" : idx + 1}
              </div>
              <span
                className={`text-[11px] font-medium mt-1.5 ${
                  isCompleted ? "text-ink font-semibold" : "text-stone-dark"
                }`}
              >
                {stage.label}
              </span>
              {stageDate && (
                <span className="text-[10px] text-stone-dark font-mono">
                  {stageDate.toLocaleDateString("en-IN", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Courier & Tracking Details Box if Shipped */}
      {(courierName || awbNumber || trackingUrl) && (
        <div className="p-3.5 bg-paper border border-stone rounded-sm text-xs space-y-1">
          <p className="font-semibold text-ink">Shipment & Tracking</p>
          {courierName && <p className="text-stone-dark">Courier: <span className="text-ink font-medium">{courierName}</span></p>}
          {awbNumber && <p className="text-stone-dark">AWB / Tracking #: <span className="font-mono text-ink font-medium">{awbNumber}</span></p>}
          {trackingUrl && (
            <p className="pt-1">
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-ink underline hover:text-moss transition-colors"
              >
                Track Package →
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
