# Bid Catcher Data Model

## Entity Relationship Diagram

```
┌─────────────┐
│   clients   │
├─────────────┤
│ id (PK)     │
│ name        │
│ slug        │───────────────────────┐
│ config      │                       │
│ ...         │                       │
└─────────────┘                       │
                                      │
      ┌───────────────────────────────┘
      │
      ▼
┌─────────────┐       ┌──────────────────┐
│    bids     │       │   bid_documents  │
├─────────────┤       ├──────────────────┤
│ id (PK)     │◄──────│ bid_id (FK)      │
│ client_id   │       │ id (PK)          │─────────┐
│ status      │       │ filename         │         │
│ ...         │       │ ...              │         │
└─────────────┘       └──────────────────┘         │
      │                                            │
      │       ┌────────────────────────────────────┘
      │       │
      │       ▼
      │  ┌──────────────────┐
      │  │ extracted_fields │
      │  ├──────────────────┤
      ├──│ bid_id (FK)      │
      │  │ document_id (FK) │
      │  │ signal_id        │
      │  │ extracted_value  │
      │  │ extraction_version│
      │  │ ...              │
      │  └──────────────────┘
      │
      ▼
┌──────────────────┐       ┌────────────────────┐
│ go_no_go_decisions│       │ decision_overrides │
├──────────────────┤       ├────────────────────┤
│ id (PK)          │◄──────│ decision_id (FK)   │
│ bid_id (FK)      │       │ bid_id (FK)        │
│ outcome          │       │ original_outcome   │
│ total_score      │       │ overridden_outcome │
│ score_breakdown  │       │ overridden_by      │
│ ...              │       │ reason             │
└──────────────────┘       └────────────────────┘
```

## Table Definitions

### clients

Represents construction companies using Bid Catcher.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(255) | Company name |
| slug | VARCHAR(100) | URL-friendly identifier (unique) |
| contact_email | VARCHAR(255) | Primary contact email |
| contact_name | VARCHAR(255) | Primary contact name |
| phone | VARCHAR(50) | Company phone |
| active | BOOLEAN | Whether client is active |
| config | JSONB | Client configuration (see below) |
| notes | TEXT | Internal notes |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### bids

Core entity representing a bid invitation.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| client_id | UUID | FK to clients |
| intake_source | VARCHAR(20) | 'web' or 'email' |
| status | VARCHAR(50) | Workflow status |
| project_name | VARCHAR(500) | Project name |
| sender_email | VARCHAR(255) | Submitter email |
| sender_name | VARCHAR(255) | Submitter name |
| sender_company | VARCHAR(255) | Submitter company |
| email_subject | VARCHAR(1000) | Email subject (if email intake) |
| raw_content | TEXT | Raw email body or notes |
| external_ref | VARCHAR(500) | External ID for deduplication |
| error_message | TEXT | Error details if status is 'error' |
| received_at | TIMESTAMPTZ | When bid was received |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Status Values:**
- `received` - Just received, not yet processed
- `processing` - Documents being extracted
- `pending_review` - Needs human review
- `qualified` - Passed go/no-go
- `disqualified` - Failed go/no-go
- `pushed_to_jobtread` - Synced to JobTread
- `error` - Processing failed

### bid_documents

Documents attached to bids.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| bid_id | UUID | FK to bids |
| filename | VARCHAR(500) | Original filename |
| content_type | VARCHAR(100) | MIME type |
| size_bytes | INTEGER | File size |
| document_type | VARCHAR(50) | Classification |
| storage_path | TEXT | Path/URL to stored file |
| content_hash | VARCHAR(64) | SHA-256 hash |
| processing_status | VARCHAR(50) | Extraction status |
| processing_error | TEXT | Error if failed |
| processed_at | TIMESTAMPTZ | When processed |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Document Types:**
- `bid_invitation`
- `plans`
- `specifications`
- `addendum`
- `other`

### extracted_fields

