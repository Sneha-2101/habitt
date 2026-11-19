import { PrismaClient } from "@prisma/client";

function createTestPrismaClient() {
  return new PrismaClient({
    omit: {
      product: {
        costPrice: true,
      },
    },
  });
}

// Global singleton to prevent pool exhaustion across tests
const globalForPrisma = global as unknown as { testPrisma?: ReturnType<typeof createTestPrismaClient> };

export const prisma = globalForPrisma.testPrisma ?? createTestPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.testPrisma = prisma;
