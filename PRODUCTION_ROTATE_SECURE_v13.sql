-- PRODUCTION SECURE v13 — Rotate credentials, ensure no test data, verify clean
-- Run in Supabase SQL editor AFTER pushing secure portal

-- 1. Ensure portal_users table exists and has correct schema
-- Check existing users
SELECT email, role, name, created_at FROM portal_users WHERE project_slug='sobukhazi-high-school' ORDER BY role;

-- 2. Rotate maintainer password to new secure one (change this!)
-- IMPORTANT: Change password hash — this sets new password to Sobukhazi2026!Secure (example, change it)
-- The app uses plaintext comparison in /api/portal/login — it checks password field directly
-- So update password field to new secure password

-- Option A: Set new strong passwords (RECOMMENDED — change these to what you give client privately)
UPDATE portal_users SET password='Sobukhazi2026!Secure' WHERE email='harold@schoolstack' AND project_slug='sobukhazi-high-school';
UPDATE portal_users SET password='AdminSob2026!Secure' WHERE email='admin@sobukhazi' AND project_slug='sobukhazi-high-school';
UPDATE portal_users SET password='TeacherSob2026!Secure' WHERE email='teacher@sobukhazi' AND project_slug='sobukhazi-high-school';
UPDATE portal_users SET password='ParentSob2026!Demo' WHERE email='parent@sobukhazi' AND project_slug='sobukhazi-high-school';

-- Verify rotated
SELECT email, role, LEFT(password,3)||'***' as pwd_masked FROM portal_users WHERE project_slug='sobukhazi-high-school';

-- 3. Ensure production clean — no fake students
-- Delete any test data if exists
DELETE FROM students WHERE project_slug='sobukhazi-high-school' AND (name ILIKE '%test%' OR name ILIKE '%tariro%' OR name ILIKE '%mzi%' OR name ILIKE '%john doe%');
DELETE FROM term_results WHERE project_slug='sobukhazi-high-school' AND (student_name ILIKE '%test%' OR student_name ILIKE '%tariro%');

-- Verify clean
SELECT COUNT(*) as students_count FROM students WHERE project_slug='sobukhazi-high-school';
SELECT COUNT(*) as results_count FROM term_results WHERE project_slug='sobukhazi-high-school';

-- 4. Ensure RLS disabled for now (as per existing setup) — or enable with policies later
-- ALTER TABLE students DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE term_results DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE portal_users DISABLE ROW LEVEL SECURITY;

-- 5. Final verification queries for pitch
SELECT 'Students' as table_name, COUNT(*) as count FROM students WHERE project_slug='sobukhazi-high-school'
UNION ALL
SELECT 'Results', COUNT(*) FROM term_results WHERE project_slug='sobukhazi-high-school'
UNION ALL
SELECT 'Users', COUNT(*) FROM portal_users WHERE project_slug='sobukhazi-high-school'
UNION ALL
SELECT 'Announcements', COUNT(*) FROM announcements WHERE project_slug='sobukhazi-high-school';

-- Expected: Students 0, Results 0, Users 4, Announcements maybe 0-2 — PRODUCTION CLEAN READY FOR REAL IMPORT
