# node:22-slim (Debian) — ships OpenSSL, which Prisma needs. (alpine/musl trips
# Prisma's libssl detection.)
#
# Single build stage: install with the source present so pnpm creates the
# per-package node_modules (and backend's postinstall `prisma generate` finds the
# schema), then compile every workspace package. The runner carries the whole
# built workspace so the pnpm symlinks + generated Prisma client resolve at runtime.
FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @zig/shared-types build && \
    pnpm --filter @zig/logger         build && \
    pnpm --filter @zig/config         build && \
    pnpm --filter @zig/core-engine    build

FROM node:22-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
USER node
CMD ["node", "backend/dist/main.js"]
