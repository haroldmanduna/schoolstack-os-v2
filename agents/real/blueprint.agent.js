import { HermesAgent } from '../hermes-base.js';

export class BlueprintAgent extends HermesAgent {
  constructor() {
    super('blueprint', 'Technical Architect', 'Recommends perfect stack per project, designs DB, prevents rework');
  }

  async attempt(task) {
    const { project_type, enrollment, budget } = task.input || {};
    const memories = await this.getRelevantMemories(project_type || 'website', 5);
    const skills = await this.getSkills();

    // Real decision logic — not generic
    let stack, reasoning, cost;

    if (project_type === 'website' || enrollment < 300) {
      stack = {
        frontend: 'Astro + Tailwind',
        hosting: 'Cloudflare Pages',
        cms: 'Markdown + Decap CMS',
        cost: '$0-10/mo'
      };
      reasoning = 'Simple informational site, <300 learners, need speed on 3G, low maintenance. Astro gives 95+ Lighthouse, zero JS overhead.';
    } else if (project_type === 'website+portal' && enrollment < 1000) {
      stack = {
        frontend: 'Next.js 14 App Router + Tailwind + shadcn/ui',
        backend: 'Supabase (Postgres, Auth, Storage, RLS)',
        hosting: 'Vercel + Supabase',
        cost: '$0-30/mo'
      };
      reasoning = 'Full portal needs auth, fees RTGS/USD, results, attendance. Supabase RLS ensures parent isolation. Next.js PWA-ready for offline. Scales to 5k students. ZW dev can maintain.';
    } else {
      stack = {
        frontend: 'Next.js + Tailwind',
        backend: 'PostgreSQL + Prisma + NextAuth',
        hosting: 'VPS / Render',
        cost: '$20-50/mo'
      };
      reasoning = 'Large school >1000 learners, needs custom scaling, advanced reporting.';
    }

    // Learn from past mistakes — if previous project had rework, avoid
    const pastFailures = memories.filter(m => m.memory_type === 'error');
    if (pastFailures.length > 0) {
      reasoning += ` Learned from ${pastFailures.length} past failures: avoid ${pastFailures[0].title}.`;
    }

    const result = {
      summary: `Recommended ${stack.frontend} + ${stack.backend || stack.cms} for ${project_type}`,
      stack,
      reasoning,
      cost,
      used_memories: memories.length,
      used_skills: skills.length
    };

    await this.remember({
      type: 'decision',
      title: `Stack for ${project_type}: ${stack.frontend}`,
      content: `${reasoning} Cost: ${cost}. Used ${memories.length} memories.`,
      importance: 8,
      metadata: { project_type, stack }
    });

    return { success: true, result };
  }
}
