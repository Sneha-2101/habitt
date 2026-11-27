import { PrismaClient } from "@prisma/client";
import { withBuildConnectionLimit } from "@/lib/db-url";

function createPrismaClient() {
  const url = withBuildConnectionLimit(process.env.DATABASE_URL, process.env.NEXT_PHASE);
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    omit: {
      product: {
        costPrice: true,
      },
    },
  });
}

// Standard Next.js dev-mode singleton so hot-reload doesn't spawn new clients.
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
