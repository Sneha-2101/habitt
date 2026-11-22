import { prisma } from "@/lib/prisma";

export async function withCronRun<T>(
  job: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = new Date();

  const run = await prisma.cronRun.create({
    data: {
      job,
      startedAt,
    },
  });

  try {
    const result = await fn();
    const finishedAt = new Date();

    let itemsProcessed: number | undefined;
    if (result && typeof result === "object") {
      const rec = result as Record<string, unknown>;
      if ("count" in rec && typeof rec.count === "number") {
        itemsProcessed = rec.count;
      } else if (
        "itemsProcessed" in rec &&
        typeof rec.itemsProcessed === "number"
      ) {
        itemsProcessed = rec.itemsProcessed;
      } else if (
        "processed" in rec &&
        typeof rec.processed === "number"
      ) {
        itemsProcessed = rec.processed;
      }
    }

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        ok: true,
        itemsProcessed: itemsProcessed ?? null,
      },
    });

    return result;
  } catch (err: unknown) {
    const finishedAt = new Date();
    const errorMsg =
      err instanceof Error ? err.message : "Cron execution failed";

    await prisma.cronRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        ok: false,
        error: errorMsg,
      },
    });

    throw err;
  }
}

