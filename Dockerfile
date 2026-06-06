# node:22-slim (Debian) — ships OpenSSL, which Prisma needs. (alpine/musl trips
# Prisma's libssl detection.)
#
# Single build stage: install with the source present so pnpm creates the
# per-package node_modules (and backend's postinstall `prisma generate` finds the
# schema), then compile every workspace package. The runner carries the whole
# built workspace so the pnpm symlinks + generated Prisma client resolve at runtime.
FROM node:22-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --no-frozen-lockfile
# esbuild bundles the engine into dist/main.js, inlining the @zig/* workspace
# packages from source — no cross-package tsc resolution, no symlink dependence.
RUN pnpm --filter @zig/core-engine build

FROM node:22-slim@sha256:7af03b14a13c8cdd38e45058fd957bf00a72bbe17feac43b1c15a689c029c732 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
USER node
CMD ["node", "backend/dist/main.js"]
