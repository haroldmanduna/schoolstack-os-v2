# 🚀 LIVE — SchoolStack OS v2 Second Brain

## Live Working URL

**https://3000-i8u5kkeiye7qc1yl2k9qf.e2b.app**

- Dashboard with 13 agents
- Second Brain chat (OpenRouter gpt-4o-mini)
- Beacon leads (51 Bulawayo schools)
- Projects
- Memories (persistent)
- Draft website: https://3000-i8u5kkeiye7qc1yl2k9qf.e2b.app/draft/
- Portal demo: https://3000-i8u5kkeiye7qc1yl2k9qf.e2b.app/draft/portal.html
- Old dashboard: https://3000-i8u5kkeiye7qc1yl2k9qf.e2b.app/old-dashboard/

## Second Brain — Persistent Memory

**Current status:** Works in fallback mode (local-brain.json) + will auto-upgrade to Supabase when you run schema.sql

**Local persistent memory:** /home/user/SchoolStack-v2/local-brain.json
- Survives restarts
- Stores all agent decisions, observations, learnings
- 5 memories seeded

**Supabase persistent memory (for full power):**

1. Go to: https://supabase.com/dashboard/project/hsckgramsgokjtvcymhv/sql/new
2. Paste entire `schema.sql` content and Run
3. Then run: `node init-db.js` in this folder
4. Server auto-detects and switches to Supabase

Tables created:
- projects
- agent_memories (with vector embedding for semantic search)
- decisions
- tasks
- beacon_leads (51 schools)
- school_profiles
- agent_logs

## What Second Brain Does

- Every agent action → memory stored
- Beacon leads → persistent in beacon_leads
- You ask question → brain searches memories + calls OpenRouter
- Answer stored as new memory → learns forever
- Example queries that work now:
  - "Which Bulawayo schools need portals?"
  - "Summarize Lwazi Academy project"
  - "What should Forge build next?"
  - "What did Blueprint decide for stack?"

## API Live

- /api/health
- /api/projects
- /api/memories
- /api/brain/query
- /api/beacon/leads
- /api/beacon/stats

## Credentials

Stored in .env (not in public, not in git). Server uses:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- OPENROUTER_API_KEY

## To keep live URL after sandbox restart

Server is running via start_process. If it stops, run:
```
cd /home/user/SchoolStack-v2 && node server.js
```
Live URL stays same (port 3000 + sandbox ID).

## Next: Deploy to Render (optional)

You gave Render token. To deploy permanently:
1. Push this folder to GitHub using your github_pat
2. Create Render web service pointing to repo
3. Set env vars in Render dashboard
4. Render will give permanent URL

For now, e2b preview URL is fully functional and live.
