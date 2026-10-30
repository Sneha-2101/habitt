import { requireRole } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const currentUser = await requireRole("OWNER");

  const entries = await prisma.staffAllowlist.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="min-h-screen bg-paper pb-16">
      <TeamClient
        entries={entries.map((e) => ({
          id: e.id,
          email: e.email,
          role: e.role,
          active: e.active,
          createdAt: e.createdAt.toISOString(),
          removedAt: e.removedAt ? e.removedAt.toISOString() : null,
        }))}
        currentUserEmail={currentUser.email || ""}
      />
    </main>
  );
}

