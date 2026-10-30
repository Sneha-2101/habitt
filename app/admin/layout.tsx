import { requireStaff, UnauthorizedError, ForbiddenError } from "@/lib/guards";
import { redirect } from "next/navigation";
import Link from "next/link";
import AdminSignOutEverywhere from "./AdminSignOutEverywhere";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user;
  try {
    user = await requireStaff();
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      redirect("/staff/login");
    }
    throw err;
  }

  const isOwner = user.role === "OWNER";

  return (
    <div className="min-h-screen bg-paper">
      <nav className="border-b border-stone bg-white px-7 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <Link href="/admin" className="font-display font-semibold text-ink text-base">
              Habitt Admin
            </Link>
            <div className="flex space-x-4 text-xs tracking-wider uppercase text-stone-dark font-medium">
              <Link href="/admin" className="hover:text-ink transition-colors">
                Dashboard
              </Link>
              <Link href="/admin/orders" className="hover:text-ink transition-colors">
                Orders
              </Link>
              <Link href="/admin/products" className="hover:text-ink transition-colors">
                Products
              </Link>
              <Link href="/admin/returns" className="hover:text-ink transition-colors">
                Returns
              </Link>
              <Link href="/admin/settings" className="hover:text-ink transition-colors">
                Settings
              </Link>
              {isOwner && (
                <Link href="/admin/team" className="hover:text-ink transition-colors">
                  Team
                </Link>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4 text-xs text-stone-dark">
            <span>
              {user.email || user.name} ({user.role})
            </span>
            <AdminSignOutEverywhere />
            <Link href="/" className="underline hover:text-ink">
              Storefront &rarr;
            </Link>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}
