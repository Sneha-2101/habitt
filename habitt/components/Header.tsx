import { auth } from "@/lib/auth";
import HeaderClient from "./HeaderClient";

export default async function Header() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isStaff = role === "STAFF" || role === "OWNER";
  const isLoggedIn = !!session?.user;

  return <HeaderClient isStaff={isStaff} isLoggedIn={isLoggedIn} />;
}
