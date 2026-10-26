import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";
import TrackPurchasePixel from "@/components/TrackPurchasePixel";

export default async function OrderSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const order = await prisma.order.findUnique({
    where: { id: resolvedParams.id },
    include: {
      statusEvents: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) notFound();

  return (
    <main className="max-w-lg mx-auto px-4 sm:px-7 py-16 text-center space-y-8">
      <TrackPurchasePixel orderId={order.displayId} totalRupees={order.total / 100} />
      <div>
        <div className="w-13 h-13 rounded-full bg-moss flex items-center justify-center mx-auto mb-4" style={{ width: 52, height: 52 }}>
          <span className="text-paper text-xl">✓</span>
        </div>
        <h1 className="font-display text-2xl mb-1">Order Placed Successfully</h1>
        <p className="text-[13.5px] text-stone-dark">Order ID</p>
        <p className="font-mono text-base font-medium">{order.displayId}</p>
        <p className="text-[13px] text-stone-dark mt-2">
          Total paid: <span className="font-mono font-medium text-ink">{formatINR(order.total)}</span>
          <br />
          A confirmation email has been sent to {order.customerEmail || order.customerPhone}.
        </p>
      </div>

      {/* Visual Tracking Progress */}
      <div className="text-left p-6 border border-stone bg-white rounded-sm space-y-3">
        <h2 className="text-xs font-semibold text-stone-dark uppercase tracking-wider">Order & Shipping Status</h2>
        <OrderStatusTimeline
          currentStatus={order.status}
          events={order.statusEvents}
          courierName={order.courierName}
          awbNumber={order.awbNumber}
          trackingUrl={order.trackingUrl}
        />
      </div>

      <div>
        <a href="/shop" className="inline-block px-7 py-3 bg-ink text-paper text-[13px] font-medium tracking-[0.04em] hover:bg-opacity-90 transition-opacity">
          CONTINUE SHOPPING
        </a>
      </div>
    </main>
  );
}
