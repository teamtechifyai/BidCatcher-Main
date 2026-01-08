-- Migration: Update user roles
-- New roles: owner, admin, user
-- owner = platform owner (was: admin)
-- admin = client admin (new role for client account managers)
-- user = regular user who can upload bids (was: client_user)

-- Step 1: Add new enum values (PostgreSQL requires this approach)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'user';

-- Step 2: Update existing data
-- Convert old 'admin' users to 'owner' (platform admins become owners)
UPDATE users SET role = 'owner' WHERE role = 'admin';

-- Convert old 'client_user' to 'user'
UPDATE users SET role = 'user' WHERE role = 'client_user';

-- Step 3: Update the default
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Note: We keep 'admin' and 'client_user' in the enum for backwards compatibility
-- New signups will default to 'user' role

-- ============================================
-- Row Level Security Policies
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Owners can view all users" ON users;
DROP POLICY IF EXISTS "Owners can manage all users" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Allow insert for authenticated users" ON users;

DROP POLICY IF EXISTS "Users can view own memberships" ON workspace_memberships;
DROP POLICY IF EXISTS "Owners can view all memberships" ON workspace_memberships;
DROP POLICY IF EXISTS "Owners can manage all memberships" ON workspace_memberships;
DROP POLICY IF EXISTS "Allow insert for authenticated" ON workspace_memberships;

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Users table policies
-- ============================================

-- Everyone can view their own profile
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

-- Owners can view all users
CREATE POLICY "Owners can view all users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Owners can update any user
CREATE POLICY "Owners can manage all users" ON users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Users can update their own profile (name, avatar)
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Allow insert for authenticated users (for auto-creation on first login)
CREATE POLICY "Allow insert for authenticated users" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================
-- Workspace memberships policies
-- ============================================

-- Users can view their own memberships
CREATE POLICY "Users can view own memberships" ON workspace_memberships
  FOR SELECT USING (user_id = auth.uid());

-- Owners can view all memberships
CREATE POLICY "Owners can view all memberships" ON workspace_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Owners can manage all memberships
CREATE POLICY "Owners can manage all memberships" ON workspace_memberships
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Admins can view memberships for their workspaces
CREATE POLICY "Admins can view workspace memberships" ON workspace_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      JOIN users u ON u.id = auth.uid()
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = workspace_memberships.client_id
        AND u.role = 'admin'
    )
  );

-- Allow insert for authenticated (needed for workspace assignment)
CREATE POLICY "Allow insert for authenticated" ON workspace_memberships
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('owner', 'admin')
    )
  );

-- ============================================
-- Clients table policies (if not exists)
-- ============================================

-- Enable RLS on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Owners can do everything on clients" ON clients;
DROP POLICY IF EXISTS "Admins can view their clients" ON clients;
DROP POLICY IF EXISTS "Admins can update their clients" ON clients;
DROP POLICY IF EXISTS "Users can view their clients" ON clients;

-- Owners can do everything
CREATE POLICY "Owners can do everything on clients" ON clients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Admins can view and update their assigned clients
CREATE POLICY "Admins can view their clients" ON clients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      JOIN users u ON u.id = auth.uid()
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = clients.id
        AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can update their clients" ON clients
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      JOIN users u ON u.id = auth.uid()
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = clients.id
        AND u.role = 'admin'
    )
  );

-- Users can view their assigned clients (read-only)
CREATE POLICY "Users can view their clients" ON clients
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = clients.id
    )
  );

-- ============================================
-- Bids table policies
-- ============================================

-- Enable RLS on bids
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Owners can do everything on bids" ON bids;
DROP POLICY IF EXISTS "Admins can manage their bids" ON bids;
DROP POLICY IF EXISTS "Users can view their bids" ON bids;
DROP POLICY IF EXISTS "Users can insert bids" ON bids;

-- Owners can do everything
CREATE POLICY "Owners can do everything on bids" ON bids
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'owner'
    )
  );

-- Admins can manage bids for their clients
CREATE POLICY "Admins can manage their bids" ON bids
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      JOIN users u ON u.id = auth.uid()
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = bids.client_id
        AND u.role = 'admin'
    )
  );

-- Users can view bids for their clients
CREATE POLICY "Users can view their bids" ON bids
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = bids.client_id
    )
  );

-- Users can insert bids for their clients
CREATE POLICY "Users can insert bids" ON bids
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.client_id = bids.client_id
    )
  );

-- ============================================
-- Grant permissions
-- ============================================
GRANT ALL ON users TO authenticated;
GRANT ALL ON workspace_memberships TO authenticated;
GRANT ALL ON clients TO authenticated;
GRANT ALL ON bids TO authenticated;

