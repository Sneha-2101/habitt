import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows } from "../helpers/fixtures";
import {
  createSession,
  validateSessionById,
  revokeSession,
} from "@/lib/sessions";
import { signOutEverywhereAction } from "@/lib/actions/sessions";
import { requireStaff, ForbiddenError } from "@/lib/guards";
import * as sessionsModule from "@/lib/sessions";
import { vi } from "vitest";

describe("T38, T40, T41: Sessions lifecycle, role enforcement, and sign out everywhere", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T38: validateSessionById rejects revoked, idle-expired, absolute-expired, and BLOCKED-user sessions", async () => {
    const user = await createTestUser({ role: "CUSTOMER" });
    const now = new Date();

    // 1. Valid session
    const { sid: validSid } = await createSession({
      userId: user.id,
      role: "CUSTOMER",
    });
    const valid = await validateSessionById(validSid);
    expect(valid).not.toBeNull();
    expect(valid?.user.id).toBe(user.id);
    expect(valid?.user.role).toBe("CUSTOMER");

    // 2. Revoked session
    const { sid: revokedSid } = await createSession({
      userId: user.id,
      role: "CUSTOMER",
    });
    await revokeSession(revokedSid);
    const revoked = await validateSessionById(revokedSid);
    expect(revoked).toBeNull();

    // 3. Idle-expired session
    const { sid: idleExpiredSid } = await createSession({
      userId: user.id,
      role: "CUSTOMER",
    });
    await prisma.session.update({
      where: { id: idleExpiredSid },
      data: { expiresAt: new Date(now.getTime() - 1000) },
    });
    const idleExpired = await validateSessionById(idleExpiredSid);
    expect(idleExpired).toBeNull();

    // 4. Absolute-expired session
    const { sid: absExpiredSid } = await createSession({
      userId: user.id,
      role: "STAFF",
    });
    await prisma.session.update({
      where: { id: absExpiredSid },
      data: { absoluteExpiresAt: new Date(now.getTime() - 1000) },
    });
    const absExpired = await validateSessionById(absExpiredSid);
    expect(absExpired).toBeNull();

    // 5. BLOCKED user session
    const blockedUser = await createTestUser({ role: "CUSTOMER", status: "BLOCKED" });
    const { sid: blockedSid } = await createSession({
      userId: blockedUser.id,
      role: "CUSTOMER",
    });
    const blockedRes = await validateSessionById(blockedSid);
    expect(blockedRes).toBeNull();
  });

  it("T40: role change takes effect — valid session claiming STAFF but DB role CUSTOMER throws Forbidden", async () => {
    // Create user with CUSTOMER role in DB
    const user = await createTestUser({ role: "CUSTOMER" });

    // Create session
    const { sid } = await createSession({
      userId: user.id,
      role: "STAFF", // Session record might have had STAFF at creation
    });

    // Mock getSessionUser to return this session's DB user
    vi.spyOn(sessionsModule, "getSessionUser").mockImplementation(async () => {
      const valid = await validateSessionById(sid);
      if (!valid) return null;
      return {
        id: valid.user.id,
        role: valid.user.role, // ALWAYS FROM DB USER ROW: CUSTOMER
        email: valid.user.email,
        name: valid.user.name,
        phone: valid.user.phone,
        sid: valid.session.id,
        stepUpAt: valid.session.stepUpAt,
      };
    });

    // requireStaff should throw ForbiddenError because DB user role is CUSTOMER
    await expect(requireStaff()).rejects.toThrow(ForbiddenError);
  });

  it("T41: signOutEverywhere revokes every session of the user, not other users'", async () => {
    const user1 = await createTestUser({ role: "CUSTOMER" });
    const user2 = await createTestUser({ role: "CUSTOMER" });

    const s1 = await createSession({ userId: user1.id, role: "CUSTOMER" });
    const s2 = await createSession({ userId: user1.id, role: "CUSTOMER" });
    const otherS = await createSession({ userId: user2.id, role: "CUSTOMER" });

    expect(s1.sid).toBeDefined();
    expect(s2.sid).toBeDefined();

    // Mock getSessionUser for user1
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user1.id,
      role: user1.role,
      email: user1.email,
      name: user1.name,
      phone: user1.phone,
      sid: s1.sid,
      stepUpAt: null,
    });

    await signOutEverywhereAction();

    // Both sessions for user1 should be revoked
    const user1Sessions = await prisma.session.findMany({
      where: { userId: user1.id },
    });
    expect(user1Sessions).toHaveLength(2);
    expect(user1Sessions.every((s) => s.revokedAt !== null)).toBe(true);

    // user2 session should remain active
    const user2Session = await prisma.session.findUnique({
      where: { id: otherS.sid },
    });
    expect(user2Session?.revokedAt).toBeNull();
  });
});
