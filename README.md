# 🎯 Bid Catcher

> Construction bid intake system with PDF extraction and go/no-go scoring

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-black.svg)](https://fastify.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-orange.svg)](https://orm.drizzle.team/)

## Overview

Bid Catcher captures all bid invitations (web + email), extracts key fields from PDFs, applies a standardized go/no-go scorecard with human overrides, and pushes qualified opportunities into JobTread with attached documents.

**Key Features:**
- 📥 Unified intake (web forms + email webhooks)
- 📄 PDF field extraction (12-18 configurable signals)
- 📊 Deterministic go/no-go scoring
- 👤 Human-in-the-loop overrides
- 🔗 JobTread integration (future)

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 14+ (or Supabase)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd bid-catcher

# Install dependencies
pnpm install

# Copy environment file
copy env.example .env
# Edit .env with your database URL

# Push database schema
pnpm db:push

# Start development server
pnpm dev
```

### Verify Installation

```bash
# Health check
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","version":"0.1.0",...}
```

## Project Structure

```
bid-catcher/
├── apps/
│   ├── api/                 # Fastify backend service
│   └── web/                 # Frontend (placeholder)
├── packages/
│   ├── config/              # Shared types and client config
│   ├── db/                  # Drizzle ORM schema
│   ├── pdf-assist/          # PDF extraction (stub)
│   └── scoring/             # Go/no-go scoring engine
├── docs/
│   ├── architecture.md      # System architecture
│   ├── data-model.md        # Database schema docs
│   └── decision-rubric.md   # Scoring documentation
└── README.md
```

## API Endpoints

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/intake/web` | Web form submission |
| POST | `/intake/email` | Email webhook |
| GET | `/bids` | List bids (supports `?status=` and `?clientId=` filters) |
| GET | `/bids/:id` | Get bid details |
| PATCH | `/bids/:id/status` | Update bid status |

### Decision Engine Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/bids/:id/evaluate` | Run Go/No-Go scoring on a bid |
| POST | `/bids/:id/override` | Override a decision with human judgment |
| GET | `/bids/:id/decisions` | Get full decision history |
| GET | `/bids/:id/decisions?latest=true` | Get only the latest decision |

#### Example: Evaluate a Bid

```bash
curl -X POST http://localhost:3000/bids/<bid-id>/evaluate \
  -H "Content-Type: application/json"
```

#### Example: Override a Decision

```bash
curl -X POST http://localhost:3000/bids/<bid-id>/override \
  -H "Content-Type: application/json" \
  -d '{
    "decisionId": "<decision-id>",
    "outcome": "GO",
    "reasonCategory": "relationship",
    "rationale": "Long-standing relationship with this GC, historically successful projects",
    "overriddenBy": "john.smith@company.com"
  }'
```

Override reason categories: `relationship`, `strategic`, `capacity`, `timeline`, `financial`, `scope`, `other`

## Development

### Commands

```bash
# Start API in development mode
pnpm dev

# Build all packages
pnpm build

# Type check all packages
pnpm typecheck

# Database operations
pnpm db:generate   # Generate migrations
pnpm db:migrate    # Run migrations
pnpm db:push       # Push schema (dev only)
pnpm db:studio     # Open Drizzle Studio
```

### Package Scripts

Each package has its own scripts:

```bash
# Build a specific package
pnpm --filter @bid-catcher/config build

# Type check API
pnpm --filter @bid-catcher/api typecheck
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `PORT` | API server port | 3000 |
| `HOST` | API server host | 0.0.0.0 |
| `NODE_ENV` | Environment | development |
| `LOG_LEVEL` | Pino log level | debug |

### Client Configuration

Each client has a JSON configuration defining:
- Intake field customizations
- PDF signals to extract (12-18)
- Go/no-go scoring weights
- JobTread field mappings

See `packages/config/src/client-config.ts` for the full schema.

## Architecture

```
Web Form ──┐
           ├──► API ──► Database
Email ─────┘     │
                 ├──► PDF Assist (extraction)
                 ├──► Scoring Engine
                 └──► Human Review Queue
                           │
                           ▼
                      JobTread (future)
```

**Design Principles:**
- Humans stay in the loop
- No ML - deterministic logic only
- Never overwrite extracted data
- 80% reusable, 20% configurable per client

See [docs/architecture.md](docs/architecture.md) for details.

## Database Schema

Core entities:
- `clients` - Construction companies
- `bids` - Bid invitations
- `bid_documents` - Attached files
- `extracted_fields` - PDF extraction results (append-only)
- `go_no_go_decisions` - Scoring results
- `decision_overrides` - Human overrides

See [docs/data-model.md](docs/data-model.md) for full schema.

## Scoring

Bids are scored using configurable criteria:
- Each criterion has rules that evaluate extracted signals
- Scores are weighted and summed
- Thresholds determine go/no-go/needs-review

See [docs/decision-rubric.md](docs/decision-rubric.md) for details.

## MVP Status

### ✅ Completed (Day 1)
- [x] Repository structure
- [x] TypeScript configuration
- [x] Database schema (Drizzle)
- [x] API skeleton (Fastify)
- [x] Stub endpoints
- [x] Client config model
- [x] Documentation

### 📋 Remaining (Week 1-2)
- [ ] Database integration (connect stubs to DB)
- [ ] PDF extraction implementation
- [ ] Scoring engine integration
- [ ] Email webhook setup
- [ ] Document storage
- [ ] JobTread integration
- [ ] Admin UI

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.3 |
| API | Fastify 4.x |
| Validation | Zod |
| Database | PostgreSQL (Supabase) |
| ORM | Drizzle |
| Package Manager | pnpm |

## License

UNLICENSED - Proprietary

