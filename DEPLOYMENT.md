# WMS Production Deployment Guide for Hetzner + Coolify

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Coolify (Hetzner VPS)                    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  PostgreSQL │  │    Redis    │  │   Traefik (auto SSL)    │  │
│  │   :5432     │  │    :6379    │  │   app.yourdomain.com    │  │
│  └─────────────┘  └─────────────┘  │   api.yourdomain.com    │  │
│         │               │          └─────────────────────────┘  │
│         │               │                    │                   │
│  ┌──────┴───────────────┴────────────────────┴──────────────┐   │
│  │                    Internal Network                        │   │
│  ├────────────────┬────────────────┬────────────────────────┤   │
│  │                │                │                         │   │
│  │  ┌──────────┐  │  ┌──────────┐  │  ┌──────────────────┐  │   │
│  │  │   API    │  │  │  Worker  │  │  │       Web        │  │   │
│  │  │  :3000   │  │  │ (no port)│  │  │       :80        │  │   │
│  │  └──────────┘  │  └──────────┘  │  └──────────────────┘  │   │
│  │                │                │                         │   │
│  └────────────────┴────────────────┴────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Local Testing

Before deploying, test locally:

```bash
# Build and start all services
docker-compose up --build

# Access:
# - Web: http://localhost:8080
# - API: http://localhost:3000/health
```

## Coolify Setup

### 1. Create Project

1. Log in to Coolify dashboard
2. Create new Project: "WMS"
3. Add Environment: "production"

### 2. Add PostgreSQL

1. Add Resource → Database → PostgreSQL
2. Settings:
   - Name: `wms-postgres`
   - Version: 16
   - Initial Database: `wms`
3. Note the connection string

### 3. Add Redis

1. Add Resource → Database → Redis
2. Settings:
   - Name: `wms-redis`
   - Version: 7

### 4. Add API Service

1. Add Resource → Application → Docker
2. Settings:
   - Name: `wms-api`
   - Git Repository: Your repo URL
   - Branch: `main`
   - Build Pack: Dockerfile
   - Dockerfile Path: `apps/api/Dockerfile`
   - Port: `3000`
   - Domain: `api.yourdomain.com`
   - Health Check Path: `/health`

**Environment Variables:**
```
DATABASE_URL=postgresql://postgres:PASSWORD@wms-postgres:5432/wms
DIRECT_URL=postgresql://postgres:PASSWORD@wms-postgres:5432/wms
REDIS_URL=redis://wms-redis:6379
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_REFRESH_SECRET=your-refresh-secret-key-min-32-characters
NODE_ENV=production
SHIPENGINE_API_KEY=your_shipengine_key
SHOPIFY_SHOP_DOMAIN=yourstore.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_shopify_token
GCS_BUCKET_NAME=your-gcs-bucket
GCS_PROJECT_ID=your-project-id
```

### 5. Add Worker Service

1. Add Resource → Application → Docker
2. Settings:
   - Name: `wms-worker`
   - Same git repo
   - Dockerfile Path: `apps/worker/Dockerfile`
   - No domain needed
   - No health check

**Environment Variables:** Same as API

### 6. Add Web Service

1. Add Resource → Application → Docker
2. Settings:
   - Name: `wms-web`
   - Same git repo
   - Dockerfile Path: `apps/web/Dockerfile`
   - Port: `80`
   - Domain: `app.yourdomain.com`

**Build Arguments:**
```
VITE_API_URL=https://api.yourdomain.com
```

### 7. Set Dependencies

In Coolify, configure startup order:
1. PostgreSQL, Redis (start first)
2. API (depends on postgres, redis)
3. Worker (depends on API)
4. Web (depends on API)

## Deployment

1. Push to git
2. Coolify will auto-deploy (or trigger manually)
3. First deploy: API runs migrations automatically

## Verify

```bash
# Check API
curl https://api.yourdomain.com/health

# Check Web
open https://app.yourdomain.com
```

## Troubleshooting

### Prisma errors
- Ensure `prisma generate` runs during build
- Check DATABASE_URL is set before build

### Redis connection errors
- Use internal Docker hostname: `redis://wms-redis:6379`
- Not `localhost`

### Worker not processing
- Check Redis URL matches API
- View worker logs in Coolify

### Migration errors
- SSH to server, run manually:
  ```bash
  docker exec -it <api-container> sh
  cd /app/packages/db
  npx prisma migrate deploy
  ```
