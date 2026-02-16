# WMS Production Deployment Guide
## Hetzner VPS + Coolify + Supabase (Complete Setup)

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Supabase Setup](#2-supabase-setup)
3. [Hetzner VPS Setup](#3-hetzner-vps-setup)
4. [Domain & DNS Configuration](#4-domain--dns-configuration)
5. [Coolify Installation](#5-coolify-installation)
6. [Project Setup in Coolify](#6-project-setup-in-coolify)
7. [Redis Service](#7-redis-service)
8. [API Service](#8-api-service)
9. [Worker Service](#9-worker-service)
10. [Web Frontend Service](#10-web-frontend-service)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [First Deployment](#12-first-deployment)
13. [Verification & Testing](#13-verification--testing)
14. [Maintenance & Operations](#14-maintenance--operations)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Prerequisites

### Required Accounts
- [ ] Hetzner Cloud account (https://console.hetzner.cloud)
- [ ] Supabase account (https://supabase.com)
- [ ] Domain name with DNS access
- [ ] GitHub/GitLab account with your WMS repo
- [ ] ShipEngine account (for shipping labels)
- [ ] Shopify store (if using Shopify integration)
- [ ] Google Cloud account (if using GCS for images)

### Required Information (gather before starting)
```
Domain:              __________________ (e.g., yourcompany.com)
GitHub Repo URL:     __________________ (e.g., github.com/you/wms)
Supabase Project:    __________________ (e.g., abcdefghijk)
ShipEngine API Key:  __________________
Shopify Domain:      __________________ (e.g., store.myshopify.com)
Shopify Token:       __________________
```

---

## 2. Supabase Setup

### 2.1 Create Supabase Project

1. Go to https://supabase.com and sign in
2. Click **New Project**
3. Configure:

| Setting | Value |
|---------|-------|
| Organization | Your org |
| Project Name | `wms-production` |
| Database Password | (generate & save securely!) |
| Region | Choose closest to your server |

4. Click **Create new project**
5. Wait for project to initialize (~2 minutes)

### 2.2 Get Connection Strings

1. Go to **Project Settings** → **Database**
2. Scroll to **Connection string**
3. Copy both URLs:

**Connection Pooler (Transaction mode) - for your app:**
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**Direct Connection - for migrations:**
```
postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
```

⚠️ **Important:** 
- Use **port 6543** (pooler) for `DATABASE_URL`
- Use **port 5432** (direct) for `DIRECT_URL`
- Add `?pgbouncer=true` to the pooler URL for Prisma

### 2.3 Your Connection Strings

Save these - you'll need them later:

```bash
# For application (pooled - port 6543)
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true

# For migrations (direct - port 5432)  
DIRECT_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
```

### 2.4 Configure Database Settings (Optional but Recommended)

1. Go to **Project Settings** → **Database**
2. Under **Connection Pooling**, ensure it's enabled
3. Set pool mode to **Transaction** (default)

---

## 3. Hetzner VPS Setup

### 3.1 Create Server

1. Log in to Hetzner Cloud Console
2. Click **"Add Server"**
3. Configure:

| Setting | Recommended Value |
|---------|-------------------|
| Location | Nearest to your users (e.g., Ashburn for US) |
| Image | Ubuntu 24.04 |
| Type | CPX21 (3 vCPU, 4GB RAM) or higher |
| SSH Key | Add your public key |
| Name | `wms-production` |

4. Click **Create & Buy Now**
5. Note the IP address: `___.___.___.___ `

### 3.2 Initial Server Security

SSH into your server:
```bash
ssh root@YOUR_SERVER_IP
```

Run these commands:
```bash
# Update system
apt update && apt upgrade -y

# Create non-root user
adduser deploy
usermod -aG sudo deploy

# Copy SSH key to new user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Configure firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw allow 8000  # Coolify dashboard
ufw enable

# Disable root SSH login (optional but recommended)
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart sshd
```

---

## 4. Domain & DNS Configuration

### 4.1 DNS Records

Add these DNS records at your domain registrar:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `YOUR_SERVER_IP` | 300 |
| A | `api` | `YOUR_SERVER_IP` | 300 |
| A | `app` | `YOUR_SERVER_IP` | 300 |
| A | `coolify` | `YOUR_SERVER_IP` | 300 |

### 4.2 Resulting URLs

After setup, you'll have:
- **Coolify Dashboard**: `https://coolify.yourdomain.com:8000`
- **API**: `https://api.yourdomain.com`
- **Web App**: `https://app.yourdomain.com`

---

## 5. Coolify Installation

### 5.1 Install Coolify

SSH as root and run:
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This takes 5-10 minutes. When done, you'll see:
```
Coolify installed successfully!
Access it at: http://YOUR_SERVER_IP:8000
```

### 5.2 Initial Coolify Setup

1. Open `http://YOUR_SERVER_IP:8000` in browser
2. Create admin account:
   - Email: `your@email.com`
   - Password: (use strong password)
3. Complete the setup wizard

### 5.3 Configure Coolify Domain (Optional but Recommended)

1. Go to **Settings** → **Configuration**
2. Set Instance Domain: `coolify.yourdomain.com`
3. Enable SSL
4. Save

Now access Coolify at: `https://coolify.yourdomain.com:8000`

---

## 6. Project Setup in Coolify

### 6.1 Add Git Source

1. Go to **Sources** → **Add Source**
2. Select **GitHub** (or GitLab)
3. Authenticate with your account
4. Select your WMS repository

### 6.2 Create Project

1. Go to **Projects** → **Add Project**
2. Name: `WMS`
3. Description: `Warehouse Management System`
4. Click **Create**

### 6.3 Create Environment

1. Inside WMS project, click **Add Environment**
2. Name: `production`
3. Click **Create**

---

## 7. Redis Service

> **Note:** We only need Redis in Coolify. Database is handled by Supabase.

### 7.1 Add Redis

1. Inside `production` environment, click **Add Resource**
2. Select **Database** → **Redis**
3. Configure:

| Setting | Value |
|---------|-------|
| Name | `wms-redis` |
| Version | `7` |
| Password | (leave empty or set one) |

4. Click **Create**
5. Wait for deployment (green status)
6. Note the **Internal URL**:
   ```
   redis://wms-redis:6379
   ```

---

## 8. API Service

### 8.1 Create API Application

1. Click **Add Resource** → **Application**
2. Select your GitHub source and WMS repository
3. Configure:

| Setting | Value |
|---------|-------|
| Name | `wms-api` |
| Branch | `main` |
| Build Pack | `Dockerfile` |
| Dockerfile Location | `apps/api/Dockerfile` |
| Port | `3000` |

### 8.2 Domain Configuration

1. Go to **Domains** tab
2. Add domain: `api.yourdomain.com`
3. Enable **SSL/TLS** (Let's Encrypt)

### 8.3 Health Check

1. Go to **Health Checks** tab
2. Configure:

| Setting | Value |
|---------|-------|
| Enabled | Yes |
| Path | `/health` |
| Interval | `30` seconds |

### 8.4 Environment Variables

Go to **Environment Variables** tab and add:

```bash
# ═══════════════════════════════════════════════════════════════════════════════
# SUPABASE DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
# Pooled connection (port 6543) - for application queries
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct connection (port 5432) - for Prisma migrations
DIRECT_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres

# ═══════════════════════════════════════════════════════════════════════════════
# REDIS (Coolify internal)
# ═══════════════════════════════════════════════════════════════════════════════
REDIS_URL=redis://wms-redis:6379

# ═══════════════════════════════════════════════════════════════════════════════
# AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════════════════
# Generate with: openssl rand -base64 32
JWT_SECRET=your-jwt-secret-minimum-32-characters-long-here
JWT_REFRESH_SECRET=your-refresh-secret-minimum-32-characters-here

# ═══════════════════════════════════════════════════════════════════════════════
# APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════
NODE_ENV=production
PORT=3000

# ═══════════════════════════════════════════════════════════════════════════════
# SHIPPING (ShipEngine)
# ═══════════════════════════════════════════════════════════════════════════════
SHIPENGINE_API_KEY=your_shipengine_api_key
SHIPENGINE_SANDBOX=false

# Warehouse Ship-From Address
WAREHOUSE_NAME=Main Warehouse
WAREHOUSE_COMPANY=Your Company Name
WAREHOUSE_ADDRESS1=123 Warehouse Street
WAREHOUSE_CITY=Los Angeles
WAREHOUSE_STATE=CA
WAREHOUSE_ZIP=90210
WAREHOUSE_COUNTRY=US
WAREHOUSE_PHONE=555-123-4567

# ═══════════════════════════════════════════════════════════════════════════════
# SHOPIFY INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════
SHOPIFY_SHOP_DOMAIN=yourstore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx
SHOPIFY_WEBHOOK_SECRET=your_webhook_signing_secret

# ═══════════════════════════════════════════════════════════════════════════════
# GOOGLE CLOUD STORAGE (for packing images)
# ═══════════════════════════════════════════════════════════════════════════════
GCS_BUCKET_NAME=your-wms-bucket
GCS_PROJECT_ID=your-gcp-project-id

# ═══════════════════════════════════════════════════════════════════════════════
# ABLY (Real-time notifications - optional)
# ═══════════════════════════════════════════════════════════════════════════════
ABLY_API_KEY=your_ably_api_key
```

### 8.5 Save and Deploy

1. Click **Save**
2. Click **Deploy**
3. Watch logs for successful startup

---

## 9. Worker Service

### 9.1 Create Worker Application

1. Click **Add Resource** → **Application**
2. Select same GitHub source and WMS repository
3. Configure:

| Setting | Value |
|---------|-------|
| Name | `wms-worker` |
| Branch | `main` |
| Build Pack | `Dockerfile` |
| Dockerfile Location | `apps/worker/Dockerfile` |

**Important:** No port, no domain needed for worker.

### 9.2 Environment Variables

Go to **Environment Variables** tab and add:

```bash
# ═══════════════════════════════════════════════════════════════════════════════
# SUPABASE DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true

# ═══════════════════════════════════════════════════════════════════════════════
# REDIS (Coolify internal)
# ═══════════════════════════════════════════════════════════════════════════════
REDIS_URL=redis://wms-redis:6379

# ═══════════════════════════════════════════════════════════════════════════════
# APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════
NODE_ENV=production

# ═══════════════════════════════════════════════════════════════════════════════
# SHIPPING (ShipEngine) - needed for shipping processor
# ═══════════════════════════════════════════════════════════════════════════════
SHIPENGINE_API_KEY=your_shipengine_api_key
SHIPENGINE_SANDBOX=false

WAREHOUSE_NAME=Main Warehouse
WAREHOUSE_COMPANY=Your Company Name
WAREHOUSE_ADDRESS1=123 Warehouse Street
WAREHOUSE_CITY=Los Angeles
WAREHOUSE_STATE=CA
WAREHOUSE_ZIP=90210
WAREHOUSE_COUNTRY=US
WAREHOUSE_PHONE=555-123-4567

# ═══════════════════════════════════════════════════════════════════════════════
# SHOPIFY - needed for Shopify sync processor
# ═══════════════════════════════════════════════════════════════════════════════
SHOPIFY_SHOP_DOMAIN=yourstore.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx

# ═══════════════════════════════════════════════════════════════════════════════
# GOOGLE CLOUD STORAGE - needed for image processing
# ═══════════════════════════════════════════════════════════════════════════════
GCS_BUCKET_NAME=your-wms-bucket
GCS_PROJECT_ID=your-gcp-project-id
```

### 9.3 Save and Deploy

1. Click **Save**
2. Click **Deploy**
3. Watch logs - should show "Worker started, listening for jobs..."

---

## 10. Web Frontend Service

### 10.1 Create Web Application

1. Click **Add Resource** → **Application**
2. Select same GitHub source and WMS repository
3. Configure:

| Setting | Value |
|---------|-------|
| Name | `wms-web` |
| Branch | `main` |
| Build Pack | `Dockerfile` |
| Dockerfile Location | `apps/web/Dockerfile` |
| Port | `80` |

### 10.2 Domain Configuration

1. Go to **Domains** tab
2. Add domain: `app.yourdomain.com`
3. Enable **SSL/TLS** (Let's Encrypt)

### 10.3 Build Arguments (IMPORTANT!)

Go to **Build** tab → **Build Arguments**:

```bash
VITE_API_URL=https://api.yourdomain.com
```

⚠️ **This is a BUILD argument, not runtime environment variable!**

### 10.4 Save and Deploy

1. Click **Save**
2. Click **Deploy**
3. Wait for build to complete

---

## 11. Environment Variables Reference

### Quick Copy-Paste Templates

#### API Service
```bash
# Supabase
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres

# Redis (Coolify internal)
REDIS_URL=redis://wms-redis:6379

# Auth
JWT_SECRET=GENERATE_WITH_openssl_rand_-base64_32
JWT_REFRESH_SECRET=GENERATE_WITH_openssl_rand_-base64_32

# App
NODE_ENV=production
PORT=3000

# Shipping
SHIPENGINE_API_KEY=
SHIPENGINE_SANDBOX=false
WAREHOUSE_NAME=Main Warehouse
WAREHOUSE_COMPANY=Your Company
WAREHOUSE_ADDRESS1=123 Street
WAREHOUSE_CITY=City
WAREHOUSE_STATE=ST
WAREHOUSE_ZIP=12345
WAREHOUSE_COUNTRY=US
WAREHOUSE_PHONE=555-555-5555

# Shopify
SHOPIFY_SHOP_DOMAIN=store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxx
SHOPIFY_WEBHOOK_SECRET=

# GCS
GCS_BUCKET_NAME=
GCS_PROJECT_ID=

# Ably
ABLY_API_KEY=
```

#### Worker Service
```bash
# Supabase
DATABASE_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true

# Redis (Coolify internal)
REDIS_URL=redis://wms-redis:6379

# App
NODE_ENV=production

# Shipping
SHIPENGINE_API_KEY=
SHIPENGINE_SANDBOX=false
WAREHOUSE_NAME=Main Warehouse
WAREHOUSE_COMPANY=Your Company
WAREHOUSE_ADDRESS1=123 Street
WAREHOUSE_CITY=City
WAREHOUSE_STATE=ST
WAREHOUSE_ZIP=12345
WAREHOUSE_COUNTRY=US
WAREHOUSE_PHONE=555-555-5555

# Shopify
SHOPIFY_SHOP_DOMAIN=store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxx

# GCS
GCS_BUCKET_NAME=
GCS_PROJECT_ID=
```

#### Web Service (Build Arguments)
```bash
VITE_API_URL=https://api.yourdomain.com
```

### Generate Secrets

Run locally to generate secure secrets:
```bash
# JWT Secret
openssl rand -base64 32

# Refresh Secret
openssl rand -base64 32
```

---

## 12. First Deployment

### 12.1 Deployment Order

Deploy in this order:
1. ✅ Redis (wait until healthy)
2. ✅ API (runs migrations automatically via DIRECT_URL)
3. ✅ Worker (starts processing jobs)
4. ✅ Web (frontend becomes accessible)

### 12.2 Verify Database Migration

Check API logs for:
```
Prisma migrate deploy completed
Server running on http://localhost:3000
```

If migrations fail, check:
1. `DIRECT_URL` uses port **5432** (not 6543)
2. Database password is correct
3. Supabase project is active

### 12.3 Create First Admin User

Option A: Via API (if signup is enabled):
```bash
curl -X POST https://api.yourdomain.com/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@yourcompany.com","password":"SecurePassword123!"}'
```

Option B: Via Supabase SQL Editor:
1. Go to Supabase Dashboard → SQL Editor
2. Run query to create user (password needs to be bcrypt hashed)

---

## 13. Verification & Testing

### 13.1 Health Checks

```bash
# API Health
curl https://api.yourdomain.com/health
# Expected: {"status":"ok","timestamp":"..."}

# Web App
curl -I https://app.yourdomain.com
# Expected: HTTP/2 200
```

### 13.2 Test Login

1. Open `https://app.yourdomain.com`
2. Click "Sign Up" or "Login"
3. Create account / Sign in
4. Verify dashboard loads

### 13.3 Test Background Jobs

```bash
# Check worker logs in Coolify
# Should see: "Worker started" and job processing messages
```

### 13.4 Test Shopify Webhook (if configured)

1. In Shopify Admin → Settings → Notifications
2. Add webhook: `https://api.yourdomain.com/webhooks/shopify/orders/create`
3. Create test order
4. Check API logs for webhook receipt

---

## 14. Maintenance & Operations

### 14.1 Viewing Logs

In Coolify dashboard:
1. Click on service (API, Worker, Web)
2. Go to **Logs** tab
3. View real-time or historical logs

Via SSH:
```bash
# All containers
docker logs -f $(docker ps -qf "name=wms-api")
docker logs -f $(docker ps -qf "name=wms-worker")
```

### 14.2 Database Backups

Supabase handles backups automatically:
- **Pro plan**: Daily backups, 7-day retention
- **Free plan**: Weekly backups

To create manual backup:
1. Go to Supabase Dashboard → Database → Backups
2. Click "Create backup"

Or via pg_dump:
```bash
pg_dump "postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" > backup.sql
```

### 14.3 Database Migrations

Migrations run automatically on API startup. For manual:
```bash
docker exec -it $(docker ps -qf "name=wms-api") sh
cd /app/packages/db
npx prisma migrate deploy
```

### 14.4 Scaling

#### Vertical Scaling (bigger server)
1. In Hetzner, resize VPS to larger instance
2. Restart Coolify services

#### Horizontal Scaling
1. In Coolify, go to API service
2. **Settings** → **Replicas**
3. Increase replica count

### 14.5 Updates & Redeployment

#### Automatic (recommended)
1. In Coolify, enable **Auto Deploy** on each service
2. Push to `main` branch
3. Coolify automatically rebuilds and deploys

#### Manual
1. Go to service in Coolify
2. Click **Deploy**
3. Select commit or use latest

---

## 15. Troubleshooting

### Common Issues

#### "Cannot connect to database"
```
Error: Can't reach database server
```
**Fix:**
1. Check Supabase project is active (not paused)
2. Verify connection string format
3. Ensure `?pgbouncer=true` is in DATABASE_URL
4. Check password doesn't have special characters that need encoding

#### "Connection terminated unexpectedly" or "prepared statement already exists"
**Fix:**
Add `?pgbouncer=true` to DATABASE_URL:
```
DATABASE_URL=postgresql://...?pgbouncer=true
```

#### "Redis connection refused"
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Fix:**
1. Check Redis is running in Coolify
2. Verify REDIS_URL uses `wms-redis`, not `localhost`

#### "Prisma: Cannot find module"
```
Error: Cannot find module '@prisma/client'
```
**Fix:**
1. Ensure Dockerfile runs `pnpm --filter @wms/db db:generate`
2. Rebuild: Coolify → Service → **Rebuild**

#### "JWT malformed" or auth errors
**Fix:**
1. Ensure JWT_SECRET and JWT_REFRESH_SECRET are set
2. Must be at least 32 characters
3. Same value across API service

#### Web shows blank page
**Fix:**
1. Check browser console for errors
2. Verify VITE_API_URL build argument is correct
3. Rebuild web service after changing build args

#### Worker not processing jobs
**Fix:**
1. Check worker logs for errors
2. Verify REDIS_URL matches API's REDIS_URL
3. Ensure worker container is running

#### Supabase project paused
Free tier projects pause after 1 week of inactivity.
**Fix:**
1. Go to Supabase Dashboard
2. Click "Restore" on the project
3. Redeploy API service

### Getting Help

1. **Coolify Logs**: First place to check
2. **Supabase Logs**: Dashboard → Logs
3. **Container Shell**: 
   ```bash
   docker exec -it CONTAINER_NAME sh
   ```

### Emergency Rollback

1. In Coolify, go to service
2. **Deployments** tab
3. Find previous working deployment
4. Click **Rollback**

---

## Checklist

### Pre-Deployment
- [ ] Supabase project created
- [ ] Connection strings saved
- [ ] Hetzner VPS created
- [ ] DNS records configured
- [ ] Coolify installed
- [ ] GitHub connected to Coolify

### Services Created
- [ ] Redis running (in Coolify)
- [ ] API deployed with all env vars
- [ ] Worker deployed with all env vars
- [ ] Web deployed with build args

### Verification
- [ ] API health check passes
- [ ] Web app loads
- [ ] Can create account / login
- [ ] Worker processes jobs
- [ ] Shopify webhook works (if applicable)

### Security
- [ ] SSL/HTTPS enabled on all domains
- [ ] JWT secrets are unique and strong
- [ ] Firewall configured on server
- [ ] Supabase RLS enabled (if using Supabase auth)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL SERVICES                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│   │   Supabase   │    │   Shopify    │    │  ShipEngine  │     │
│   │  PostgreSQL  │    │   Webhooks   │    │     API      │     │
│   └──────┬───────┘    └──────────────┘    └──────────────┘     │
│          │                                                       │
└──────────┼───────────────────────────────────────────────────────┘
           │
           │ DATABASE_URL / DIRECT_URL
           │
┌──────────┼───────────────────────────────────────────────────────┐
│          │        Coolify (Hetzner VPS)                          │
├──────────┼───────────────────────────────────────────────────────┤
│          │                                                        │
│  ┌───────▼─────┐   ┌─────────────────────────────────────────┐   │
│  │    Redis    │   │          Traefik (auto SSL)             │   │
│  │    :6379    │   │   app.yourdomain.com                    │   │
│  └──────┬──────┘   │   api.yourdomain.com                    │   │
│         │          └─────────────────────────────────────────┘   │
│         │                         │                               │
│  ┌──────┴─────────────────────────┴────────────────────────┐     │
│  │                  Internal Network                         │     │
│  ├────────────────┬────────────────┬────────────────────────┤     │
│  │                │                │                         │     │
│  │  ┌──────────┐  │  ┌──────────┐  │  ┌──────────────────┐  │     │
│  │  │   API    │  │  │  Worker  │  │  │       Web        │  │     │
│  │  │  :3000   │  │  │ (no port)│  │  │       :80        │  │     │
│  │  └──────────┘  │  └──────────┘  │  └──────────────────┘  │     │
│  │                │                │                         │     │
│  └────────────────┴────────────────┴────────────────────────┘     │
└───────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

| Service | Location | URL |
|---------|----------|-----|
| PostgreSQL | Supabase (external) | `*.pooler.supabase.com:6543` |
| Redis | Coolify (internal) | `redis://wms-redis:6379` |
| API | Coolify | `https://api.yourdomain.com` |
| Worker | Coolify | N/A (internal) |
| Web | Coolify | `https://app.yourdomain.com` |

| Secret | How to Generate |
|--------|-----------------|
| JWT_SECRET | `openssl rand -base64 32` |
| JWT_REFRESH_SECRET | `openssl rand -base64 32` |
| Supabase Password | Set during project creation |
