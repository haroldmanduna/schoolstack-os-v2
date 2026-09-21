-- Fix RLS for SchoolStack OS v2 — Run this after supabase_complete.sql if you get RLS errors

-- Disable RLS on all tables (for agency OS with publishable key)
alter table public.projects disable row level security;
alter table public.agent_memories disable row level security;
alter table public.decisions disable row level security;
alter table public.tasks disable row level security;
alter table public.beacon_leads disable row level security;
alter table public.school_profiles disable row level security;
alter table public.agent_logs disable row level security;
alter table public.agent_skills disable row level security;
alter table public.agent_reflections disable row level security;

-- Also drop any existing restrictive policies and create permissive ones (in case RLS gets re-enabled)
-- This ensures anon key (publishable) can do everything

-- Projects
drop policy if exists "allow all for anon" on public.projects;
drop policy if exists "allow all" on public.projects;
create policy "allow all for anon" on public.projects for all using (true) with check (true);

-- Memories
drop policy if exists "allow all for anon" on public.agent_memories;
drop policy if exists "allow all" on public.agent_memories;
create policy "allow all for anon" on public.agent_memories for all using (true) with check (true);

-- Decisions
drop policy if exists "allow all for anon" on public.decisions;
drop policy if exists "allow all" on public.decisions;
create policy "allow all for anon" on public.decisions for all using (true) with check (true);

-- Tasks
drop policy if exists "allow all for anon" on public.tasks;
drop policy if exists "allow all" on public.tasks;
create policy "allow all for anon" on public.tasks for all using (true) with check (true);

-- Beacon leads
drop policy if exists "allow all for anon" on public.beacon_leads;
drop policy if exists "allow all" on public.beacon_leads;
create policy "allow all for anon" on public.beacon_leads for all using (true) with check (true);

-- School profiles
drop policy if exists "allow all for anon" on public.school_profiles;
drop policy if exists "allow all" on public.school_profiles;
create policy "allow all for anon" on public.school_profiles for all using (true) with check (true);

-- Logs
drop policy if exists "allow all for anon" on public.agent_logs;
drop policy if exists "allow all" on public.agent_logs;
create policy "allow all for anon" on public.agent_logs for all using (true) with check (true);

-- Skills
drop policy if exists "allow all for anon" on public.agent_skills;
drop policy if exists "allow all" on public.agent_skills;
create policy "allow all for anon" on public.agent_skills for all using (true) with check (true);

-- Reflections
drop policy if exists "allow all for anon" on public.agent_reflections;
drop policy if exists "allow all" on public.agent_reflections;
create policy "allow all for anon" on public.agent_reflections for all using (true) with check (true);

-- Re-disable RLS to ensure it stays disabled (policies above are for if you re-enable later)
alter table public.projects disable row level security;
alter table public.agent_memories disable row level security;
alter table public.decisions disable row level security;
alter table public.tasks disable row level security;
alter table public.beacon_leads disable row level security;
alter table public.school_profiles disable row level security;
alter table public.agent_logs disable row level security;
alter table public.agent_skills disable row level security;
alter table public.agent_reflections disable row level security;

select 'RLS fixed — all tables now allow anon/publishable key' as status;
