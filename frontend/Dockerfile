# Dashboard image.
#
# NEXT_PUBLIC_* values are inlined into the CLIENT bundle at BUILD time, not read
# at runtime — the browser, not the server, is what calls the API. So the public
# API and WebSocket URLs must be supplied as build args; setting them only in
# docker-compose `environment:` would leave the shipped bundle pointing at
# http://localhost:3001 and the dashboard would fail for every remote visitor.
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --no-frozen-lockfile

# Same-origin defaults: the reverse proxy serves the dashboard and forwards
# /api and /ws to the engine, so relative URLs work without knowing the domain.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN pnpm --filter @zig/dashboard build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# `output: "standalone"` produces a server plus exactly the modules it reaches.
# static/ and public/ are NOT included by Next and must be copied separately.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public

USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
