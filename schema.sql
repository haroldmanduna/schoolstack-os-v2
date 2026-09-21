-- SchoolStack Second Brain — Persistent Memory Schema
-- Run this in Supabase SQL Editor

-- Enable pgvector for semantic memory (second brain)
create extension if not exists vector;

-- Projects (persistent)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type text not null,
  status text default 'draft',
  brief text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Agent memories (second brain)
create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  agent_name text not null, -- nexus, beacon, scout, etc.
  memory_type text not null, -- decision, task, observation, learning, lead
  title text not null,
  content text not null,
  embedding vector(1536), -- for semantic search
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Decision log (persistent)
create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  agent_name text not null,
  decision text not null,
  reasoning text,
  created_at timestamptz default now()
);

-- Tasks
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  title text not null,
  assigned_to text not null,
  status text default 'pending', -- pending, in_progress, done, blocked
  priority text default 'medium',
  output_file text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Beacon leads (persistent memory of Bulawayo schools)
create table if not exists beacon_leads (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  slug text unique not null,
  type text,
  category text,
  location text,
  website_url text,
  website_status text,
  portal_url text,
  portal_status text,
  classification text,
  confidence text,
  opportunity_score int,
  evidence jsonb,
  contact jsonb,
  notes text,
  last_checked timestamptz default now(),
  created_at timestamptz default now()
);

-- School profiles (enriched)
create table if not exists school_profiles (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references beacon_leads(id),
  name text not null,
  motto text,
  history text,
  enrollment int,
  fees_range text,
  branding jsonb,
  content jsonb,
  created_at timestamptz default now()
);

-- Agent conversations / logs
create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  agent_name text not null,
  action text not null,
  input text,
  output text,
  duration_ms int,
  created_at timestamptz default now()
);

-- Second brain semantic index
create index if not exists idx_memories_embedding on agent_memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_memories_project on agent_memories(project_id);
create index if not exists idx_memories_agent on agent_memories(agent_name);
create index if not exists idx_leads_classification on beacon_leads(classification);
create index if not exists idx_leads_opportunity on beacon_leads(opportunity_score desc);

-- RLS (disable for now for agency OS — enable later with auth)
alter table projects disable row level security;
alter table agent_memories disable row level security;
alter table decisions disable row level security;
alter table tasks disable row level security;
alter table beacon_leads disable row level security;
alter table school_profiles disable row level security;
alter table agent_logs disable row level security;

-- Seed project
insert into projects (slug, name, type, status, brief) values 
('lwazi-academy', 'Lwazi Academy', 'website+portal', 'draft', 'Fictional demo school in Matsheumhlope, Bulawayo — reusable template')
on conflict (slug) do nothing;
