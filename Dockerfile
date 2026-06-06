FROM node:22-alpine AS installer
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/logger/package.json       ./packages/logger/package.json
COPY packages/config/package.json       ./packages/config/package.json
COPY backend/package.json               ./backend/package.json

RUN pnpm install --no-frozen-lockfile

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY --from=installer /app/node_modules        ./node_modules
COPY --from=installer /app/package.json        ./package.json
COPY --from=installer /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY packages/ ./packages/
COPY backend/  ./backend/

RUN pnpm --filter @zig/shared-types build && \
    pnpm --filter @zig/logger         build && \
    pnpm --filter @zig/config         build && \
    pnpm --filter @zig/core-engine    build

RUN pnpm --filter @zig/core-engine deploy --prod /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /deploy .
USER node
CMD ["node", "dist/main.js"]