Fields extracted from documents. **NEVER OVERWRITTEN** - new extractions create new versions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| document_id | UUID | FK to bid_documents |
| bid_id | UUID | FK to bids (denormalized) |
| signal_id | VARCHAR(100) | Signal identifier |
| extracted_value | TEXT | Normalized extracted value |
| raw_value | TEXT | Value before normalization |
| confidence | REAL | Confidence score (0-1) |
| extraction_method | VARCHAR(50) | How it was extracted |
| page_number | INTEGER | Source page (1-indexed) |
| extraction_version | INTEGER | Version number |
| source_location | TEXT | Location in document |
| created_at | TIMESTAMPTZ | Record creation time |

**Unique Constraint:** (document_id, signal_id, extraction_version)

### go_no_go_decisions

Automated scoring decisions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| bid_id | UUID | FK to bids |
| outcome | VARCHAR(20) | 'go', 'no_go', 'needs_review' |
| total_score | REAL | Weighted total score |
| max_score | REAL | Maximum possible score |
| score_percentage | REAL | Percentage (0-100) |
| score_breakdown | JSONB | Detailed criterion scores |
| explanation | TEXT | Human-readable explanation |
| config_version | VARCHAR(20) | Config version used |
| decision_version | INTEGER | Re-score version |
| created_at | TIMESTAMPTZ | Record creation time |

### decision_overrides

Human overrides of automated decisions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| decision_id | UUID | FK to go_no_go_decisions |
| bid_id | UUID | FK to bids (denormalized) |
| original_outcome | VARCHAR(20) | Original automated outcome |
| overridden_outcome | VARCHAR(20) | New outcome after override |
| overridden_by | VARCHAR(255) | User who made override |
| reason | TEXT | Required explanation |
| metadata | JSONB | Additional context |
| created_at | TIMESTAMPTZ | Record creation time |

## Client Configuration Schema

Stored in `clients.config` as JSONB:

```typescript
{
  version: "1.0",
  clientId: "uuid",
  clientName: "ABC Construction",
  active: true,
  
  intake: {
    customFields: [...],
    allowedEmailDomains: [...],
    sendAcknowledgement: true
  },
  
  pdfExtraction: {
    signals: [
      { signalId: "project_name", label: "Project Name", required: true },
      { signalId: "bid_due_date", label: "Bid Due Date", required: true },
      // ... 12-18 signals
    ],
    enableOcr: true,
    maxPages: 100
  },
  
  scoring: {
    criteria: [
      {
        criterionId: "project_in_service_area",
        name: "Project in Service Area",
        type: "boolean",
        weight: 2,
        maxPoints: 20,
        dependsOnSignals: ["project_location"],
        rules: [...]
      },
      // ... more criteria
    ],
    autoQualifyThreshold: 75,
    autoDisqualifyThreshold: 25,
    alwaysRequireReview: false
  },
  
  jobTread: {
    enabled: false,
    fieldMappings: [...],
    autoPush: false
  },
  
  notifications: {
    newBidEmails: [...],
    reviewNeededEmails: [...]
  }
}
```

## Indexes

| Table | Index | Columns |
|-------|-------|---------|
| bids | bids_client_id_idx | client_id |
| bids | bids_status_idx | status |
| bids | bids_received_at_idx | received_at |
| bid_documents | bid_documents_bid_id_idx | bid_id |
| bid_documents | bid_documents_processing_status_idx | processing_status |
| extracted_fields | extracted_fields_document_id_idx | document_id |
| extracted_fields | extracted_fields_bid_id_idx | bid_id |
| extracted_fields | extracted_fields_signal_id_idx | signal_id |
| go_no_go_decisions | go_no_go_decisions_bid_id_idx | bid_id |
| go_no_go_decisions | go_no_go_decisions_outcome_idx | outcome |
| decision_overrides | decision_overrides_decision_id_idx | decision_id |
| decision_overrides | decision_overrides_bid_id_idx | bid_id |
| decision_overrides | decision_overrides_overridden_by_idx | overridden_by |

## Migration Strategy

Using Drizzle ORM migrations:

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Push schema directly (development only)
pnpm db:push

# Open Drizzle Studio for inspection
pnpm db:studio
```


