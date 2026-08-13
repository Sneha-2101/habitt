import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";
import { revalidatePath } from "next/cache";
import type { OrderStatus } from "@prisma/client";

async function updateStatus(orderId: string, formData: FormData) {
  "use server";
  const status = formData.get("status") as OrderStatus;
  await prisma.order.update({ where: { id: orderId }, data: { status } });
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const order = await prisma.order.findUnique({
    where: { id: resolvedParams.id },
    include: { items: true },
  });
  if (!order) notFound();

  const updateWithId = updateStatus.bind(null, order.id);
  const address = order.shippingAddress as { line1: string; city: string; state: string; pincode: string };

  return (
    <main className="px-7 py-9 max-w-2xl mx-auto">
      <h1 className="font-display text-2xl mb-1">{order.displayId}</h1>
      <p className="text-[13px] text-stone-dark mb-7">
        {order.customerName} · {order.customerPhone}
      </p>

      <div className="border border-stone p-4 mb-6">
        {order.items.map((i) => (
          <div key={i.id} className="flex justify-between text-[13px] mb-2">
            <span>{i.name} — {i.size} × {i.qty}</span>
            <span className="font-mono">{formatINR(i.unitPrice * i.qty)}</span>
          </div>
        ))}
        <div className="flex justify-between font-semibold pt-2 mt-2 border-t border-stone text-[13.5px]">
          <span>Total</span>
          <span className="font-mono">{formatINR(order.total)}</span>
        </div>
      </div>

      <div className="border border-stone p-4 mb-6 text-[13px]">
        <div className="text-[11px] tracking-[0.06em] text-stone-dark mb-2">SHIPPING ADDRESS</div>
        {address.line1}, {address.city}, {address.state} — {address.pincode}
      </div>

      {order.razorpayPaymentId && (
        <p className="text-[12px] text-stone-dark mb-6 font-mono">
          Razorpay payment: {order.razorpayPaymentId}
        </p>
      )}

      <form action={updateWithId} className="flex gap-3 items-center">
        <select name="status" defaultValue={order.status} className="px-3.5 py-2.5 border border-stone text-[13px]">
          {["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "FAILED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="submit" className="px-5 py-2.5 bg-ink text-paper text-[12.5px]">
          Update status
        </button>
      </form>
    </main>
  );
}
