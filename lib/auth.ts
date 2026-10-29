import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import { verifyOtp } from "@/lib/otp";
import { getClientIp } from "@/lib/client-ip";
import { authConfig } from "@/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // 1 & 2: OTP Verification Provider (Phone or Email)
    Credentials({
      id: "otp",
      name: "OTP Code",
      credentials: {
        identifier: { label: "Identifier", type: "text" },
        code: { label: "OTP Code", type: "text" },
      },
      authorize: async (credentials, req) => {
        const identifier = credentials?.identifier as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!identifier || !code) return null;

        let ip = "unknown";
        if (req && "headers" in req && req.headers) {
          ip = getClientIp(req.headers as unknown as Headers);
        } else {
          try {
            const h = await headers();
            ip = getClientIp(h);
          } catch {
            // Context without headers
          }
        }

        const verifyResult = await verifyOtp(identifier, code, ip);
        if (!verifyResult.success || !verifyResult.identifier) {
          return null;
        }

        const verifiedIdentifier = verifyResult.identifier;
        const isPhone = verifyResult.channel === "PHONE" || !verifiedIdentifier.includes("@");

        // Lookup existing user by phone or email
        let user = isPhone
          ? await prisma.user.findUnique({ where: { phone: verifiedIdentifier } })
          : await prisma.user.findUnique({ where: { email: verifiedIdentifier } });

        // Auto-create CUSTOMER user if new identifier
        if (!user) {
          user = await prisma.user.create({
            data: {
              role: "CUSTOMER",
              phone: isPhone ? verifiedIdentifier : null,
              email: !isPhone ? verifiedIdentifier : null,
              name: "",
            },
          });
        }

        return {
          id: user.id,
          email: user.email || "",
          name: user.name || "",
          role: user.role,
        };
      },
    }),

    // 3: Password Provider (Staff / Legacy)
    Credentials({
      id: "credentials",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
        });
        if (!user) return null;

        // Guard against null passwordHash for OTP-only accounts
        if (!user.passwordHash) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email || "", name: user.name || "", role: user.role };
      },
    }),
  ],
});
