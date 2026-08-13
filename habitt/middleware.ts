import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  // /admin is reached by typing the URL directly — there's no nav button for
  // logged-out or customer users. STAFF/OWNER only.
  if (pathname.startsWith("/admin")) {
    if (!req.auth) {
      return NextResponse.redirect(new URL(`/login?redirect=${pathname}`, req.nextUrl.origin));
    }
    if (role !== "STAFF" && role !== "OWNER") {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
  }

  // Buying requires an account — anonymous visitors get bounced to /login
  // and sent back to checkout once they've signed in.
  if (pathname.startsWith("/checkout") && !req.auth) {
    return NextResponse.redirect(new URL("/login?redirect=/checkout", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/admin/:path*", "/checkout/:path*"],
};
