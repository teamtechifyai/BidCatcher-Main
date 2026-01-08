-- Quick fix: Add new role values to enum
-- Run this in Supabase SQL Editor FIRST

-- Step 1: Add new enum values (won't error if they exist)
DO $$ 
BEGIN
  -- Add 'owner' if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'owner' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'owner';
  END IF;
  
  -- Add 'user' if it doesn't exist  
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'user' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'user';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Enum values may already exist: %', SQLERRM;
END $$;

-- Step 2: Set your account as owner (REPLACE WITH YOUR EMAIL)
UPDATE users SET role = 'owner' WHERE email = 'YOUR_EMAIL_HERE';

-- Step 3: Verify
SELECT id, email, role FROM users;

