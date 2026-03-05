-- Migration: Ore Samples (Criteria Trainer)
-- Run this migration to add the ore_samples table for the Criteria Trainer feature.
--
-- Ore samples are reference bids classified as GO, MAYBE, or NO with reasons.
-- Used to train/calibrate qualification criteria via AI analysis.

CREATE TABLE IF NOT EXISTS ore_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  bid_id uuid NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  outcome varchar(20) NOT NULL,
  reason text NOT NULL,
  notes text,
  added_by varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ore_samples_outcome_check CHECK (outcome IN ('GO', 'MAYBE', 'NO'))
);

CREATE INDEX IF NOT EXISTS ore_samples_client_id_idx ON ore_samples(client_id);
CREATE INDEX IF NOT EXISTS ore_samples_outcome_idx ON ore_samples(outcome);
CREATE UNIQUE INDEX IF NOT EXISTS ore_samples_client_bid_unique ON ore_samples(client_id, bid_id);

COMMENT ON TABLE ore_samples IS 'Reference bids for Criteria Trainer - classified as GO/MAYBE/NO with reasons';
COMMENT ON COLUMN ore_samples.outcome IS 'Classification: GO (Yes), MAYBE (Yes with caveats), NO';
COMMENT ON COLUMN ore_samples.reason IS 'Why this bid was classified - used for AI pattern extraction';

SELECT 'Ore samples migration complete' AS status;
