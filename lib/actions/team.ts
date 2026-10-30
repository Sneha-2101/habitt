"use server";

import { requireRole, requireFreshStepUp } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { revokeAllSessions } from "@/lib/sessions";
import { writeAudit } from "@/lib/audit";
import { Role } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const emailSchema = z.string().trim().email("Please enter a valid email address.");

export async function addStaff(
  rawEmail: string,
  role: Role
): Promise<{ success: boolean }> {
  const currentUser = await requireRole("OWNER");
  await requireFreshStepUp();

  const email = emailSchema.parse(rawEmail).toLowerCase();

  if (role !== "STAFF" && role !== "OWNER") {
    throw new Error("Invalid role. Role must be STAFF or OWNER.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Acquire transaction-level advisory lock
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-allowlist'))`;

    // Upsert allowlist entry
    const entry = await tx.staffAllowlist.upsert({
      where: { email },
      update: {
        role,
        active: true,
        removedAt: null,
        addedById: currentUser.id,
      },
      create: {
        email,
        role,
        active: true,
        addedById: currentUser.id,
      },
    });

    // Update or create user record
    const existingUser = await tx.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: { role },
      });
    }

    return entry;
  });

  await writeAudit({
    actorId: currentUser.id,
    action: "team.add",
    entity: "StaffAllowlist",
    entityId: result.id,
    meta: { email, role },
  });

  revalidatePath("/admin/team");
  return { success: true };
}

export async function changeStaffRole(
  id: string,
  newRole: Role
): Promise<{ success: boolean }> {
  const currentUser = await requireRole("OWNER");
  await requireFreshStepUp();

  if (newRole !== "STAFF" && newRole !== "OWNER") {
    throw new Error("Invalid role. Role must be STAFF or OWNER.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Acquire transaction-level advisory lock
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-allowlist'))`;

    const entry = await tx.staffAllowlist.findUnique({
      where: { id },
    });

    if (!entry) {
      throw new Error("Staff member not found.");
    }

    // Cannot demote yourself
    if (entry.email === currentUser.email && newRole !== "OWNER") {
      throw new Error("Cannot remove or demote yourself.");
    }

    // If demoting an owner, verify there is at least one other active owner remaining
    if (entry.role === "OWNER" && newRole !== "OWNER") {
      const otherOwnersCount = await tx.staffAllowlist.count({
        where: {
          role: "OWNER",
          active: true,
          id: { not: id },
        },
      });

      if (otherOwnersCount < 1) {
        throw new Error("There must always be at least one active owner.");
      }
    }

    const updated = await tx.staffAllowlist.update({
      where: { id },
      data: {
        role: newRole,
        active: true,
        removedAt: null,
      },
    });

    // Update User record if exists
    const targetUser = await tx.user.findUnique({
      where: { email: entry.email },
    });

    if (targetUser) {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { role: newRole },
      });
    }

    return updated;
  });

  await writeAudit({
    actorId: currentUser.id,
    action: "team.change_role",
    entity: "StaffAllowlist",
    entityId: result.id,
    meta: { email: result.email, newRole },
  });

  revalidatePath("/admin/team");
  return { success: true };
}

export async function removeStaff(id: string): Promise<{ success: boolean }> {
  const currentUser = await requireRole("OWNER");
  await requireFreshStepUp();

  const { entry, targetUserId } = await prisma.$transaction(async (tx) => {
    // Acquire transaction-level advisory lock
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff-allowlist'))`;

    const allowlistRow = await tx.staffAllowlist.findUnique({
      where: { id },
    });

    if (!allowlistRow) {
      throw new Error("Staff member not found.");
    }

    // Cannot remove yourself
    if (allowlistRow.email === currentUser.email) {
      throw new Error("Cannot remove or demote yourself.");
    }

    // If removing an owner, verify there is at least one other active owner remaining
    if (allowlistRow.role === "OWNER") {
      const otherOwnersCount = await tx.staffAllowlist.count({
        where: {
          role: "OWNER",
          active: true,
          id: { not: id },
        },
      });

      if (otherOwnersCount < 1) {
        throw new Error("There must always be at least one active owner.");
      }
    }

    const updated = await tx.staffAllowlist.update({
      where: { id },
      data: {
        active: false,
        removedAt: new Date(),
      },
    });

    const targetUser = await tx.user.findUnique({
      where: { email: allowlistRow.email },
    });

    if (targetUser) {
      await tx.user.update({
        where: { id: targetUser.id },
        data: { role: "CUSTOMER" },
      });
    }

    return { entry: updated, targetUserId: targetUser?.id };
  });

  // Revoke all sessions for removed user
  if (targetUserId) {
    await revokeAllSessions(targetUserId);
  }

  await writeAudit({
    actorId: currentUser.id,
    action: "team.remove",
    entity: "StaffAllowlist",
    entityId: entry.id,
    meta: { email: entry.email },
  });

  revalidatePath("/admin/team");
  return { success: true };
}

