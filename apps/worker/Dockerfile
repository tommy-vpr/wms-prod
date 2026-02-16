# ═══════════════════════════════════════════════════════════════════════════════
# WMS Worker Dockerfile (Production)
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Base with pnpm
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Install ALL dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/auth/package.json ./packages/auth/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/domain/package.json ./packages/domain/
COPY packages/pubsub/package.json ./packages/pubsub/
COPY packages/queue/package.json ./packages/queue/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Build everything
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN pnpm --filter @wms/db db:generate

# Build all packages
RUN pnpm --filter @wms/types build
RUN pnpm --filter @wms/config build
RUN pnpm --filter @wms/auth build
RUN pnpm --filter @wms/db build
RUN pnpm --filter @wms/pubsub build
RUN pnpm --filter @wms/queue build
RUN pnpm --filter @wms/domain build
RUN pnpm --filter worker build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

# Copy package files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Copy built packages
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist

COPY --from=builder /app/packages/config/package.json ./packages/config/
COPY --from=builder /app/packages/config/dist ./packages/config/dist

COPY --from=builder /app/packages/auth/package.json ./packages/auth/
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist

COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma

COPY --from=builder /app/packages/pubsub/package.json ./packages/pubsub/
COPY --from=builder /app/packages/pubsub/dist ./packages/pubsub/dist

COPY --from=builder /app/packages/queue/package.json ./packages/queue/
COPY --from=builder /app/packages/queue/dist ./packages/queue/dist

COPY --from=builder /app/packages/domain/package.json ./packages/domain/
COPY --from=builder /app/packages/domain/dist ./packages/domain/dist

COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Copy node_modules
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/apps/worker

CMD ["node", "dist/worker.js"]
