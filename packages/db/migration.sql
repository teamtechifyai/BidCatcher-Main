-- Bid Catcher Database Schema (Safe Migration)
-- Handles existing tables/constraints gracefully
-- Run in Supabase SQL Editor

-- 1. Create clients table
CREATE TABLE IF NOT EXISTS "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(100) NOT NULL,
  "contact_email" varchar(255) NOT NULL,
  "contact_name" varchar(255),
  "phone" varchar(50),
  "active" boolean DEFAULT true NOT NULL,
  "config" jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);

-- 2. Create bids table
CREATE TABLE IF NOT EXISTS "bids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "intake_source" varchar(20) NOT NULL,
  "status" varchar(50) DEFAULT 'new' NOT NULL,
  "project_name" varchar(500),
  "sender_email" varchar(255),
  "sender_name" varchar(255),
  "sender_company" varchar(255),
  "email_subject" varchar(1000),
  "email_body" text,
  "raw_payload" jsonb,
  "external_ref" varchar(500),
  "validation_warnings" jsonb,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "bids_external_ref_unique" UNIQUE("external_ref")
);

-- Add missing columns to bids if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='email_body') THEN
    ALTER TABLE bids ADD COLUMN "email_body" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='raw_payload') THEN
    ALTER TABLE bids ADD COLUMN "raw_payload" jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bids' AND column_name='validation_warnings') THEN
    ALTER TABLE bids ADD COLUMN "validation_warnings" jsonb;
  END IF;
END $$;

-- 3. Create bid_documents table
CREATE TABLE IF NOT EXISTS "bid_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bid_id" uuid NOT NULL,
  "filename" varchar(500) NOT NULL,
  "content_type" varchar(100) NOT NULL,
  "size_bytes" integer,
  "document_type" varchar(50) DEFAULT 'other' NOT NULL,
  "storage_path" text,
  "content_hash" varchar(64),
  "processing_status" varchar(50) DEFAULT 'pending' NOT NULL,
  "processing_error" text,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 4. Create extracted_fields table
CREATE TABLE IF NOT EXISTS "extracted_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "bid_id" uuid NOT NULL,
  "signal_id" varchar(100) NOT NULL,
  "extracted_value" text,
  "raw_value" text,
  "confidence" real,
  "extraction_method" varchar(50),
  "page_number" integer,
  "extraction_version" integer DEFAULT 1 NOT NULL,
  "source_location" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add unique constraint if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_fields_unique') THEN
    ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_unique" UNIQUE("document_id","signal_id","extraction_version");
  END IF;
END $$;

-- 5. Create go_no_go_decisions table (with new schema columns)
CREATE TABLE IF NOT EXISTS "go_no_go_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bid_id" uuid NOT NULL,
  "outcome" varchar(20) NOT NULL,
  "total_score" real NOT NULL,
  "max_score" real NOT NULL,
  "score_percentage" real NOT NULL,
  "inputs_snapshot" jsonb NOT NULL DEFAULT '{}',
  "thresholds_used" jsonb NOT NULL DEFAULT '{}',
  "score_breakdown" jsonb NOT NULL,
  "rationale" text NOT NULL DEFAULT '',
  "config_version" varchar(20),
  "decision_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add new columns to go_no_go_decisions if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='inputs_snapshot') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "inputs_snapshot" jsonb NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='thresholds_used') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "thresholds_used" jsonb NOT NULL DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='rationale') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "rationale" text NOT NULL DEFAULT '';
  END IF;
END $$;

-- 6. Create decision_overrides table (with updated schema)
CREATE TABLE IF NOT EXISTS "decision_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "decision_id" uuid NOT NULL,
  "bid_id" uuid NOT NULL,
  "original_outcome" varchar(20) NOT NULL,
  "overridden_outcome" varchar(20) NOT NULL,
  "reason_category" varchar(50) NOT NULL DEFAULT 'other',
  "overridden_by" varchar(255) NOT NULL,
  "rationale" text NOT NULL DEFAULT '',
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add new columns to decision_overrides if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='reason_category') THEN
    ALTER TABLE decision_overrides ADD COLUMN "reason_category" varchar(50) NOT NULL DEFAULT 'other';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='rationale') THEN
    ALTER TABLE decision_overrides ADD COLUMN "rationale" text NOT NULL DEFAULT '';
  END IF;
END $$;

