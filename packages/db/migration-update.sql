-- Go/No-Go Decision Engine Schema Updates
-- Run this in Supabase SQL Editor to add decision engine columns
-- This is a safe, idempotent migration

-- 1. Add missing columns to go_no_go_decisions
DO $$ 
BEGIN
  -- Add inputs_snapshot column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='inputs_snapshot') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "inputs_snapshot" jsonb NOT NULL DEFAULT '{}';
  END IF;
  
  -- Add thresholds_used column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='thresholds_used') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "thresholds_used" jsonb NOT NULL DEFAULT '{}';
  END IF;
  
  -- Add rationale column (rename from explanation if exists)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='explanation') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='rationale') THEN
    ALTER TABLE go_no_go_decisions RENAME COLUMN "explanation" TO "rationale";
  END IF;
  
  -- Add rationale if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='rationale') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "rationale" text NOT NULL DEFAULT '';
  END IF;
END $$;

-- 2. Add reason_category to decision_overrides if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='reason_category') THEN
    ALTER TABLE decision_overrides ADD COLUMN "reason_category" varchar(50) NOT NULL DEFAULT 'other';
  END IF;
  
  -- Rename reason to rationale if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='reason') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='rationale') THEN
    ALTER TABLE decision_overrides RENAME COLUMN "reason" TO "rationale";
  END IF;
  
  -- Add rationale if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='rationale') THEN
    ALTER TABLE decision_overrides ADD COLUMN "rationale" text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Verify the updates
SELECT 'go_no_go_decisions columns:' as info;
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'go_no_go_decisions' ORDER BY ordinal_position;

SELECT 'decision_overrides columns:' as info;
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'decision_overrides' ORDER BY ordinal_position;

SELECT 'Decision schema migration completed!' as status;


