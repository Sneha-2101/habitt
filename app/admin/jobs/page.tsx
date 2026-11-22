import { requireStaff } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";

async function retryFailedOutboxAction() {
  "use server";
  const user = await requireStaff();
  const res = await prisma.eventOutbox.updateMany({
    where: { status: "FAILED" },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
  });

  await writeAudit({
    actorId: user.id,
    action: "RETRY_OUTBOX",
    entity: "EventOutbox",
    entityId: "batch",
    meta: { resetCount: res.count },
  });

  revalidatePath("/admin/jobs");
}

export default async function AdminJobsPage() {
  await requireStaff();

  const [cronRuns, pendingCount, failedCount, sentCount, skippedCount] = await Promise.all([
    prisma.cronRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    prisma.eventOutbox.count({ where: { status: "PENDING" } }),
    prisma.eventOutbox.count({ where: { status: "FAILED" } }),
    prisma.eventOutbox.count({ where: { status: "SENT" } }),
    prisma.eventOutbox.count({ where: { status: "SKIPPED" } }),
  ]);

  return (
    <main className="max-w-6xl mx-auto px-7 py-8 space-y-8">
      <div>
        <h1 className="font-display font-semibold text-2xl text-ink">Background Jobs & Event Outbox</h1>
        <p className="text-xs text-stone-dark mt-1">
          Monitor scheduled cron run executions and outbound communication event queue.
        </p>
      </div>

      {/* Outbox Statistics Panel */}
      <section className="bg-white border border-stone p-6 rounded-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Event Outbox Status</h2>
            <p className="text-xs text-stone-dark">Outbound emails and messages queue</p>
          </div>
          <form action={retryFailedOutboxAction}>
            <button
              type="submit"
              disabled={failedCount === 0}
              className="px-4 py-2 bg-ink text-paper text-xs font-medium tracking-wide rounded-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-dark transition-colors"
            >
              Retry Failed Outbox ({failedCount})
            </button>
          </form>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="p-4 bg-paper border border-stone/60 rounded-sm">
            <span className="text-[11px] font-medium text-stone-dark uppercase tracking-wider block">Pending</span>
            <span className="text-2xl font-mono font-semibold text-ink mt-1 block">{pendingCount}</span>
          </div>
          <div className="p-4 bg-paper border border-stone/60 rounded-sm">
            <span className="text-[11px] font-medium text-stone-dark uppercase tracking-wider block">Failed</span>
            <span className={`text-2xl font-mono font-semibold mt-1 block ${failedCount > 0 ? "text-clay" : "text-ink"}`}>
              {failedCount}
            </span>
          </div>
          <div className="p-4 bg-paper border border-stone/60 rounded-sm">
            <span className="text-[11px] font-medium text-stone-dark uppercase tracking-wider block">Sent</span>
            <span className="text-2xl font-mono font-semibold text-emerald-800 mt-1 block">{sentCount}</span>
          </div>
          <div className="p-4 bg-paper border border-stone/60 rounded-sm">
            <span className="text-[11px] font-medium text-stone-dark uppercase tracking-wider block">Skipped</span>
            <span className="text-2xl font-mono font-semibold text-stone-dark mt-1 block">{skippedCount}</span>
          </div>
        </div>
      </section>

      {/* Cron Runs Table */}
      <section className="bg-white border border-stone rounded-sm overflow-hidden">
        <div className="p-6 border-b border-stone/60">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Cron Runs (Last 50)</h2>
          <p className="text-xs text-stone-dark mt-0.5">Automated background execution history</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper border-b border-stone text-stone-dark uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-6 py-3 font-semibold">Job</th>
                <th className="px-6 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 font-semibold">Started At</th>
                <th className="px-6 py-3 font-semibold">Finished At</th>
                <th className="px-6 py-3 font-semibold">Processed</th>
                <th className="px-6 py-3 font-semibold">Error / Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone/40">
              {cronRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-stone-dark">
                    No cron run history recorded yet.
                  </td>
                </tr>
              ) : (
                cronRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-paper/40 transition-colors">
                    <td className="px-6 py-3.5 font-medium font-mono text-ink">{run.job}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded-xs tracking-wider uppercase ${
                          run.ok
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {run.ok ? "SUCCESS" : "FAILED"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-mono text-stone-dark">
                      {new Date(run.startedAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-stone-dark">
                      {run.finishedAt ? new Date(run.finishedAt).toLocaleString("en-IN") : "In Progress"}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-ink">{run.itemsProcessed}</td>
                    <td className="px-6 py-3.5 text-clay font-mono max-w-xs truncate" title={run.error ?? ""}>
                      {run.error ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
