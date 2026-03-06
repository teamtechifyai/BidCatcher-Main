# Deploying BidCatcher to Railway

This guide walks through deploying the BidCatcher monorepo (API + Web) to Railway.

---

## Architecture

- **API** (`apps/api`): Fastify backend on port 3000 (or `$PORT`)
- **Web** (`apps/web`): Next.js frontend; proxies `/api/*` to the API
- **Database**: Supabase PostgreSQL (external; configure via `DATABASE_URL`)

You'll create **two Railway services**: one for the API and one for the Web app.

---

## Prerequisites

- [Railway account](https://railway.app)
- [GitHub repo](https://github.com) with this project
- Supabase project (for PostgreSQL + Auth)
- Environment variables ready (see below)

---

## Step 1: Create a Railway Project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project**
3. Choose **Deploy from GitHub repo** and connect your BidCatcher repository
4. Railway will detect the monorepo; you'll add services manually

---

## Step 2: Deploy the API Service

1. In your Railway project, click **+ New** → **GitHub Repo**
2. Select your BidCatcher repo
3. Railway creates a service; open it and go to **Settings**

### API Service Settings

| Setting | Value |
|---------|-------|
| **Root Directory** | *(leave empty – use repo root)* |
| **Build Command** | `pnpm install && pnpm --filter @bid-catcher/api build` |
| **Start Command** | `pnpm --filter @bid-catcher/api start` |
| **Watch Paths** | `apps/api,packages/*` |

### API Environment Variables

Add these in **Variables**:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `NODE_ENV` | `production` |
| `PORT` | Railway sets this automatically |
| `HOST` | `0.0.0.0` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `RESEND_API_KEY` | Resend API key (email) |
| `RESEND_WEBHOOK_SECRET` | Resend webhook secret |
| `RESEND_RECEIVING_DOMAIN` | e.g. `intake.yourdomain.com` |
| `OPENAI_API_KEY` | For AI scoring |
| `GHL_API_TOKEN` | (Optional) GoHighLevel |
| `GHL_LOCATION_ID` | (Optional) |
| `GHL_PIPELINE_ID` | (Optional) |
| `GHL_PIPELINE_STAGE_ID` | (Optional) |

4. Deploy the API. Once it’s running, copy its **public URL** (e.g. `https://your-api.up.railway.app`).

---

## Step 3: Deploy the Web Service

1. In the same Railway project, click **+ New** → **GitHub Repo**
2. Select the same BidCatcher repo
3. Open the new service and go to **Settings**

### Web Service Settings

| Setting | Value |
|---------|-------|
| **Root Directory** | *(leave empty)* |
| **Build Command** | `pnpm install && pnpm --filter @bid-catcher/web build` |
| **Start Command** | `pnpm --filter @bid-catcher/web start` |
| **Watch Paths** | `apps/web,packages/*` |

### Web Environment Variables

| Variable | Description |
|----------|-------------|
| `API_URL` | **API public URL** (e.g. `https://your-api.up.railway.app`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as API |
| `NODE_ENV` | `production` |

`API_URL` is required so Next.js can proxy `/api/*` to your API service.

---

## Step 4: Run Database Migrations

Before using the app, run migrations against your Supabase database:

```bash
# From your local machine (with DATABASE_URL in .env)
pnpm db:migrate
```

Or run the SQL in `packages/db/migrations/` (or `packages/db/*.sql`) directly in the Supabase SQL editor.

---

## Step 5: Configure Custom Domains (Optional)

1. **API**: In the API service → **Settings** → **Networking** → add a custom domain (e.g. `api.bidcatcher.app`)
2. **Web**: In the Web service → **Settings** → **Networking** → add a custom domain (e.g. `app.bidcatcher.app`)

Update `API_URL` in the Web service to use your API domain.

---

## Step 6: Resend Webhook (Incoming Email)

If you use Resend for incoming email:

1. In Resend, set the webhook URL to: `https://your-api-domain.com/incoming-emails/webhook`
2. Ensure `RESEND_WEBHOOK_SECRET` matches Resend
3. Configure `RESEND_RECEIVING_DOMAIN` for your inbound domain

---

## Troubleshooting

### Build fails with "pnpm: command not found"

Railway supports pnpm. Ensure `packageManager` is set in root `package.json`:

```json
"packageManager": "pnpm@9.15.0"
```

### API returns 404 for routes

- Confirm the API service is running and healthy
- Check that `API_URL` in the Web service points to the correct API URL (no trailing slash)

### Database connection errors

- Verify `DATABASE_URL` uses the Supabase connection pooler URL for serverless
- Ensure your Supabase project allows connections from Railway IPs (or use “Allow all” for development)

### Web app shows blank or errors

- Confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set in the Web service
- Check browser console and Railway logs for errors

---

## Quick Reference: Environment Variables

### API (required)

```
DATABASE_URL=
NODE_ENV=production
HOST=0.0.0.0
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
RESEND_API_KEY=
RESEND_WEBHOOK_SECRET=
RESEND_RECEIVING_DOMAIN=
OPENAI_API_KEY=
```

### Web (required)

```
API_URL=https://your-api-service.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NODE_ENV=production
```
