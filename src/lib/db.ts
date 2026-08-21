import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma";

// On Vercel, the deployed function bundle (including prisma/dev.db, built by
// `vercel-build`) is read-only. SQLite needs a writable directory even for
// plain reads (lock/journal files), so at cold start we copy the bundled
// snapshot into /tmp — the one writable, ephemeral path in that runtime —
// and point Prisma there instead. Everywhere else (local dev, `next start`
// on your own machine) this is a no-op and the schema's normal
// env("DATABASE_URL") is used.
function resolveDatasourceUrl(): string | undefined {
  if (!process.env.VERCEL) return undefined;

  const runtimePath = "/tmp/dev.db";
  if (!fs.existsSync(runtimePath)) {
    const bundledPath = path.join(process.cwd(), "prisma", "dev.db");
    fs.copyFileSync(bundledPath, runtimePath);
  }
  return `file:${runtimePath}`;
}

// Reuse a single PrismaClient across hot reloads in dev so we don't exhaust
// SQLite connections when Next.js recompiles API routes.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: resolveDatasourceUrl() });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
