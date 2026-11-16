import { auth } from "@/lib/auth";
import HeaderClient from "./HeaderClient";
import CartSync from "./CartSync";

export default async function Header() {
  let isStaff = false;
  let isLoggedIn = false;
  let userId: string | null = null;
  try {
    const session = await auth(); // display only
    const userObj = session?.user as { id?: string; role?: string } | undefined;
    isStaff = userObj?.role === "STAFF" || userObj?.role === "OWNER";
    isLoggedIn = !!session?.user;
    userId = userObj?.id ?? null;
  } catch (err) {
    console.error("Header auth lookup error:", err);
  }
  return (
    <>
      <HeaderClient isStaff={isStaff} isLoggedIn={isLoggedIn} />
      <CartSync isSignedIn={isLoggedIn} userId={userId} />
    </>
  );
}
