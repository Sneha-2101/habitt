import { PrismaClient } from "@prisma/client";

// Global singleton to prevent pool exhaustion across tests
const globalForPrisma = global as unknown as { testPrisma: PrismaClient };

export const prisma = globalForPrisma.testPrisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.testPrisma = prisma;
