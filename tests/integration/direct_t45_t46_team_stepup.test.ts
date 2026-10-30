import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
import { prisma } from "../helpers/prisma";
import { createTestUser, cleanupM1TestRows, genId } from "../helpers/fixtures";
import { addStaff, changeStaffRole, removeStaff } from "@/lib/actions/team";
import { confirmStepUpAction } from "@/lib/actions/step-up";
import { createSession } from "@/lib/sessions";
import { StepUpRequiredError } from "@/lib/guards";
import * as guardsModule from "@/lib/guards";
import * as sessionsModule from "@/lib/sessions";
import * as otpModule from "@/lib/otp";

describe("T45, T46: Team actions, advisory locking, and step-up authentication", () => {
  beforeEach(async () => {
    await cleanupM1TestRows();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupM1TestRows();
  });

  it("T46: confirmStepUpAction sets stepUpAt on current session only; stale (>10 min) rejected by requireFreshStepUp", async () => {
    const user = await createTestUser({ email: `${genId("m1test_stepup")}@habitt.test`, role: "STAFF" });
    const s1 = await createSession({ userId: user.id, role: "STAFF" });
    const s2 = await createSession({ userId: user.id, role: "STAFF" });

    // Mock getSessionUser to return session s1
    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      phone: user.phone,
      sid: s1.sid,
      stepUpAt: null,
    });

    vi.spyOn(otpModule, "verifyOtp").mockResolvedValue({
      success: true,
      identifier: user.email!,
      channel: "EMAIL",
    });

    // Confirm step-up for current session
    await confirmStepUpAction("123456");

    // Session s1 should have stepUpAt set
    const session1 = await prisma.session.findUnique({ where: { id: s1.sid } });
    expect(session1?.stepUpAt).not.toBeNull();

    // Session s2 should remain without stepUpAt
    const session2 = await prisma.session.findUnique({ where: { id: s2.sid } });
    expect(session2?.stepUpAt).toBeNull();

    // Stale step-up check (> 10 min): set stepUpAt to 15 min ago
    await prisma.session.update({
      where: { id: s1.sid },
      data: { stepUpAt: new Date(Date.now() - 15 * 60 * 1000) },
    });

    vi.spyOn(sessionsModule, "getSessionUser").mockResolvedValue({
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
      phone: user.phone,
      sid: s1.sid,
      stepUpAt: new Date(Date.now() - 15 * 60 * 1000),
    });

    await expect(guardsModule.requireFreshStepUp()).rejects.toThrow(StepUpRequiredError);
  });

  it("T45: team actions require step-up, protect last owner, prevent self-removal, handle concurrent mutual removal", async () => {
    const owner1 = await createTestUser({ email: `${genId("m1test_o1")}@habitt.test`, role: "OWNER" });
    const owner2 = await createTestUser({ email: `${genId("m1test_o2")}@habitt.test`, role: "OWNER" });
    const staff1 = await createTestUser({ email: `${genId("m1test_s1")}@habitt.test`, role: "STAFF" });

    const allow1 = await prisma.staffAllowlist.create({
      data: { id: genId("m1test_allow"), email: owner1.email!, role: "OWNER", active: true },
    });
    const allow2 = await prisma.staffAllowlist.create({
      data: { id: genId("m1test_allow"), email: owner2.email!, role: "OWNER", active: true },
    });
    const allowStaff = await prisma.staffAllowlist.create({
      data: { id: genId("m1test_allow"), email: staff1.email!, role: "STAFF", active: true },
    });

    const sStaff = await createSession({ userId: staff1.id, role: "STAFF" });

    // Step-up required mock: first without step-up
    vi.spyOn(guardsModule, "requireRole").mockResolvedValue({
      id: owner1.id,
      email: owner1.email,
      role: "OWNER",
    });
    vi.spyOn(guardsModule, "requireFreshStepUp").mockRejectedValueOnce(new StepUpRequiredError());

    await expect(addStaff(`${genId("m1test_new")}@habitt.test`, "STAFF")).rejects.toThrow(StepUpRequiredError);

    // Now mock valid fresh step-up
    vi.spyOn(guardsModule, "requireFreshStepUp").mockResolvedValue({
      id: owner1.id,
      email: owner1.email,
      role: "OWNER",
    });

    // 1. Cannot remove self
    await expect(removeStaff(allow1.id)).rejects.toThrow("Cannot remove or demote yourself");

    // 2. Change role test
    await changeStaffRole(allowStaff.id, "OWNER");
    const promoted = await prisma.staffAllowlist.findUnique({ where: { id: allowStaff.id } });
    expect(promoted?.role).toBe("OWNER");

    // Change back to STAFF
    await changeStaffRole(allowStaff.id, "STAFF");

    // 3. Removal downgrades role and revokes sessions
    await removeStaff(allowStaff.id);
    const updatedStaffUser = await prisma.user.findUnique({ where: { id: staff1.id } });
    expect(updatedStaffUser?.role).toBe("CUSTOMER");

    const staffSession = await prisma.session.findUnique({ where: { id: sStaff.sid } });
    expect(staffSession?.revokedAt).not.toBeNull();

    // Verify audit log written
    const auditRemove = await prisma.auditLog.findFirst({
      where: { action: "team.remove", entityId: allowStaff.id },
    });
    expect(auditRemove).not.toBeNull();

    // 3. Two owners removing each other concurrently leave at least one active owner
    // owner 1 tries to remove owner 2, owner 2 tries to remove owner 1
    const p1 = (async () => {
      vi.spyOn(guardsModule, "requireRole").mockResolvedValue({ id: owner1.id, email: owner1.email, role: "OWNER" });
      return removeStaff(allow2.id).catch((err) => err);
    })();

    const p2 = (async () => {
      vi.spyOn(guardsModule, "requireRole").mockResolvedValue({ id: owner2.id, email: owner2.email, role: "OWNER" });
      return removeStaff(allow1.id).catch((err) => err);
    })();

    await Promise.all([p1, p2]);

    // Count remaining active owners in database: must be at least 1!
    const remainingActiveOwners = await prisma.staffAllowlist.count({
      where: { role: "OWNER", active: true },
    });
    expect(remainingActiveOwners).toBeGreaterThanOrEqual(1);
  });
});
