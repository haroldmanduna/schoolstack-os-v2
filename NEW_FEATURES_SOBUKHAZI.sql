-- ============================================
-- Sobukhazi New Features — Students, Parents, Term Results
-- Run in Supabase SQL Editor
-- Idempotent
-- ============================================

create extension if not exists "pgcrypto";

-- Students table — teacher adds students + parent link
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  name text not null,
  class_name text not null,
  gender text check (gender in ('M','F','Other')) default 'M',
  dob date,
  enrollment_no text,
  parent_name text,
  parent_email text,
  parent_phone text,
  parent_relationship text default 'Parent',
  address text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_students_project on public.students(project_slug);
create index if not exists idx_students_class on public.students(class_name);
create index if not exists idx_students_name on public.students(name);

create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_students_updated on public.students;
create trigger trg_students_updated before update on public.students for each row execute function update_updated_at();

-- Term Results — teacher posts end of term results + comments
create table if not exists public.term_results (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  student_id uuid references public.students(id) on delete set null,
  student_name text not null,
  class_name text not null,
  term text not null check (term in ('Term 1','Term 2','Term 3')),
  year int not null default 2026,
  subjects jsonb not null default '[]'::jsonb,
  total int,
  average numeric,
  position int,
  total_students int,
  teacher_comment text,
  head_comment text,
  conduct text,
  attendance_pct numeric,
  published boolean default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_results_project on public.term_results(project_slug);
create index if not exists idx_results_student on public.term_results(student_name);
create index if not exists idx_results_class on public.term_results(class_name);
create index if not exists idx_results_term on public.term_results(term, year);
drop trigger if exists trg_results_updated on public.term_results;
create trigger trg_results_updated before update on public.term_results for each row execute function update_updated_at();

-- RLS disable
alter table public.students disable row level security;
alter table public.term_results disable row level security;
drop policy if exists "allow all for anon" on public.students;
create policy "allow all for anon" on public.students for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.term_results;
create policy "allow all for anon" on public.term_results for all using (true) with check (true);
alter table public.students disable row level security;
alter table public.term_results disable row level security;

-- Seed sample students if empty
insert into public.students (project_slug, name, class_name, gender, parent_name, parent_email, parent_phone, enrollment_no, created_by_name)
select 'sobukhazi-high-school', s.name, s.class_name, s.gender, s.parent_name, s.parent_email, s.parent_phone, s.enrollment_no, 'system'
from (values
  ('Tariro Dube','3B','F','Mrs Dube','parent@sobukhazi','263771234567','SOB2026001'),
  ('Mzi Ncube','4A','M','Mr Ncube','mzi.parent@sobukhazi','263772345678','SOB2026002'),
  ('Alpha Mpofu','4A','M','Mrs Mpofu','alpha.parent@sobukhazi','263773456789','SOB2026003'),
  ('Kudzai Moyo','2A','F','Mrs Moyo','kudzai.parent@sobukhazi','263774567890','SOB2026004'),
  ('Thandi Ndlovu','3B','F','Mr Ndlovu','thandi.parent@sobukhazi','263775678901','SOB2026005')
) as s(name, class_name, gender, parent_name, parent_email, parent_phone, enrollment_no)
where not exists (select 1 from public.students where project_slug='sobukhazi-high-school' limit 1);

-- Seed sample results
insert into public.term_results (project_slug, student_name, class_name, term, year, subjects, total, average, position, total_students, teacher_comment, created_by_name, published)
select 'sobukhazi-high-school', 'Tariro Dube', '3B', 'Term 2', 2025,
  '[{"name":"English","score":78,"grade":"B","comment":"Good essay writing"},{"name":"Mathematics","score":85,"grade":"A","comment":"Excellent problem solving"},{"name":"Combined Science","score":72,"grade":"B","comment":"Needs practical improvement"},{"name":"Heritage","score":80,"grade":"A","comment":"Knows bakhazimula well"},{"name":"Ndebele","score":88,"grade":"A","comment":"Outstanding"}]'::jsonb,
  403, 80.6, 3, 45, 'Tariro is a diligent student. Shows bakhazimula spirit - cleansed challenges into strength. Keep up athletics and academics balance.', 'Mr Ncube', true
where not exists (select 1 from public.term_results where student_name='Tariro Dube' and term='Term 2' and year=2025);

-- Verify
select 'students' as table_name, count(*) as count from public.students where project_slug='sobukhazi-high-school'
union all
select 'term_results', count(*) from public.term_results where project_slug='sobukhazi-high-school'
union all
select 'portal_users', count(*) from public.portal_users where project_slug='sobukhazi-high-school'
union all
select 'announcements', count(*) from public.announcements where project_slug='sobukhazi-high-school';
