import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/client-ip";
import { authConfig } from "@/auth.config";
import { authorizeCustomerOtp, authorizeStaffOtp } from "@/lib/auth-authorize";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // 1: Customer OTP Provider (Phone or Email)
    Credentials({
      id: "otp",
      name: "OTP Code",
      credentials: {
        identifier: { label: "Identifier", type: "text" },
        code: { label: "OTP Code", type: "text" },
      },
      authorize: async (credentials, req) => {
        let ip = "unknown";
        let userAgent = "";
        if (req && "headers" in req && req.headers) {
          const h = req.headers as unknown as Headers;
          ip = getClientIp(h);
          if (typeof h.get === "function") {
            userAgent = h.get("user-agent") || "";
          }
        } else {
          try {
            const h = await headers();
            ip = getClientIp(h);
            userAgent = h.get("user-agent") || "";
          } catch {
            // Context without headers
          }
        }

        return authorizeCustomerOtp(credentials, { ip, userAgent });
      },
    }),

    // 2: Staff Email-OTP Provider
    Credentials({
      id: "staff-otp",
      name: "Staff OTP",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Code", type: "text" },
      },
      authorize: async (credentials, req) => {
        let ip = "unknown";
        let userAgent = "";
        if (req && "headers" in req && req.headers) {
          const h = req.headers as unknown as Headers;
          ip = getClientIp(h);
          if (typeof h.get === "function") {
            userAgent = h.get("user-agent") || "";
          }
        } else {
          try {
            const h = await headers();
            ip = getClientIp(h);
            userAgent = h.get("user-agent") || "";
          } catch {
            // Context without headers
          }
        }

        return authorizeStaffOtp(credentials, { ip, userAgent });
      },
    }),
  ],
});
