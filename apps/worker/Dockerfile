# ═══════════════════════════════════════════════════════════════════════════════
# WMS Worker Dockerfile (Production)
# ═══════════════════════════════════════════════════════════════════════════════

FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @wms/db exec prisma generate

RUN pnpm --filter @wms/types build
RUN pnpm --filter @wms/config build
RUN pnpm --filter @wms/auth build
RUN pnpm --filter @wms/db build
RUN pnpm --filter @wms/pubsub build
RUN pnpm --filter @wms/queue build
RUN pnpm --filter @wms/domain build
RUN pnpm --filter worker build

# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

ENV NODE_ENV=production

COPY --from=builder /app ./

RUN pnpm prune --prod

WORKDIR /app/apps/worker

CMD ["node", "dist/worker.js"]