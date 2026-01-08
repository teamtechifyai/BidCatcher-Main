-- Fix RLS Policies for BidCatcher
-- Run this in Supabase SQL Editor

-- ============================================
-- Step 1: Ensure tables have RLS enabled
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Step 2: Drop ALL existing policies (clean slate)
-- ============================================
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    -- Drop all policies on users
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'users'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON users', pol.policyname);
    END LOOP;
    
    -- Drop all policies on clients
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'clients'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON clients', pol.policyname);
    END LOOP;
    
    -- Drop all policies on workspace_memberships
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'workspace_memberships'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON workspace_memberships', pol.policyname);
    END LOOP;
    
    -- Drop all policies on bids
    FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'bids'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON bids', pol.policyname);
    END LOOP;
END $$;

-- ============================================
-- Step 3: Create simple, permissive policies
-- ============================================

-- USERS TABLE: Everyone can read their own, owners can read all
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_select_owner" ON users
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner')
  );

CREATE POLICY "users_insert_self" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "users_owner_all" ON users
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner')
  );

-- CLIENTS TABLE: Owners can do everything, others read via membership
CREATE POLICY "clients_owner_all" ON clients
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner')
  );

CREATE POLICY "clients_member_select" ON clients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm 
      WHERE wm.user_id = auth.uid() AND wm.client_id = clients.id
    )
  );

-- WORKSPACE_MEMBERSHIPS TABLE: Users see own, owners see all
CREATE POLICY "memberships_select_own" ON workspace_memberships
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "memberships_owner_all" ON workspace_memberships
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner')
  );

-- BIDS TABLE: Access based on client membership
CREATE POLICY "bids_owner_all" ON bids
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner')
  );

CREATE POLICY "bids_member_select" ON bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm 
      WHERE wm.user_id = auth.uid() AND wm.client_id = bids.client_id
    )
  );

CREATE POLICY "bids_member_insert" ON bids
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm 
      WHERE wm.user_id = auth.uid() AND wm.client_id = bids.client_id
    )
  );

-- ============================================
-- Step 4: Grant permissions to authenticated role
-- ============================================
GRANT ALL ON users TO authenticated;
GRANT ALL ON clients TO authenticated;
GRANT ALL ON workspace_memberships TO authenticated;
GRANT ALL ON bids TO authenticated;

-- ============================================
-- Step 5: Verify your user is set up correctly
-- ============================================
SELECT id, email, role FROM users WHERE email = 'ajb.8business@gmail.com';

