import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const config = (phase: string): NextConfig => ({
  reactStrictMode: true,
  // Keep dev assets intact when a production build runs in this checkout.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
});

export default config;
