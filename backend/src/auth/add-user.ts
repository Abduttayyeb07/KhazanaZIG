// Importing @zig/config is what loads the monorepo-root .env into process.env
// (dotenv runs on that module's import). Prisma reads DATABASE_URL from there, so
// this import must stay even though the parsed config object is only used to fail
// fast on a malformed environment.
import { getConfig } from "@zig/config";
import { createLogger } from "@zig/logger";
import { connectDatabase, disconnectDatabase, getPrisma } from "../database/client.js";
import { AppUserStore } from "./user-store.js";

// ── Create / reset a dashboard user from the CLI ────────────────────────────────
//
// The Telegram `/addusers` command was the only way to create a dashboard login,
// which makes first-time local setup depend on a configured bot. This is the same
// AppUserStore.createUser() call, reachable without Telegram.
//
//   npm run add-user -- you@example.com                  (generates a password)
//   npm run add-user -- you@example.com YourPassword1    (sets one)
//
// Passwords must satisfy the same policy as every other path (>=12 chars, upper,
// lower, digit) — this script deliberately does NOT bypass validation. Re-running
// for an existing email RESETS that user's password.
// ──────────────────────────────────────────────────────────────────────────────

const log = createLogger("add-user", "error");

async function main(): Promise<void> {
  const [email, ...passwordParts] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: npm run add-user -- <email> [password]");
    process.exit(1);
  }

  getConfig(); // validates the environment and guarantees DATABASE_URL is loaded

  const connected = await connectDatabase(log);
  if (!connected) {
    console.error(
      "Database unavailable.\n" +
      "  1. Start Docker Desktop\n" +
      "  2. docker compose up -d postgres\n" +
      "  3. npm run prisma:push"
    );
    process.exit(1);
  }

  try {
    const store = new AppUserStore(getPrisma(), log);
    const created = await store.createUser(email, passwordParts.join(" ") || undefined);
    console.log(`\n  Dashboard user ready`);
    console.log(`    email    : ${created.email}`);
    console.log(`    password : ${created.password}`);
    console.log(
      created.generated
        ? `\n  Generated password — store it now, it is not recoverable (only its hash is kept).\n`
        : `\n  Password set from the command line.\n`
    );
  } catch (err) {
    console.error(`\n  Could not create user: ${err instanceof Error ? err.message : "unknown error"}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
