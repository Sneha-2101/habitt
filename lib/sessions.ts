import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { Role, Session, User } from "@prisma/client";

export const CUSTOMER_IDLE_MS = 365 * 24 * 60 * 60 * 1000;
export const STAFF_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const STAFF_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function computeUaHash(ua?: string | null): string {
  return crypto.createHash("sha256").update(ua || "").digest("hex");
}

export function computeIpPrefix(ip?: string | null): string {
  if (!ip || ip === "unknown") return "unknown";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    if (parts.length >= 3) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return ip;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}:${parts[2]}::/48`;
    }
    return ip;
  }
  return ip;
}

export interface CreateSessionParams {
  userId: string;
  role: Role;
  userAgent?: string | null;
  ip?: string | null;
  deviceLabel?: string | null;
}

export async function createSession({
  userId,
  role,
  userAgent,
  ip,
  deviceLabel,
}: CreateSessionParams): Promise<{ sid: string }> {
  const now = new Date();
  const isCustomer = role === "CUSTOMER";
  const expiresAt = new Date(now.getTime() + (isCustomer ? CUSTOMER_IDLE_MS : STAFF_IDLE_MS));
  const absoluteExpiresAt = isCustomer ? null : new Date(now.getTime() + STAFF_ABSOLUTE_MS);
  const uaHash = computeUaHash(userAgent);
  const ipPrefix = computeIpPrefix(ip);

  const session = await prisma.session.create({
    data: {
      userId,
      role,
      lastSeenAt: now,
      expiresAt,
      absoluteExpiresAt,
      uaHash,
      ipPrefix,
      deviceLabel: deviceLabel || null,
    },
  });

  return { sid: session.id };
}

export async function validateSessionById(
  sid: string
): Promise<{ session: Session; user: User } | null> {
  const now = new Date();
  const record = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });

  if (!record) return null;
  if (record.revokedAt !== null) return null;
  if (record.expiresAt <= now) return null;
  if (record.absoluteExpiresAt !== null && record.absoluteExpiresAt <= now) return null;
  if (record.user.status !== "ACTIVE") return null;

  // Touch session if interval has passed
  if (now.getTime() - record.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const isCustomer = record.user.role === "CUSTOMER";
    let newExpiresAt = new Date(now.getTime() + (isCustomer ? CUSTOMER_IDLE_MS : STAFF_IDLE_MS));
    if (record.absoluteExpiresAt && newExpiresAt > record.absoluteExpiresAt) {
      newExpiresAt = record.absoluteExpiresAt;
    }

    await prisma.session.update({
      where: { id: record.id },
      data: {
        lastSeenAt: now,
        expiresAt: newExpiresAt,
      },
    });

    record.lastSeenAt = now;
    record.expiresAt = newExpiresAt;
  }

  return { session: record, user: record.user };
}

export interface SessionUser {
  id: string;
  role: Role;
  email: string | null;
  name: string | null;
  phone: string | null;
  sid: string;
  stepUpAt: Date | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const { auth } = await import("@/lib/auth");
  const s = await auth();
  const sid = (s?.user as { sid?: string } | undefined)?.sid;
  if (!sid) return null;

  const valid = await validateSessionById(sid);
  if (!valid) return null;

  return {
    id: valid.user.id,
    role: valid.user.role,
    email: valid.user.email,
    name: valid.user.name,
    phone: valid.user.phone,
    sid: valid.session.id,
    stepUpAt: valid.session.stepUpAt,
  };
}

export async function revokeSession(sid: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sid, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptSid?: string): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSid ? { id: { not: exceptSid } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
