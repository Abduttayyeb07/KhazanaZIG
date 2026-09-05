import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const config = (phase: string): NextConfig => ({
  reactStrictMode: true,
  // Emits .next/standalone with a self-contained server + only the node_modules
  // actually reached. Without it the runtime image needs the full dependency
  // tree, which for Next is far larger than the app itself.
  output: "standalone",
  // Keep dev assets intact when a production build runs in this checkout.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});

export default config;
