-- Portal Advanced — Admin Announcements + Users + Credentials Management
-- Run this in Supabase SQL Editor after late_arrivals.sql

-- Announcements table — Admin posts, appears on website homepage News
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  title text not null,
  content text not null,
  category text check (category in ('ACADEMICS','SPORTS','GENERAL','EVENTS')) default 'GENERAL',
  image_url text,
  author_name text,
  author_email text,
  author_role text check (author_role in ('admin','maintainer','teacher')) default 'admin',
  published boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ann_project on public.announcements(project_slug);
create index if not exists idx_ann_created on public.announcements(created_at desc);
create index if not exists idx_ann_published on public.announcements(published);

-- Portal users table — Maintainer, Admin, Teacher, Parent credentials
create table if not exists public.portal_users (
  id uuid primary key default gen_random_uuid(),
  project_slug text not null default 'sobukhazi-high-school',
  email text not null,
  password_hash text, -- for demo plain text, real use bcrypt
  password_plain text, -- demo only
  role text not null check (role in ('maintainer','admin','teacher','parent')),
  name text not null,
  phone text,
  student_name text, -- for parent role, which child
  class_name text,
  active boolean default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_slug, email)
);
create index if not exists idx_portal_users_project on public.portal_users(project_slug);
create index if not exists idx_portal_users_role on public.portal_users(role);
create index if not exists idx_portal_users_email on public.portal_users(email);

-- Disable RLS for agency OS (public access for demo)
alter table public.announcements disable row level security;
alter table public.portal_users disable row level security;

-- Seed default users — Maintainer is you
insert into public.portal_users (project_slug, email, password_plain, role, name, created_by)
values
('sobukhazi-high-school', 'harold@schoolstack', 'admin123', 'maintainer', 'Harold Manduna', 'system'),
('sobukhazi-high-school', 'admin@sobukhazi', 'admin123', 'admin', 'Admin Office', 'harold@schoolstack'),
('sobukhazi-high-school', 'teacher@sobukhazi', 'teacher123', 'teacher', 'Mr Ncube', 'admin@sobukhazi'),
('sobukhazi-high-school', 'parent@sobukhazi', 'parent123', 'parent', 'Parent Dube', 'admin@sobukhazi')
on conflict (project_slug, email) do update set password_plain=excluded.password_plain, role=excluded.role, name=excluded.name;

-- Seed announcements
insert into public.announcements (project_slug, title, content, category, author_name, author_role)
values
('sobukhazi-high-school', 'Form 1 Admissions 2026 Open', 'Applications for Form 1 2026 now open. Bring Grade 7 results, birth certificate, parent ID to Old Fall Rd office. Contact 09200581.', 'ACADEMICS', 'Admin Office', 'admin'),
('sobukhazi-high-school', 'Reigate Champions Celebration', '54 medals, 29 gold at White City Stadium. Celebration assembly held on 20 Dec 2024. Congratulations to all athletes - Mzi Ncube 10.06s 100m, Alpha Mpofu 21.37s 200m.', 'SPORTS', 'Admin Office', 'admin'),
('sobukhazi-high-school', 'Green Uniform Reminder', 'All students must be in full green uniform: white shirt, green skirt/trousers, long green socks, green jersey. Uniform symbolizes growth and bakhazimula heritage.', 'GENERAL', 'Admin Office', 'admin')
on conflict do nothing;

select 'Portal Advanced ready — announcements + portal_users tables + seed data' as status;
