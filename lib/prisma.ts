import { PrismaClient } from "@prisma/client";

function createPrismaClient() {
  return new PrismaClient({
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
