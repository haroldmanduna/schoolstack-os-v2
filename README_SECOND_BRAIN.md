# SchoolStack v2 — Second Brain Setup

## Live URL will be after server start

### Step 1: Run schema.sql in Supabase (1 min)

1. Go to: https://supabase.com/dashboard/project/hsckgramsgokjtvcymhv/sql
2. Copy entire `schema.sql` file content
3. Paste and Run

This creates:
- projects
- agent_memories (with vector)
- decisions
- tasks
- beacon_leads
- school_profiles
- agent_logs

### Step 2: Seed

After schema run:
```
node init-db.js
```

This will seed 51 Bulawayo leads + initial memories.

### Even without schema, server works in fallback mode (local JSON + file leads)

### Architecture

- **Supabase**: persistent memory DB
- **OpenRouter**: second brain reasoning (gpt-4o-mini)
- **Express**: API + static hosting
- **Memory types**: decision, task, observation, learning, lead
- **Beacon**: leads stored in beacon_leads table, searchable

### API

- GET /api/health
- GET /api/projects
- POST /api/projects
- GET /api/memories?q=&agent=
- POST /api/memories
- POST /api/brain/query {question, project_slug}
- GET /api/beacon/leads?classification=
- GET /api/beacon/stats

### Security

.env is gitignored. Keys are not committed.
