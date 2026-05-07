# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────────────
# Multi-stage build: install deps + compile TS in `builder`, copy only what
# the runtime needs into the final image. node:22-bookworm-slim ships with a
# recent SQLite for `sqlite3` prebuilds; build tools are present in case the
# prebuild for the host arch is missing and pnpm has to compile from source.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json ./
RUN pnpm install --no-frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Drop dev deps before copying to runtime stage.
RUN pnpm prune --prod

# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# tini reaps zombies + forwards signals so SIGTERM from `docker stop` reaches Node.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=7000 \
    BIND_HOST=0.0.0.0

EXPOSE 7000
VOLUME ["/app/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