-- 7. Create indexes (IF NOT EXISTS handles duplicates)
CREATE INDEX IF NOT EXISTS "bids_client_id_idx" ON "bids" ("client_id");
CREATE INDEX IF NOT EXISTS "bids_status_idx" ON "bids" ("status");
CREATE INDEX IF NOT EXISTS "bids_received_at_idx" ON "bids" ("received_at");
CREATE INDEX IF NOT EXISTS "bid_documents_bid_id_idx" ON "bid_documents" ("bid_id");
CREATE INDEX IF NOT EXISTS "bid_documents_processing_status_idx" ON "bid_documents" ("processing_status");
CREATE INDEX IF NOT EXISTS "extracted_fields_document_id_idx" ON "extracted_fields" ("document_id");
CREATE INDEX IF NOT EXISTS "extracted_fields_bid_id_idx" ON "extracted_fields" ("bid_id");
CREATE INDEX IF NOT EXISTS "extracted_fields_signal_id_idx" ON "extracted_fields" ("signal_id");
CREATE INDEX IF NOT EXISTS "decision_overrides_decision_id_idx" ON "decision_overrides" ("decision_id");
CREATE INDEX IF NOT EXISTS "decision_overrides_bid_id_idx" ON "decision_overrides" ("bid_id");
CREATE INDEX IF NOT EXISTS "decision_overrides_overridden_by_idx" ON "decision_overrides" ("overridden_by");
CREATE INDEX IF NOT EXISTS "go_no_go_decisions_bid_id_idx" ON "go_no_go_decisions" ("bid_id");
CREATE INDEX IF NOT EXISTS "go_no_go_decisions_outcome_idx" ON "go_no_go_decisions" ("outcome");

-- 8. Add foreign key constraints (safely, skip if exists)
DO $$ BEGIN
  ALTER TABLE "bids" ADD CONSTRAINT "bids_client_id_clients_id_fk" 
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_bid_id_bids_id_fk" 
    FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_bid_documents_id_fk" 
    FOREIGN KEY ("document_id") REFERENCES "bid_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_bid_id_bids_id_fk" 
    FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "decision_overrides" ADD CONSTRAINT "decision_overrides_decision_id_go_no_go_decisions_id_fk" 
    FOREIGN KEY ("decision_id") REFERENCES "go_no_go_decisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "decision_overrides" ADD CONSTRAINT "decision_overrides_bid_id_bids_id_fk" 
    FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "go_no_go_decisions" ADD CONSTRAINT "go_no_go_decisions_bid_id_bids_id_fk" 
    FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 9. Insert test client with comprehensive scoring criteria
INSERT INTO "clients" ("id", "name", "slug", "contact_email", "config") 
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Test Construction Co',
  'test-construction',
  'test@example.com',
  '{
    "version": "1.0",
    "clientId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "clientName": "Test Construction Co",
    "active": true,
    "intake": {
      "requiredFields": ["projectName", "senderEmail"],
      "customFields": [],
      "allowedEmailDomains": [],
      "sendAcknowledgement": true
    },
    "pdfExtraction": {
      "signals": [
        {"signalId": "project_name", "label": "Project Name", "required": true},
        {"signalId": "bid_due_date", "label": "Bid Due Date", "required": true},
        {"signalId": "project_location", "label": "Project Location", "required": false},
        {"signalId": "project_value", "label": "Estimated Project Value", "required": false},
        {"signalId": "gc_name", "label": "General Contractor", "required": false},
        {"signalId": "project_type", "label": "Project Type", "required": false}
      ],
      "enableOcr": true,
      "maxPages": 100
    },
    "scoring": {
      "criteria": [
        {
          "criterionId": "has_project_name",
          "name": "Project Name Available",
          "type": "boolean",
          "weight": 1,
          "maxPoints": 10,
          "dependsOnSignals": ["project_name"],
          "rules": [
            {"signal": "project_name", "condition": "exists", "points": 10}
          ]
        },
        {
          "criterionId": "has_due_date",
          "name": "Due Date Specified",
          "type": "boolean",
          "weight": 1.5,
          "maxPoints": 15,
          "dependsOnSignals": ["bid_due_date"],
          "rules": [
            {"signal": "bid_due_date", "condition": "exists", "points": 15}
          ]
        },
        {
          "criterionId": "has_location",
          "name": "Location Specified",
          "type": "boolean",
          "weight": 1,
          "maxPoints": 10,
          "dependsOnSignals": ["project_location"],
          "rules": [
            {"signal": "project_location", "condition": "exists", "points": 10}
          ]
        },
        {
          "criterionId": "known_gc",
          "name": "Known GC",
          "type": "boolean",
          "weight": 2,
          "maxPoints": 20,
          "dependsOnSignals": ["gc_name"],
          "rules": [
            {"signal": "gc_name", "condition": "exists", "points": 20}
          ]
        },
        {
          "criterionId": "project_value_threshold",
          "name": "Project Value > $50K",
          "type": "numeric",
          "weight": 2,
          "maxPoints": 25,
          "dependsOnSignals": ["project_value"],
          "rules": [
            {"signal": "project_value", "condition": "gt", "value": 50000, "points": 25}
          ]
        }
      ],
      "autoQualifyThreshold": 70,
      "autoDisqualifyThreshold": 30,
      "alwaysRequireReview": false
    },
    "jobTread": {
      "enabled": false,
      "fieldMappings": [],
      "autoPush": false
    },
    "notifications": {
      "newBidEmails": [],
      "reviewNeededEmails": []
    }
  }'::jsonb
)
ON CONFLICT ("id") DO UPDATE SET 
  config = EXCLUDED.config,
  "updated_at" = now();

-- Done!
SELECT 'Migration completed successfully!' as status;
