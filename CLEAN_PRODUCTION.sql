-- ============================================
-- Sobukhazi PRODUCTION CLEAN — Remove all test data
-- Run in Supabase SQL Editor to make it pitch-ready
-- Keeps portal_users (logins) but removes fake students/results
-- ============================================

-- Delete test students (if you want clean start)
-- Comment out if you want to keep real students
delete from public.students where project_slug='sobukhazi-high-school' and (
  name ilike '%Tariro%' or name ilike '%Mzi%' or name ilike '%Alpha%' or name ilike '%Kudzai%' or name ilike '%Thandi%' or created_by_name='system'
);

-- Delete test results
delete from public.term_results where project_slug='sobukhazi-high-school' and (
  student_name ilike '%Tariro%' or student_name ilike '%Mzi%' or student_name ilike '%Alpha%' or student_name ilike '%Kudzai%' or created_by_name='system' or year < 2026
);

-- Delete test late arrivals
delete from public.late_arrivals where student_name ilike '%Tariro%' or student_name ilike '%Mzi%' or student_name ilike '%Kudzai%' or marked_by_name='system';

-- Delete test notifications
delete from public.parent_notifications where student_name ilike '%Tariro%' or student_name ilike '%Mzi%' or student_name ilike '%Kudzai%';

-- Keep only real portal_users — ensure 4 core logins exist
insert into public.portal_users (project_slug, email, password_plain, role, name, created_by)
values
('sobukhazi-high-school', 'harold@schoolstack', 'admin123', 'maintainer', 'Harold Manduna', 'system'),
('sobukhazi-high-school', 'admin@sobukhazi', 'admin123', 'admin', 'Admin Office', 'system'),
('sobukhazi-high-school', 'teacher@sobukhazi', 'teacher123', 'teacher', 'Mr Ncube', 'system'),
('sobukhazi-high-school', 'parent@sobukhazi', 'parent123', 'parent', 'Parent Dube', 'system')
on conflict (project_slug, email) do update set password_plain=excluded.password_plain, role=excluded.role, name=excluded.name;

-- Verify clean
select 'students' as tbl, count(*) from public.students where project_slug='sobukhazi-high-school'
union all select 'term_results', count(*) from public.term_results where project_slug='sobukhazi-high-school'
union all select 'portal_users', count(*) from public.portal_users where project_slug='sobukhazi-high-school'
union all select 'announcements', count(*) from public.announcements where project_slug='sobukhazi-high-school'
union all select 'late_arrivals', count(*) from public.late_arrivals
union all select 'parent_notifications', count(*) from public.parent_notifications;

-- Result should be: students 0, term_results 0, portal_users 4, announcements 0-4, late 0, notifications 0 = PRODUCTION CLEAN
