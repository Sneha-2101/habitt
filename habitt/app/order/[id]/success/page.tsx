import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";

export default async function OrderSuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const order = await prisma.order.findUnique({ where: { id: resolvedParams.id } });
  if (!order) notFound();

  return (
    <main className="max-w-md mx-auto px-7 py-24 text-center">
      <div className="w-13 h-13 rounded-full bg-moss flex items-center justify-center mx-auto mb-5" style={{ width: 52, height: 52 }}>
        <span className="text-paper text-xl">✓</span>
      </div>
      <h1 className="font-display text-2xl mb-2">Order placed</h1>
      <p className="text-[13.5px] text-ink/60 mb-1">Order ID</p>
      <p className="font-mono text-[15px] mb-6">{order.displayId}</p>
      <p className="text-[13px] text-ink/60 mb-8">
        Total paid: <span className="font-mono">{formatINR(order.total)}</span>
        <br />
        A confirmation has been sent to {order.customerEmail || order.customerPhone}.
      </p>
      <a href="/shop" className="inline-block px-7 py-3 bg-ink text-paper text-[13px] tracking-[0.04em]">
        Continue shopping
      </a>
    </main>
  );
}
