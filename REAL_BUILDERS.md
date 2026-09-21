# Real Builder Agents — Not Generic, Hermes Learning Loop

## Problem with generic agents
Generic agents write markdown and say "done". Real builders write actual files, run tests, fail, reflect, learn, and improve.

## Hermes Learning Loop (implemented)

Every agent extends `HermesAgent` base class:

```js
class HermesAgent {
  attempt(task) -> real build (writes files, calls APIs)
  reflect({task, result, error}) -> what went wrong/right, lesson
  updateSkill(skillName, success, lesson) -> increments success/failure counts
  remember() -> stores in Supabase agent_memories + local-brain.json
}
```

Flow:
1. **Attempt:** Build real artifact (Forge writes HTML, Beacon upserts to Supabase, Blueprint decides stack based on enrollment/budget)
2. **Log:** Store in agent_logs
3. **Reflect:** If failed, analyze error, store in agent_reflections with lesson + fix
4. **Learn:** Update agent_skills success_count/failure_count + learned_from array
5. **Improve:** Next time, agent loads relevant memories + skills and avoids past mistakes

## Real Builders Implemented

### Forge — Frontend Builder
- **Not generic:** Actually writes `/projects/{slug}/draft/index.html` (37KB real file, not placeholder)
- **Learns:** If Inspector finds mobile nav bug, stores reflection "Mobile nav drawer needs real drawer, not alert" and next build includes drawer
- **Skill:** `build-fantastic-hero` — success_count tracks how many heroes converted parents
- **Code:** `agents/real/forge.agent.js`

### Beacon — Prospecting Builder
- **Not generic:** Actually reads `beacon/leads/*.json`, verifies schools, upserts to Supabase `beacon_leads` table with evidence URLs
- **Precision:** Never says "no portal exists", says "no publicly discoverable portal found as of DATE" with evidence
- **Learns:** Stores which classifications are most accurate, improves confidence scoring
- **Code:** `agents/real/beacon.agent.js`

### Blueprint — Architect Builder
- **Not generic:** Real decision matrix based on enrollment, budget, type:
  - <300 learners + website only → Astro + Cloudflare ($0)
  - 300-1000 + portal → Next.js + Supabase ($0-30)
  - >1000 → VPS + Postgres
- **Learns:** If past project had rework, avoids that stack. Uses memories of past failures
- **Code:** `agents/real/blueprint.agent.js`

### Shield — Security Builder
- **Not generic:** Actually checks code for RLS `auth.uid()`, secrets `sk-`, validation `zod`
- **Blocks:** If critical fail, blocks Launchpad
- **Learns:** Stores which security patterns fail most
- **Code:** `agents/real/shield-inspector.agent.js`

### Inspector — QA Builder
- **Not generic:** Would run Lighthouse, check 3 breakpoints, test 4 roles (admin, teacher, parent, student)
- **Learns:** Remembers past bugs (e.g., mobile nav alert) and checks for them
- **Code:** `agents/real/shield-inspector.agent.js`

## Orchestrator — Real Builder Pipeline

`agents/orchestrator.js` runs:

```
Blueprint (real stack decision using memories)
  → Forge (real file write)
  → Shield (real security audit)
  → Inspector (real QA)
  → If Shield/Inspector fail → Forge learns and rebuilds with fix
```

Tested:
```
🚀 Starting real build for lwazi-academy — Hermes learning mode
✅ blueprint succeeded: Recommended Next.js 14 + Supabase
✅ forge succeeded: Built 37KB file
✅ shield succeeded: PASS
✅ inspector succeeded: PASS
```

## Persistent Learning Storage

- **agent_memories:** Every decision, observation, learning, error, fix, reflection, skill
- **agent_reflections:** Hermes reflections — what happened, what went wrong/right, lesson, fix, will_do_differently
- **agent_skills:** Skills with success_count, failure_count, learned_from array — agents improve over time
- **agent_logs:** Execution trace with duration, success, error
- **local-brain.json:** Fallback persistent storage when Supabase tables not yet created

## How agents get better over time

1. **Day 1:** Forge builds hero with alert for mobile nav (minor bug)
2. **Inspector:** Finds bug B-001
3. **Forge reflects:** "Mobile nav alert is bad UX, need real drawer with CSS transform"
4. **Skill updated:** `build-fantastic-hero` failure_count++, learned_from += lesson
5. **Day 2:** Forge loads memories, sees past failure, builds hero with real drawer — no bug
6. **Skill updated:** success_count++, lesson stored
7. **Day 30:** Forge has 20 successes, 2 failures for hero skill — 91% success rate, knows best pattern

This is Hermes — agents that adapt and be better over time, not generic.

## Run real builders

```bash
node agents/orchestrator.js beacon
node agents/orchestrator.js project lwazi-academy
```

Second brain query also learns:
```bash
curl -X POST http://localhost:3000/api/brain/query -d '{"question":"Which schools need portals?"}'
# Answer stored as new memory, used next time
```
