-- GHL Integration: Add ghl_contact_id, ghl_opportunity_id, ghl_sync_state table
-- Run this in Supabase SQL Editor

-- Add ghl_contact_id to clients
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ghl_contact_id" varchar(100);

-- Add ghl_opportunity_id to bids
ALTER TABLE "bids" ADD COLUMN IF NOT EXISTS "ghl_opportunity_id" varchar(100);

-- GHL Sync State table (for conflict avoidance)
CREATE TABLE IF NOT EXISTS "ghl_sync_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entity_type" varchar(20) NOT NULL,
  "entity_id" uuid NOT NULL,
  "ghl_id" varchar(100) NOT NULL,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_sync_source" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ghl_sync_state_entity_idx" ON "ghl_sync_state" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "ghl_sync_state_ghl_id_idx" ON "ghl_sync_state" ("ghl_id");

SELECT 'GHL integration schema updated!' as status;
