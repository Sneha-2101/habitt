import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import { verifyOtp } from "@/lib/otp";

// One login system supporting:
// 1. Phone + OTP (id: "otp")
// 2. Email + OTP (id: "otp")
// 3. Email + Password (id: "credentials", for STAFF/OWNER & legacy password accounts)
const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!secret) {
  throw new Error(
    "AUTH_SECRET or NEXTAUTH_SECRET environment variable is missing. Please set AUTH_SECRET or NEXTAUTH_SECRET in environment variables."
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // 1 & 2: OTP Verification Provider (Phone or Email)
    Credentials({
      id: "otp",
      name: "OTP Code",
      credentials: {
        identifier: { label: "Identifier", type: "text" },
        code: { label: "OTP Code", type: "text" },
      },
      authorize: async (credentials) => {
        const identifier = credentials?.identifier as string | undefined;
        const code = credentials?.code as string | undefined;
        if (!identifier || !code) return null;

        const verifyResult = await verifyOtp(identifier, code);
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
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id =
          (token.id as string) || (token.sub as string);
        (session.user as { id?: string; role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
