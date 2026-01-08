-- JobTread Handoffs Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS "jobtread_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bid_id" uuid NOT NULL REFERENCES "bids"("id") ON DELETE CASCADE,
  "status" varchar(50) NOT NULL,
  "payload_snapshot" jsonb NOT NULL,
  "mock_jobtread_id" varchar(100),
  "document_attachments" jsonb,
  "error_message" text,
  "initiated_by" varchar(255),
  "handoff_version" varchar(20) DEFAULT '1',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "jobtread_handoffs_bid_id_idx" ON "jobtread_handoffs" ("bid_id");
CREATE INDEX IF NOT EXISTS "jobtread_handoffs_status_idx" ON "jobtread_handoffs" ("status");
CREATE INDEX IF NOT EXISTS "jobtread_handoffs_mock_jobtread_id_idx" ON "jobtread_handoffs" ("mock_jobtread_id");

SELECT 'JobTread handoffs table created!' as status;


