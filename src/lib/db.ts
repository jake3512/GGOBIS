import { PrismaClient } from "@/generated/prisma";

// Reuse a single PrismaClient across hot reloads in dev so we don't exhaust
// SQLite connections when Next.js recompiles API routes.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
