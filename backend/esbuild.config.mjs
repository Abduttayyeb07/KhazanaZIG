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

await build({
  entryPoints: [path.join(backendDir, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: path.join(backendDir, "dist/main.js"),
  packages: "external",
  alias: {
    "@zig/shared-types": path.join(repoRoot, "packages/shared-types/src/index.ts"),
    "@zig/logger": path.join(repoRoot, "packages/logger/src/index.ts"),
    "@zig/config": path.join(repoRoot, "packages/config/src/index.ts"),
  },
  logLevel: "info",
});

console.log("esbuild: backend bundled -> dist/main.js (workspace packages inlined)");
