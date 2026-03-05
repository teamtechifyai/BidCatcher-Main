-- Migration: Resend Per-Client Incoming Emails
-- Run this migration manually to switch from Gmail to Resend.
--
-- Changes:
-- 1. Add client_id to incoming_bid_emails (nullable for emails without client routing)
-- 2. Add resend_email_id for Resend deduplication and API calls
-- 3. Remove gmail_message_id (replaced by resend_email_id)
-- 4. Update external_ref usage: bids.external_ref can store resend_email_id when processing

-- Step 1: Add new columns
ALTER TABLE incoming_bid_emails
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resend_email_id varchar(255) UNIQUE;

-- Step 2: Create index for client_id lookups
CREATE INDEX IF NOT EXISTS incoming_bid_emails_client_id_idx ON incoming_bid_emails(client_id);
CREATE INDEX IF NOT EXISTS incoming_bid_emails_resend_email_id_idx ON incoming_bid_emails(resend_email_id);

-- Step 3: Migrate gmail_message_id to resend_email_id if you have existing data
-- (Only run if you have data to migrate - otherwise skip)
-- UPDATE incoming_bid_emails SET resend_email_id = gmail_message_id WHERE gmail_message_id IS NOT NULL;

-- Step 4: Drop gmail_message_id column
ALTER TABLE incoming_bid_emails DROP COLUMN IF EXISTS gmail_message_id;

-- Step 5: Update comments
COMMENT ON COLUMN incoming_bid_emails.client_id IS 'Client this email was routed to (from Resend to-address)';
COMMENT ON COLUMN incoming_bid_emails.resend_email_id IS 'Resend email ID for deduplication and API fetches';

SELECT 'Resend incoming emails migration complete' AS status;
