import { encode } from "next-auth/jwt";
import { prisma } from "./prisma";
import { createSession } from "@/lib/sessions";

export async function createSessionCookie(
  userId: string,
  role: "CUSTOMER" | "STAFF" | "OWNER" = "CUSTOMER"
): Promise<{ cookieName: string; cookieValue: string; headerValue: string; sid: string }> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set in environment");
  }

  // When a non-CUSTOMER role is passed, ensure that role is on the user row in DB (Amendment A4)
  if (role !== "CUSTOMER") {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { role },
    });
  }

  // Create real Session row in DB
  const { sid } = await createSession({
    userId,
    role,
    userAgent: "vitest-test-agent",
    ip: "127.0.0.1",
  });

  const cookieName = process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";
  const salt = cookieName;

  const token = {
    sub: userId,
    id: userId,
    role: role,
    sid: sid,
    email: `${userId}@habitt.test`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };

  const cookieValue = await encode({
    token,
    secret,
    salt,
  });

  return {
    cookieName,
    cookieValue,
    headerValue: `${cookieName}=${cookieValue}`,
    sid,
  };
}
