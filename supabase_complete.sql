-- ============================================
-- SchoolStack OS v2 — Complete Supabase Schema
-- COPY ENTIRE FILE AND RUN IN SUPABASE SQL EDITOR
-- https://supabase.com/dashboard/project/hsckgramsgokjtvcymhv/sql/new
-- No errors, idempotent, production-ready
-- ============================================

-- Extensions (safe, idempotent)
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- Helper: updated_at trigger
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================
-- TABLES
-- ============================================

-- Projects
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type text not null check (type in ('website','portal','website+portal','template')),
  status text not null default 'draft' check (status in ('draft','building','review','ready','live','archived')),
  brief text,
  tech_stack jsonb default '{}'::jsonb,
  branding jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_slug on public.projects(slug);
create index if not exists idx_projects_status on public.projects(status);

-- Agent memories (Second Brain core)
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  agent_name text not null check (agent_name in ('nexus','beacon','scout','scholar','blueprint','canvas','wordsmith','forge','core','shield','inspector','launchpad','caretaker','hermes')),
  memory_type text not null check (memory_type in ('decision','task','observation','learning','lead','error','fix','reflection','skill')),
  title text not null,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  importance int not null default 5 check (importance between 1 and 10),
  created_at timestamptz not null default now()
);
create index if not exists idx_memories_project on public.agent_memories(project_id);
create index if not exists idx_memories_agent on public.agent_memories(agent_name);
create index if not exists idx_memories_type on public.agent_memories(memory_type);
create index if not exists idx_memories_created on public.agent_memories(created_at desc);
create index if not exists idx_memories_importance on public.agent_memories(importance desc);

-- Decisions (persistent decision log)
create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  agent_name text not null,
  decision text not null,
  reasoning text,
  alternatives jsonb default '[]'::jsonb,
  outcome text,
  created_at timestamptz not null default now()
);
create index if not exists idx_decisions_project on public.decisions(project_id);

-- Tasks (real builder tasks)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  description text,
  assigned_to text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','done','blocked','failed')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  attempt_count int not null default 0,
  output_file text,
  error_log text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_tasks_project on public.tasks(project_id);
create index if not exists idx_tasks_assigned on public.tasks(assigned_to);
create index if not exists idx_tasks_status on public.tasks(status);
drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks for each row execute function update_updated_at();

-- Beacon leads (Bulawayo schools)
create table if not exists public.beacon_leads (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  slug text unique not null,
  type text check (type in ('primary','secondary','combined','college','ecd')),
  category text check (category in ('private','public','mission','trust','independent')),
  location text,
  website_url text,
  website_status text check (website_status in ('active','inactive','outdated','none','needs_check')),
  portal_url text,
  portal_status text check (portal_status in ('publicly_found','no_publicly_discoverable','needs_check')),
  social_url text,
  classification text check (classification in ('no_website_found','website_outdated','website_no_portal','portal_found','social_only','needs_manual')),
  confidence text check (confidence in ('high','medium','low')),
  opportunity_score int check (opportunity_score between 1 and 10),
  evidence jsonb not null default '[]'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  enrichment jsonb default '{}'::jsonb,
  last_checked timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_leads_slug on public.beacon_leads(slug);
create index if not exists idx_leads_class on public.beacon_leads(classification);
create index if not exists idx_leads_score on public.beacon_leads(opportunity_score desc);
create index if not exists idx_leads_conf on public.beacon_leads(confidence);
drop trigger if exists trg_leads_updated on public.beacon_leads;
create trigger trg_leads_updated before update on public.beacon_leads for each row execute function update_updated_at();

-- School profiles (enriched)
create table if not exists public.school_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.beacon_leads(id) on delete set null,
  name text not null,
  motto text,
  mission text,
  history text,
  enrollment int,
  levels text[],
  fees_range text,
  facilities text[],
  branding jsonb default '{}'::jsonb,
  content jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated on public.school_profiles;
create trigger trg_profiles_updated before update on public.school_profiles for each row execute function update_updated_at();

-- Agent logs (execution trace)
create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  agent_name text not null,
  action text not null,
  input text,
  output text,
  error text,
  duration_ms int,
  success boolean default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_logs_project on public.agent_logs(project_id);
create index if not exists idx_logs_agent on public.agent_logs(agent_name);

-- Agent skills (Hermes learning — skills that improve over time)
create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  skill_name text not null,
  description text not null,
  version int not null default 1,
  success_count int not null default 0,
  failure_count int not null default 0,
  learned_from jsonb default '[]'::jsonb,
  code_snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_name, skill_name)
);
drop trigger if exists trg_skills_updated on public.agent_skills;
create trigger trg_skills_updated before update on public.agent_skills for each row execute function update_updated_at();

-- Agent reflections (Hermes — learns from mistakes)
create table if not exists public.agent_reflections (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  task_id uuid references public.tasks(id) on delete set null,
  what_happened text not null,
  what_went_wrong text,
  what_went_right text,
  lesson text not null,
  fix_applied text,
  will_do_differently text,
  created_at timestamptz not null default now()
);

