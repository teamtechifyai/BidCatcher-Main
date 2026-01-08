# Bid Catcher Architecture

## Overview

Bid Catcher is a construction bid intake system that captures bid invitations from multiple channels, extracts key fields from documents, applies deterministic go/no-go scoring, and pushes qualified opportunities to JobTread.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BID CATCHER                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────┐     ┌──────────┐                                             │
│   │ Web Form │     │  Email   │                                             │
│   │  Intake  │     │ Webhook  │                                             │
│   └────┬─────┘     └────┬─────┘                                             │
│        │                │                                                    │
│        └───────┬────────┘                                                    │
│                ▼                                                             │
│   ┌────────────────────────┐                                                │
│   │      API Service       │ ◄── Fastify + TypeScript                       │
│   │   /intake/web          │                                                │
│   │   /intake/email        │                                                │
│   │   /bids                │                                                │
│   └────────────┬───────────┘                                                │
│                │                                                             │
│        ┌───────┴───────┬─────────────────┐                                  │
│        ▼               ▼                  ▼                                  │
│   ┌──────────┐   ┌──────────┐   ┌────────────────┐                          │
│   │ Database │   │PDF Assist│   │    Scoring     │                          │
│   │ (Postgres)│   │ Service  │   │    Engine      │                          │
│   └──────────┘   └──────────┘   └────────────────┘                          │
│        │                                  │                                  │
│        │         ┌────────────────────────┘                                  │
│        ▼         ▼                                                           │
│   ┌─────────────────────────┐                                               │
│   │   Human Review Queue    │ ◄── Decisions requiring override              │
│   └────────────┬────────────┘                                               │
│                │                                                             │
│                ▼                                                             │
│   ┌─────────────────────────┐                                               │
│   │   JobTread Integration  │ ◄── Future: Push qualified bids               │
│   └─────────────────────────┘                                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Principles

### 1. Humans Stay in the Loop
- All automated decisions can be overridden
- Override reasons are required and logged
- Clear audit trail for compliance

### 2. Deterministic Logic Only
- No ML training pipelines
- All scoring rules are explicit and configurable
- Decisions are explainable and traceable

### 3. Never Overwrite Extracted Data
- Each extraction creates a new version
- Historical extractions preserved for comparison
- Full audit trail maintained

### 4. Client Configuration Drives Behavior
- 80% reusable core logic
- 20% client-specific via JSON config
- No code changes needed for new clients

## Package Architecture

```
bid-catcher/
├── apps/
│   ├── api/                 # Main API service (Fastify)
│   └── web/                 # Frontend (future)
├── packages/
│   ├── config/              # Shared types, constants, client config
│   ├── db/                  # Drizzle ORM schema and client
│   ├── pdf-assist/          # PDF parsing and extraction
│   └── scoring/             # Go/No-Go scoring engine
└── docs/                    # Documentation
```

### Package Dependencies

```
@bid-catcher/api
    ├── @bid-catcher/config
    ├── @bid-catcher/db
    ├── @bid-catcher/pdf-assist
    └── @bid-catcher/scoring

@bid-catcher/db
    └── @bid-catcher/config

@bid-catcher/pdf-assist
    └── @bid-catcher/config

@bid-catcher/scoring
    └── @bid-catcher/config
```

## Data Flow

### 1. Bid Intake
1. Bid arrives via web form or email webhook
2. API validates request against client config
3. Bid record created with status `received`
4. Documents stored and queued for processing

### 2. Document Processing
1. PDF documents queued for extraction
2. PDF Assist service extracts configured signals
3. Extracted fields stored (never overwritten)
4. Bid status updated to `processing`

### 3. Scoring
1. Scoring engine evaluates extracted fields
2. Client's scoring criteria applied with weights
3. Go/No-Go decision made based on thresholds
4. Decision stored with full breakdown

### 4. Human Review
1. Bids in `needs_review` status presented to users
2. Reviewer can accept or override decision
3. Override stored with required reason
4. Bid status updated accordingly

### 5. JobTread Push (Future)
1. Qualified bids pushed to JobTread
2. Documents attached via JobTread API
3. Field mappings applied per client config
4. Push status tracked

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 20+ | Team familiarity, ecosystem |
| Language | TypeScript | Type safety, refactoring support |
| API Framework | Fastify | Performance, schema validation |
| Validation | Zod | Runtime + compile-time safety |
| Database | PostgreSQL | Supabase compatibility, reliability |
| ORM | Drizzle | Type-safe, lightweight, migrations |
| Package Manager | pnpm | Efficient, workspace support |

## Security Considerations

- All inputs validated with Zod
- Database queries use parameterized ORM methods
- Request IDs for traceability
- Environment-based configuration
- No secrets in code

## Scalability Notes

MVP is designed for single-instance deployment. Future scaling considerations:

- Stateless API enables horizontal scaling
- Database connection pooling configured
- PDF processing can be extracted to workers
- Event-driven architecture possible for queues


