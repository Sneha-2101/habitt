"use server";

import { requireUser } from "@/lib/guards";
import { revokeSession, revokeAllSessions } from "@/lib/sessions";
import { writeAudit } from "@/lib/audit";

export async function signOutEverywhereAction(): Promise<{ success: boolean }> {
  const user = await requireUser();

  await revokeAllSessions(user.id);

  await writeAudit({
    actorId: user.id,
    action: "session.sign_out_everywhere",
    entity: "User",
    entityId: user.id,
  });

  try {
    const { signOut } = await import("@/lib/auth");
    await signOut({ redirect: false });
  } catch {
    // Auth.js signOut might throw redirect in server action
  }

  return { success: true };
}

export async function signOutThisDeviceAction(): Promise<{ success: boolean }> {
  const user = await requireUser();

  if (user.sid) {
    await revokeSession(user.sid);
    await writeAudit({
      actorId: user.id,
      action: "session.sign_out",
      entity: "Session",
      entityId: user.sid,
    });
  }

  try {
    const { signOut } = await import("@/lib/auth");
    await signOut({ redirect: false });
  } catch {
    // Auth.js signOut might throw redirect in server action
  }

  return { success: true };
}
