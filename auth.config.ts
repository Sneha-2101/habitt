import type { NextAuthConfig } from "next-auth";

const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!secret) {
  throw new Error(
    "AUTH_SECRET or NEXTAUTH_SECRET environment variable is missing. Please set AUTH_SECRET or NEXTAUTH_SECRET in environment variables."
  );
}

export const authConfig: NextAuthConfig = {
  secret,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
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
};
