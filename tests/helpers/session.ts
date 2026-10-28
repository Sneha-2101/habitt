import { encode } from "next-auth/jwt";

export async function createSessionCookie(
  userId: string,
  role: "CUSTOMER" | "STAFF" | "OWNER" = "CUSTOMER"
): Promise<{ cookieName: string; cookieValue: string; headerValue: string }> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set in environment");
  }

  const cookieName = "authjs.session-token";
  const salt = cookieName;

  const token = {
    sub: userId,
    id: userId,
    role: role,
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
  };
}
