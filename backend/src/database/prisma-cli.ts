import { spawnSync } from "node:child_process";
// Importing @zig/config runs dotenv against the monorepo-root .env, which is the
// whole point of this wrapper (see below).
import "@zig/config";

// ── Prisma CLI wrapper ──────────────────────────────────────────────────────────
//
// The Prisma CLI only auto-loads a .env from its own directory (backend/ or
// backend/prisma/). Our environment lives at the MONOREPO ROOT, loaded by
// @zig/config — so `prisma db push` failed with:
//
//   Error code: P1012
//   error: Environment variable not found: DATABASE_URL.
//
// The obvious workarounds are both bad: duplicating DATABASE_URL into a second .env
// invites the two copies to drift, and prefixing the variable on every invocation
// makes the documented command wrong on one shell or another.
//
// So: load the real environment first, then hand it to the Prisma CLI unchanged.
//   npm run prisma:push       → prisma db push
//   npm run prisma:generate   → prisma generate
// ──────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: tsx src/database/prisma-cli.ts <prisma args...>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Check the .env at the repository root.");
  process.exit(1);
}

// `prisma` resolves through node_modules/.bin; shell:true so Windows finds the .cmd shim.
const result = spawnSync("prisma", args, { stdio: "inherit", env: process.env, shell: true });
process.exit(result.status ?? 1);
