import { auth } from "@/lib/auth";
import HeaderClient from "./HeaderClient";

export default async function Header() {
  let isStaff = false;
  let isLoggedIn = false;

  try {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    isStaff = role === "STAFF" || role === "OWNER";
    isLoggedIn = !!session?.user;
  } catch (err) {
    console.error("Header auth lookup error:", err);
  }

  return <HeaderClient isStaff={isStaff} isLoggedIn={isLoggedIn} />;
}
