import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Backend bundler.
//
// Bundles the engine into a single dist/main.js and inlines the @zig/*
// workspace packages from source. This makes the build and runtime independent
// of pnpm workspace symlink layout, which was failing on the server.
//
// npm dependencies stay external and resolve from node_modules at runtime, so
// native/threaded packages such as Prisma and pino behave normally.

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(backendDir, "..");

// Operator CLIs ship alongside the engine. Creating the first dashboard user is a
// deployment step, not a development one, so it must not depend on the dev
// toolchain: the runtime image never builds the @zig/* packages to dist (esbuild
// inlines them from source), so running the .ts entry with tsx inside the
// container fails to resolve "@zig/config".
const entries = [
  { in: "src/main.ts", out: "main" },
  { in: "src/auth/add-user.ts", out: "add-user" },
];

const alias = {
  "@zig/shared-types": path.join(repoRoot, "packages/shared-types/src/index.ts"),
  "@zig/logger": path.join(repoRoot, "packages/logger/src/index.ts"),
  "@zig/config": path.join(repoRoot, "packages/config/src/index.ts"),
};

for (const entry of entries) {
  await build({
    entryPoints: [path.join(backendDir, entry.in)],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: path.join(backendDir, `dist/${entry.out}.js`),
    packages: "external",
    alias,
    logLevel: "info",
  });
}

console.log(`esbuild: bundled -> ${entries.map((e) => `dist/${e.out}.js`).join(", ")} (workspace packages inlined)`);
