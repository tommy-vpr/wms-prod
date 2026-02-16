# WMS - Warehouse Management System

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env with your values

# Generate Prisma client
pnpm db:generate

# Build all packages
pnpm build:packages

# Push schema to database
pnpm db:push

# Start development
pnpm dev:api
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev:api` | Start API server |
| `pnpm dev:worker` | Start BullMQ worker |
| `pnpm dev:web` | Start web dashboard |
| `pnpm build:packages` | Build all packages |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:push` | Push schema to database |
| `pnpm db:migrate` | Run migrations |
| `pnpm db:studio` | Open Prisma Studio |

## Structure

```
wms/
├── apps/
│   ├── api/        # Fastify REST API
│   ├── worker/     # BullMQ job processor
│   └── web/        # Vite React dashboard
├── packages/
│   ├── db/         # Prisma client
│   ├── queue/      # BullMQ queues
│   ├── auth/       # JWT utilities
│   ├── types/      # Shared Zod schemas
│   └── config/     # Environment config
├── .env            # Environment variables (create from .env.example)
└── .env.example    # Template
```
