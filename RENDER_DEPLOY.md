# Render Deploy — Permanent Live URL

## Created Service

- **Name:** schoolstack-os-v2
- **ID:** srv-daonpu80cd8s73egpftg
- **Dashboard:** https://dashboard.render.com/web/srv-daonpu80cd8s73egpftg
- **Permanent URL:** https://schoolstack-os-v2.onrender.com (will be live after code push)
- **Repo:** https://github.com/haroldmanduna/acadex
- **Root Dir:** schoolstack-os-v2
- **Branch:** main
- **Build:** npm install
- **Start:** npm start
- **Region:** frankfurt
- **Plan:** free

Env vars already set in Render:
- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY
- OPENROUTER_API_KEY
- PORT=10000

## Why not live yet?

Your GitHub PAT `github_pat_11CCM2N2Y0...` is **read-only** for Contents:
- API returns `Resource not accessible` for file creation
- Git push returns 403 Permission denied
- Token has `push: true` in API but fine-grained PAT Contents permission is Read-only, not Read and Write

## Fix (30 seconds)

### Option 1: Update existing fine-grained PAT
1. Go to https://github.com/settings/personal-access-tokens
2. Find token with ID containing `11CCM2N2Y0...` (or create new)
3. Edit -> Repository access -> All repositories OR add `acadex` + new repo `schoolstack-os-v2`
4. Permissions -> Contents -> **Read and Write** (currently Read-only)
5. Save

### Option 2: Create classic PAT (easier)
1. https://github.com/settings/tokens/new
2. Note: schoolstack-deploy
3. Expiration: 90 days
4. Scopes: repo (all)
5. Generate and copy token
6. Replace in deploy script

### Option 3: Manual upload (no token needed)
1. Go to https://github.com/haroldmanduna/acadex
2. Add file -> Upload files
3. Drag entire `schoolstack-os-v2` folder from `/home/user/SchoolStack-v2/` (excluding .env, node_modules, local-brain.json)
4. Commit to main
5. Render auto-deploys in 2-3 mins -> https://schoolstack-os-v2.onrender.com will be live

## After code push, Render will:

- Clone acadex repo
- cd schoolstack-os-v2
- npm install (express, supabase, openai, cors, dotenv, ws)
- npm start (server.js on 0.0.0.0:$PORT)
- Live at https://schoolstack-os-v2.onrender.com

## Current working live URL (e2b preview, no GitHub needed)

**https://3000-i8u5kkeiye7qc1yl2k9qf.e2b.app**

This is fully functional now with second brain, Beacon, real builders.

## Deploy script (once token has write)

```bash
cd /tmp/acadex_test
git remote set-url origin https://haroldmanduna:NEW_TOKEN@github.com/haroldmanduna/acadex.git
git push origin main
# Render auto-deploys
```

Or create new repo:

```bash
# Create repo schoolstack-os-v2 via GitHub web UI (empty)
# Then:
cd /home/user/SchoolStack-v2
git init
git remote add origin https://haroldmanduna:NEW_TOKEN@github.com/haroldmanduna/schoolstack-os-v2.git
git add . --ignore-errors
git commit -m "feat: real builders"
git push -u origin main
# Then update Render service repo to https://github.com/haroldmanduna/schoolstack-os-v2 via dashboard or API
```
