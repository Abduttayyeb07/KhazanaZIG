import { PrismaClient } from "@prisma/client";
import type { Logger } from "@zig/logger";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// Verifies DB connectivity at startup. Returns false (does not throw) so the
// engine can degrade to market-data-only mode if Postgres is unreachable.
export async function connectDatabase(log: Logger): Promise<boolean> {
  const dbLog = log.child({ module: "database" });
  try {
    await getPrisma().$connect();
    dbLog.info("Database connected");
    return true;
  } catch (err) {
    dbLog.error({ err }, "Database connection failed — persistence disabled");
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}
