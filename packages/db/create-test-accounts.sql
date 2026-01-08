-- ============================================
-- Create Test Accounts for Each Role
-- ============================================
-- 
-- Run this AFTER creating the accounts in Supabase Auth
-- (via the Sign Up form or Supabase Dashboard)
--
-- STEP 1: Create accounts in Supabase Auth first:
--   - Go to Authentication > Users in Supabase Dashboard
--   - Or use the Sign Up form at /login
--
-- STEP 2: Get the user IDs from auth.users:
--   SELECT id, email FROM auth.users;
--
-- STEP 3: Update the users below with the correct IDs
-- ============================================

-- REPLACE these UUIDs with actual user IDs from auth.users!

-- Example: Platform Owner (full platform access)
-- UPDATE users SET role = 'owner' WHERE email = 'owner@example.com';

-- Example: Client Admin (manages their client's config and bids)
-- UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';

-- Example: Regular User (can only upload bids)
-- UPDATE users SET role = 'user' WHERE email = 'user@example.com';


-- ============================================
-- Assign workspace memberships for non-owners
-- ============================================

-- Get client IDs first:
-- SELECT id, name FROM clients;

-- Assign an admin to a client workspace
-- INSERT INTO workspace_memberships (user_id, client_id, workspace_role, is_default)
-- VALUES (
--   (SELECT id FROM users WHERE email = 'admin@example.com'),
--   (SELECT id FROM clients WHERE slug = 'your-client-slug'),
--   'admin',
--   true
-- );

-- Assign a user to a client workspace
-- INSERT INTO workspace_memberships (user_id, client_id, workspace_role, is_default)
-- VALUES (
--   (SELECT id FROM users WHERE email = 'user@example.com'),
--   (SELECT id FROM clients WHERE slug = 'your-client-slug'),
--   'member',
--   true
-- );


-- ============================================
-- Quick Setup Script (modify emails and client)
-- ============================================

-- To quickly set up test accounts, replace the email addresses
-- and uncomment the following:

/*
-- Promote existing user to owner
UPDATE users SET role = 'owner' WHERE email = 'your-owner@email.com';

-- Set up an admin for a specific client
UPDATE users SET role = 'admin' WHERE email = 'your-admin@email.com';
INSERT INTO workspace_memberships (user_id, client_id, workspace_role, is_default)
SELECT 
  u.id,
  c.id,
  'admin',
  true
FROM users u, clients c 
WHERE u.email = 'your-admin@email.com' 
  AND c.slug = 'your-client-slug'
ON CONFLICT DO NOTHING;

-- Set up a regular user for a specific client
UPDATE users SET role = 'user' WHERE email = 'your-user@email.com';
INSERT INTO workspace_memberships (user_id, client_id, workspace_role, is_default)
SELECT 
  u.id,
  c.id,
  'member',
  true
FROM users u, clients c 
WHERE u.email = 'your-user@email.com' 
  AND c.slug = 'your-client-slug'
ON CONFLICT DO NOTHING;
*/


-- ============================================
-- Verify Setup
-- ============================================

-- Check all users and their roles:
-- SELECT u.email, u.role, u.name, u.active FROM users u ORDER BY u.role, u.email;

-- Check workspace memberships:
-- SELECT 
--   u.email, 
--   u.role as user_role,
--   c.name as client_name,
--   wm.workspace_role
-- FROM workspace_memberships wm
-- JOIN users u ON u.id = wm.user_id
-- JOIN clients c ON c.id = wm.client_id
-- ORDER BY c.name, u.email;

