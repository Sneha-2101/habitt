import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../helpers/prisma";
import { cleanupM1TestRows, createTestUser, genId } from "../helpers/fixtures";
import { createSession } from "@/lib/sessions";
import { runBreakGlass } from "../../scripts/break-glass-owner.mjs";

describe("T123: Break-glass owner recovery CLI", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    await cleanupM1TestRows();
  });

  it("dry run changes nothing; apply promotes CUSTOMER to OWNER, creates active OWNER allowlist row, and writes audit", async () => {
    const email = `${genId("m1test_bg_cust")}@example.test`;
    try {
      const user = await createTestUser({
        id: genId("m1test_bg_u1"),
        email,
        role: "CUSTOMER",
      });

      const dry = await runBreakGlass({
        prisma,
        email,
        apply: false,
      });
      expect(dry.ok).toBe(true);
      expect(dry.dryRun).toBe(true);
      expect(dry.exitCode).toBe(0);

      const afterDry = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(afterDry.role).toBe("CUSTOMER");
      expect(await prisma.staffAllowlist.findUnique({ where: { email } })).toBeNull();

      const applied = await runBreakGlass({
        prisma,
        email,
        apply: true,
        confirm: async (target: string) => target,
      });
      expect(applied.ok).toBe(true);
      expect(applied.dryRun).toBe(false);
      expect(applied.exitCode).toBe(0);

      const afterApply = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(afterApply.role).toBe("OWNER");

      const allowlist = await prisma.staffAllowlist.findUnique({ where: { email } });
      expect(allowlist).not.toBeNull();
      expect(allowlist?.role).toBe("OWNER");
      expect(allowlist?.active).toBe(true);
      expect(allowlist?.removedAt).toBeNull();

      const audits = await prisma.auditLog.findMany({
        where: { entityId: user.id, action: "break_glass.owner_promote" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].actorId).toBe(user.id);
      expect(audits[0].meta).toEqual({
        via: "cli",
        previousRole: "CUSTOMER",
        allowlist: "created",
      });
    } finally {
      await prisma.staffAllowlist.deleteMany({ where: { email } });
    }
  });

  it("promotes user with inactive STAFF allowlist row to active OWNER", async () => {
    const email = `${genId("m1test_bg_inact")}@example.test`;
    try {
      const user = await createTestUser({
        id: genId("m1test_bg_u_inact"),
        email,
        role: "CUSTOMER",
      });
      await prisma.staffAllowlist.create({
        data: {
          id: genId("m1test_al_inact"),
          email,
          role: "STAFF",
          active: false,
          removedAt: new Date(),
        },
      });

      const res = await runBreakGlass({
        prisma,
        email,
        apply: true,
        confirm: async (t: string) => t,
      });
      expect(res.ok).toBe(true);

      const allowlist = await prisma.staffAllowlist.findUniqueOrThrow({ where: { email } });
      expect(allowlist.role).toBe("OWNER");
      expect(allowlist.active).toBe(true);
      expect(allowlist.removedAt).toBeNull();

      const audits = await prisma.auditLog.findMany({
        where: { entityId: user.id, action: "break_glass.owner_promote" },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].meta).toEqual({
        via: "cli",
        previousRole: "CUSTOMER",
        allowlist: "updated",
      });
    } finally {
      await prisma.staffAllowlist.deleteMany({ where: { email } });
    }
  });

  it("with --demote-email, demotes other OWNER to CUSTOMER, deactivates its allowlist row, revokes all its sessions, and leaves unrelated user untouched", async () => {
    const targetEmail = `${genId("m1test_bg_new")}@example.test`;
    const demoteEmail = `${genId("m1test_bg_old")}@example.test`;
    const otherEmail = `${genId("m1test_bg_other")}@example.test`;

    try {
      const target = await createTestUser({
        id: genId("m1test_bg_t"),
        email: targetEmail,
        role: "STAFF",
      });
      const demote = await createTestUser({
        id: genId("m1test_bg_d"),
        email: demoteEmail,
        role: "OWNER",
      });
      const unrelated = await createTestUser({
        id: genId("m1test_bg_o"),
        email: otherEmail,
        role: "STAFF",
      });

      await prisma.staffAllowlist.create({
        data: {
          id: genId("m1test_al_d"),
          email: demoteEmail,
          role: "OWNER",
          active: true,
        },
      });

      await createSession({ userId: demote.id, role: "OWNER" });
      await createSession({ userId: demote.id, role: "OWNER" });
      await createSession({ userId: unrelated.id, role: "STAFF" });

      const res = await runBreakGlass({
        prisma,
        email: targetEmail,
        demoteEmail,
        apply: true,
        confirm: async (e: string) => e,
      });
      expect(res.ok).toBe(true);
      expect(res.sessionsRevoked).toBe(2);

      const updatedTarget = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      const updatedDemote = await prisma.user.findUniqueOrThrow({ where: { id: demote.id } });
      const updatedOther = await prisma.user.findUniqueOrThrow({ where: { id: unrelated.id } });
      expect(updatedTarget.role).toBe("OWNER");
      expect(updatedDemote.role).toBe("CUSTOMER");
      expect(updatedOther.role).toBe("STAFF");

      const demoteAllowlist = await prisma.staffAllowlist.findUniqueOrThrow({
        where: { email: demoteEmail },
      });
      expect(demoteAllowlist.active).toBe(false);
      expect(demoteAllowlist.removedAt).not.toBeNull();

      const demoteSessions = await prisma.session.findMany({ where: { userId: demote.id } });
      const otherSessions = await prisma.session.findMany({ where: { userId: unrelated.id } });
      expect(demoteSessions).toHaveLength(0);
      expect(otherSessions).toHaveLength(1);

      const demoteAudits = await prisma.auditLog.findMany({
        where: { entityId: demote.id, action: "break_glass.owner_demote" },
      });
      expect(demoteAudits).toHaveLength(1);
      expect(demoteAudits[0].actorId).toBe(target.id);
      expect(demoteAudits[0].meta).toEqual({
        via: "cli",
        previousRole: "OWNER",
        allowlist: "deactivated",
      });
    } finally {
      await prisma.staffAllowlist.deleteMany({
        where: { email: { in: [targetEmail, demoteEmail] } },
      });
    }
  });

  it("demotes user with no allowlist row without creating one", async () => {
    const targetEmail = `${genId("m1test_bg_t2")}@example.test`;
    const demoteEmail = `${genId("m1test_bg_d2")}@example.test`;

    try {
      await createTestUser({ id: genId("m1test_bg_t2u"), email: targetEmail, role: "CUSTOMER" });
      const demote = await createTestUser({
        id: genId("m1test_bg_d2u"),
        email: demoteEmail,
        role: "OWNER",
      });

      const res = await runBreakGlass({
        prisma,
        email: targetEmail,
        demoteEmail,
        apply: true,
        confirm: async (e: string) => e,
      });
      expect(res.ok).toBe(true);
      expect(await prisma.staffAllowlist.findUnique({ where: { email: demoteEmail } })).toBeNull();

      const demoteAudits = await prisma.auditLog.findMany({
        where: { entityId: demote.id, action: "break_glass.owner_demote" },
      });
      expect(demoteAudits).toHaveLength(1);
      expect(demoteAudits[0].meta).toEqual({
        via: "cli",
        previousRole: "OWNER",
        allowlist: "none",
      });
    } finally {
      await prisma.staffAllowlist.deleteMany({
        where: { email: { in: [targetEmail, demoteEmail] } },
      });
    }
  });

  it("refuses nonexistent email and confirm mismatch without modifying DB", async () => {
    const missing = await runBreakGlass({
      prisma,
      email: "m1test_nonexistent@example.test",
      apply: true,
      confirm: async (e: string) => e,
    });
    expect(missing.ok).toBe(false);
    expect(missing.exitCode).toBe(1);

    const email = `${genId("m1test_bg_mismatch")}@example.test`;
    const user = await createTestUser({
      id: genId("m1test_bg_mm"),
      email,
      role: "CUSTOMER",
    });

    const mismatch = await runBreakGlass({
      prisma,
      email,
      apply: true,
      confirm: async () => "wrong@example.test",
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.exitCode).toBe(1);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.role).toBe("CUSTOMER");
  });
});
