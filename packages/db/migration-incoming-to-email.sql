-- Migration: Add to_email to incoming_bid_emails
-- Stores the intake address the email was sent to (e.g. intake-example-client-a@intake.bidcatcher.app)
-- Used for workspace filtering and debugging client routing.

ALTER TABLE incoming_bid_emails
  ADD COLUMN IF NOT EXISTS to_email varchar(255);

COMMENT ON COLUMN incoming_bid_emails.to_email IS 'Intake address email was sent to (intake-{slug}@{domain})';

SELECT 'Incoming bids to_email migration complete' AS status;
