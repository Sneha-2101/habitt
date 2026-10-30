import type { NextAuthConfig } from "next-auth";

const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!secret) {
  throw new Error(
    "AUTH_SECRET or NEXTAUTH_SECRET environment variable is missing. Please set AUTH_SECRET or NEXTAUTH_SECRET in environment variables."
  );
}

const isProduction = process.env.NODE_ENV === "production";

export const authConfig: NextAuthConfig = {
  secret,
  session: {
    strategy: "jwt",
    maxAge: 365 * 24 * 60 * 60, // 365 days
  },
  pages: { signIn: "/login" },
  providers: [],
  cookies: {
    sessionToken: {
      name: isProduction ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
        token.sid = (user as { sid?: string }).sid;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const u = session.user as { id?: string; role?: string; sid?: string };
        u.id = (token.id as string) || (token.sub as string);
        u.role = token.role as string;
        u.sid = token.sid as string;
      }
      return session;
    },
  },
};