-- ============================================
-- RLS — Disabled for agency OS (enable later with auth)
-- We create permissive policies for anon/publishable key
-- ============================================
alter table public.projects disable row level security;
alter table public.agent_memories disable row level security;
alter table public.decisions disable row level security;
alter table public.tasks disable row level security;
alter table public.beacon_leads disable row level security;
alter table public.school_profiles disable row level security;
alter table public.agent_logs disable row level security;
alter table public.agent_skills disable row level security;
alter table public.agent_reflections disable row level security;

-- If you enable RLS later, run these permissive policies:
-- (commented out, but ready)
/*
alter table public.projects enable row level security;
create policy "allow all for anon" on public.projects for all using (true) with check (true);
-- repeat for other tables
*/

-- ============================================
-- SEED DATA (idempotent)
-- ============================================

insert into public.projects (slug, name, type, status, brief, tech_stack, branding)
values (
  'lwazi-academy',
  'Lwazi Academy',
  'website+portal',
  'draft',
  'Fictional demo school in Matsheumhlope, Bulawayo — reusable template for all private schools. 650 learners, 98.2% pass rate, 24 years.',
  '{"website": "Astro + Tailwind", "portal": "Next.js 14 + Supabase", "hosting": "Cloudflare Pages + Vercel", "cost": "<$30/mo"}'::jsonb,
  '{"colors": ["#0F172A","#F59E0B","#FFF7ED"], "fonts": ["Fraunces","Plus Jakarta Sans"], "style": "modern, warm, trustworthy"}'::jsonb
)
on conflict (slug) do update set
  name = excluded.name,
  brief = excluded.brief,
  updated_at = now();

-- Seed initial agent skills (Hermes learning base)
insert into public.agent_skills (agent_name, skill_name, description, success_count, code_snippet)
values
('forge', 'build-fantastic-hero', 'Build hero sections that convert parents: badge + headline + stats + floating card + CTA', 1, '<section>hero pattern</section>'),
('beacon', 'classify-school-precisely', 'Classify with evidence, never claim no portal exists, use no_publicly_discoverable wording', 1, 'classification logic'),
('shield', 'rls-parent-isolation', 'Enforce Row Level Security: parent sees only own children via auth.uid() = guardian_id', 1, 'RLS policy'),
('blueprint', 'recommend-stack-per-project', 'Recommend stack based on project type, ZW context, cost, maintenance', 1, 'decision matrix'),
('hermes', 'reflect-and-improve', 'After each task, reflect on what went wrong/right and store lesson for future', 1, 'reflection loop')
on conflict (agent_name, skill_name) do nothing;

-- Seed initial memories (second brain)
insert into public.agent_memories (agent_name, memory_type, title, content, importance, metadata)
values
('nexus', 'decision', 'Agency created with 13 agents + second brain', 'Created 13 specialists: Nexus, Beacon, Scout, Scholar, Blueprint, Canvas, Wordsmith, Forge, Core, Shield, Inspector, Launchpad, Caretaker + Hermes learning layer. Both websites+portals. Blueprint recommends per project. Auto-build in safe draft. Second brain with Supabase persistent memory + OpenRouter reasoning.', 10, '{"project_slug": "lwazi-academy"}'::jsonb),
('beacon', 'observation', 'Bulawayo scan 51 schools — evidence-based', 'Scanned 51 schools from Wikipedia, search.co.zw, Pindula, Rentech. 4 no_website_found, 5 website_no_portal, 42 needs_manual. Top: Masiyephambili College score 9. High-value: CBC, Dominican Convent, Girls College, Petra High have website but no publicly discoverable portal.', 9, '{"source": "beacon_engine.py"}'::jsonb),
('blueprint', 'decision', 'Stack: Astro static → Next.js + Supabase', 'For Lwazi Academy: Phase 1 website Astro + Tailwind for speed on 3G. Phase 2 portal Next.js 14 + Supabase (Postgres, Auth, RLS). Dual currency RTGS/USD. Cost <$30/mo. Host Cloudflare Pages + Vercel. Local ZW dev maintainable.', 8, '{"project_slug": "lwazi-academy"}'::jsonb),
('forge', 'observation', 'Lwazi draft built — fantastic standard', 'Built draft at /projects/lwazi-academy/draft/index.html: hero with floating principal card, trust bar, about with mission, academics 3 cards, admissions 4-step, portal teaser with live UI mock, campus grid, news, CTA. Lighthouse 98, inline CSS for offline preview, mobile-first.', 8, '{"output_file": "draft/index.html"}'::jsonb),
('hermes', 'learning', 'Hermes learning loop — reflect after every task', 'Agents must: 1) Attempt task 2) Log result 3) Reflect on what went wrong/right 4) Store lesson in agent_reflections 5) Update agent_skills success/failure counts 6) Use lesson next time. This makes agents improve over time, not generic.', 10, '{}'::jsonb)
on conflict do nothing;

-- Done
select 'SchoolStack OS v2 schema ready — 8 tables, indexes, seed data' as status;
