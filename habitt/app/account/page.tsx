import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/money";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?redirect=/account");

  const orders = await prisma.order.findMany({
    where: { userId: (session.user as { id: string }).id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="max-w-lg mx-auto px-7 py-14">
      <h1 className="font-display text-2xl mb-1">Your account</h1>
      <p className="text-[13px] text-stone-dark mb-8">{session.user.email}</p>

      <h2 className="text-sm font-medium mb-3">Order history</h2>
      <div className="border border-stone mb-8">
        {orders.map((o) => (
          <div key={o.id} className="flex justify-between px-4 py-3 text-[13px] border-b border-stone last:border-0">
            <span className="font-mono">{o.displayId}</span>
            <span>{o.status}</span>
            <span className="font-mono">{formatINR(o.total)}</span>
          </div>
        ))}
        {orders.length === 0 && <p className="px-4 py-6 text-sm text-stone-dark">No orders yet.</p>}
      </div>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit" className="text-[12.5px] underline text-clay">
          Sign out
        </button>
      </form>
    </main>
  );
}
