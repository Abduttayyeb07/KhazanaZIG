# syntax=docker/dockerfile:1
#
# Dashboard image.
#
# NEXT_PUBLIC_* values are inlined into the CLIENT bundle at BUILD time, not read
# at runtime - the browser, not the server, is what calls the API. So the public
# API and WebSocket URLs must be supplied as build args; setting them only in
# docker-compose `environment:` would leave the shipped bundle pointing at
# http://localhost:3001 and the dashboard would fail for every remote visitor.
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY . .
# --mount=type=cache persists pnpm's content-addressable store BETWEEN builds
# (a plain COPY . . + install re-downloads/re-links every package on every
# build - this only touches what actually changed in the lockfile).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile

# Same-origin defaults: the reverse proxy serves the dashboard and forwards
# /api and /ws to the engine, so relative URLs work without knowing the domain.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Next's own build cache (webpack/SWC module cache + prior page traces) is what
# actually makes this step slow to redo from scratch every time - normally it
# lives in .next/cache and would just get discarded when the build stage exits.
# Mounting it as a persistent cache means only pages that actually changed get
# recompiled on the next build, instead of every route + every static page.
RUN --mount=type=cache,id=next-cache,target=/app/frontend/.next/cache \
    pnpm --filter @zig/dashboard build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# `output: "standalone"` produces a server plus exactly the modules it reaches.
# In a pnpm workspace it lands as standalone/frontend/server.js alongside a
# hoisted standalone/node_modules, so copying the directory's CONTENTS to /app
# puts the server at /app/frontend/server.js - which is what CMD runs.
#
# static/ is deliberately excluded by Next from standalone and must be copied
# separately. There is no public/ directory in this project; adding a COPY for
# one that does not exist fails the build outright rather than being skipped.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static

USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
