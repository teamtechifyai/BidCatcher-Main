-- Go/No-Go Decision Engine Schema Updates
-- Run this in Supabase SQL Editor after the initial migration

-- 1. Add missing columns to go_no_go_decisions if they don't exist
DO $$ 
BEGIN
  -- Add inputs_snapshot column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='inputs_snapshot') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "inputs_snapshot" jsonb;
    UPDATE go_no_go_decisions SET inputs_snapshot = '{}'::jsonb WHERE inputs_snapshot IS NULL;
    ALTER TABLE go_no_go_decisions ALTER COLUMN "inputs_snapshot" SET NOT NULL;
  END IF;
  
  -- Add thresholds_used column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='thresholds_used') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "thresholds_used" jsonb;
    UPDATE go_no_go_decisions SET thresholds_used = '{"goThreshold":75,"noThreshold":25}'::jsonb WHERE thresholds_used IS NULL;
    ALTER TABLE go_no_go_decisions ALTER COLUMN "thresholds_used" SET NOT NULL;
  END IF;
  
  -- Rename explanation to rationale if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='explanation') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='rationale') THEN
    ALTER TABLE go_no_go_decisions RENAME COLUMN "explanation" TO "rationale";
  END IF;
  
  -- Add rationale if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='go_no_go_decisions' AND column_name='rationale') THEN
    ALTER TABLE go_no_go_decisions ADD COLUMN "rationale" text;
    UPDATE go_no_go_decisions SET rationale = '' WHERE rationale IS NULL;
    ALTER TABLE go_no_go_decisions ALTER COLUMN "rationale" SET NOT NULL;
  END IF;
END $$;

-- 2. Add reason_category to decision_overrides if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='reason_category') THEN
    ALTER TABLE decision_overrides ADD COLUMN "reason_category" varchar(50);
    UPDATE decision_overrides SET reason_category = 'other' WHERE reason_category IS NULL;
    ALTER TABLE decision_overrides ALTER COLUMN "reason_category" SET NOT NULL;
  END IF;
  
  -- Rename reason to rationale if needed
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='reason') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='rationale') THEN
    ALTER TABLE decision_overrides RENAME COLUMN "reason" TO "rationale";
  END IF;
  
  -- Add rationale if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='decision_overrides' AND column_name='rationale') THEN
    ALTER TABLE decision_overrides ADD COLUMN "rationale" text;
    UPDATE decision_overrides SET rationale = '' WHERE rationale IS NULL;
    ALTER TABLE decision_overrides ALTER COLUMN "rationale" SET NOT NULL;
  END IF;
END $$;

SELECT 'Decision schema migration completed!' as status;


