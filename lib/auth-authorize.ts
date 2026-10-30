import { prisma } from "@/lib/prisma";
import { verifyOtp } from "@/lib/otp";
import { createSession, computeUaHash, computeIpPrefix } from "@/lib/sessions";
import { Prisma } from "@prisma/client";
import { escapeHtml } from "@/lib/escape-html";
import { sendStaffSignInAlertEmail } from "@/lib/email";
import { writeAudit } from "@/lib/audit";

export interface AuthContext {
  ip?: string;
  userAgent?: string;
}

export async function authorizeCustomerOtp(
  credentials: Record<string, unknown> | undefined,
  ctx?: AuthContext
): Promise<{ id: string; email: string; name: string; role: string; sid: string } | null> {
  const identifier = credentials?.identifier as string | undefined;
  const code = credentials?.code as string | undefined;
  if (!identifier || !code) return null;

  const ip = ctx?.ip || "unknown";
  const userAgent = ctx?.userAgent || "";

  const verifyResult = await verifyOtp(identifier, code, ip);
  if (!verifyResult.success || !verifyResult.identifier) {
    return null;
  }

  const verifiedIdentifier = verifyResult.identifier;
  const isPhone = verifyResult.channel === "PHONE" || !verifiedIdentifier.includes("@");

  let user = isPhone
    ? await prisma.user.findUnique({ where: { phone: verifiedIdentifier } })
    : await prisma.user.findUnique({ where: { email: verifiedIdentifier } });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          role: "CUSTOMER",
          status: "ACTIVE",
          phone: isPhone ? verifiedIdentifier : null,
          email: !isPhone ? verifiedIdentifier : null,
          name: "",
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        user = isPhone
          ? await prisma.user.findUnique({ where: { phone: verifiedIdentifier } })
          : await prisma.user.findUnique({ where: { email: verifiedIdentifier } });
      } else {
        throw err;
      }
    }
  }

  if (!user || user.role !== "CUSTOMER" || user.status !== "ACTIVE") {
    return null;
  }

  const { sid } = await createSession({
    userId: user.id,
    role: user.role,
    userAgent,
    ip,
  });

  return {
    id: user.id,
    email: user.email || "",
    name: user.name || "",
    role: user.role,
    sid,
  };
}

export async function authorizeStaffOtp(
  credentials: Record<string, unknown> | undefined,
  ctx?: AuthContext
): Promise<{ id: string; email: string; name: string; role: string; sid: string } | null> {
  const email = credentials?.email as string | undefined;
  const code = credentials?.code as string | undefined;
  if (!email || !code) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const ip = ctx?.ip || "unknown";
  const userAgent = ctx?.userAgent || "";

  // 1. Verify OTP
  const verifyResult = await verifyOtp(normalizedEmail, code, ip);
  if (!verifyResult.success || !verifyResult.identifier) {
    return null;
  }

  // 2. Require an ACTIVE StaffAllowlist row
  const allowlistEntry = await prisma.staffAllowlist.findUnique({
    where: { email: normalizedEmail },
  });

  if (!allowlistEntry || !allowlistEntry.active) {
    return null;
  }

  // 3. Find or create the User with the allowlist role
  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          role: allowlistEntry.role,
          status: "ACTIVE",
          name: normalizedEmail.split("@")[0],
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      } else {
        throw err;
      }
    }
  } else if (user.role !== allowlistEntry.role) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: allowlistEntry.role },
    });
  }

  if (!user || user.status !== "ACTIVE") {
    return null;
  }

  // Check for new-device alert (Phase 7)
  const uaHash = computeUaHash(userAgent);
  const existingSessionWithUa = await prisma.session.findFirst({
    where: { userId: user.id, uaHash },
  });

  // 4. Create Session with staff lifetimes
  const { sid } = await createSession({
    userId: user.id,
    role: user.role,
    userAgent,
    ip,
  });

  // If first time with this uaHash, send new sign-in alert email
  if (!existingSessionWithUa && user.email) {
    const ipPrefix = computeIpPrefix(ip);
    const signinTime = new Date().toUTCString();
    const truncatedUa = escapeHtml((userAgent || "Unknown Device").slice(0, 150));
    try {
      await sendStaffSignInAlertEmail({
        to: user.email,
        name: user.name || "Staff Member",
        time: signinTime,
        userAgent: truncatedUa,
        ipPrefix,
      });
    } catch (emailErr) {
      console.error("[Staff Login Alert Email Error]:", emailErr);
      // Non-blocking
    }
  }

  // Audit staff login
  try {
    await writeAudit({
      actorId: user.id,
      action: "staff.login",
      entity: "Session",
      entityId: sid,
      ip,
    });
  } catch (auditErr) {
    console.error("[Staff Login Audit Error]:", auditErr);
  }

  return {
    id: user.id,
    email: user.email || "",
    name: user.name || "",
    role: user.role,
    sid,
  };
}

