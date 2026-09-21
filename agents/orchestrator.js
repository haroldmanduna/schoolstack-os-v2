/**
 * Real Builder Orchestrator — Hermes Learning Loop
 * Runs agents as real builders, not generic
 * Each task: attempt -> inspect -> reflect -> learn -> improve
 */
import { ForgeAgent } from './real/forge.agent.js';
import { BeaconAgent } from './real/beacon.agent.js';
import { BlueprintAgent } from './real/blueprint.agent.js';
import { ShieldAgent, InspectorAgent } from './real/shield-inspector.agent.js';
import { supabase } from '../supabase.js';

export class Orchestrator {
  constructor() {
    this.agents = {
      forge: new ForgeAgent(),
      beacon: new BeaconAgent(),
      blueprint: new BlueprintAgent(),
      shield: new ShieldAgent(),
      inspector: new InspectorAgent()
    };
    this.taskQueue = [];
  }

  async runTask(agentName, task) {
    const agent = this.agents[agentName];
    if (!agent) throw new Error(`Agent ${agentName} not found`);
    
    console.log(`\n🤖 ${agentName} attempting: ${task.title}`);
    const start = Date.now();
    
    // Attempt
    const attemptResult = await agent.attempt(task);
    
    // Log
    try {
      await supabase.from('agent_logs').insert({
        agent_name: agentName,
        action: task.title,
        input: JSON.stringify(task.input).slice(0, 2000),
        output: JSON.stringify(attemptResult.result || attemptResult.error).slice(0, 2000),
        duration_ms: Date.now() - start,
        success: attemptResult.success,
        error: attemptResult.error || null
      });
    } catch {}

    // If failed, reflect and try to improve
    if (!attemptResult.success) {
      console.log(`❌ ${agentName} failed: ${attemptResult.error}`);
      const reflection = await agent.reflect({
        task,
        result: attemptResult.result,
        error: attemptResult.error,
        whatWentWrong: task.fixHint || 'Need better input validation and file checks',
        whatWentRight: ''
      });
      console.log(`🧠 Reflection stored: ${reflection.lesson}`);
      
      // Try one more time with lesson
      if (task.retries < 1) {
        task.retries = (task.retries || 0) + 1;
        task.input = { ...task.input, learned_from_error: reflection.lesson };
        return this.runTask(agentName, task);
      }
    } else {
      console.log(`✅ ${agentName} succeeded: ${attemptResult.result.summary}`);
    }

    return attemptResult;
  }

  async runProject(projectSlug, type = 'website+portal') {
    console.log(`\n🚀 Starting real build for ${projectSlug} (${type}) — Hermes learning mode`);
    
    // 1. Blueprint recommends stack (real decision, uses memories)
    const blueprintTask = {
      title: `Recommend stack for ${projectSlug}`,
      input: { project_type: type, enrollment: 650, budget: 'low' },
      skill: 'recommend-stack-per-project',
      retries: 0
    };
    const blueprintResult = await this.runTask('blueprint', blueprintTask);

    // 2. Forge builds real website (real file write)
    const forgeTask = {
      title: `Build fantastic website for ${projectSlug}`,
      input: { project_slug: projectSlug, page: 'website', requirements: { tagline: 'Where heritage meets innovation' } },
      skill: 'build-fantastic-hero',
      retries: 0
    };
    const forgeResult = await this.runTask('forge', forgeTask);

    // 3. Shield audits (real security check)
    const shieldTask = {
      title: `Security audit for ${projectSlug}`,
      input: { project_slug: projectSlug, code: forgeResult.result?.code || '' },
      skill: 'rls-parent-isolation',
      retries: 0
    };
    const shieldResult = await this.runTask('shield', shieldTask);

    // 4. Inspector QA (real QA)
    const inspectorTask = {
      title: `QA for ${projectSlug}`,
      input: { project_slug: projectSlug, url: `/draft/` },
      skill: 'qa-zero-critical',
      retries: 0
    };
    const inspectorResult = await this.runTask('inspector', inspectorTask);

    // 5. If Shield or Inspector failed, Forge learns and rebuilds
    if (!shieldResult.success || !inspectorResult.success) {
      console.log(`\n🔄 Shield/Inspector failed — Forge learning and rebuilding...`);
      const fixTask = {
        title: `Fix issues for ${projectSlug}`,
        input: { 
          project_slug: projectSlug, 
          page: 'website',
          requirements: { 
            fix: `${shieldResult.result?.summary} + ${inspectorResult.result?.summary}`,
            learned: 'Must include RLS and mobile drawer'
          }
        },
        skill: 'build-fantastic-hero',
        retries: 0,
        fixHint: 'Add RLS policies and mobile nav drawer'
      };
      await this.runTask('forge', fixTask);
    }

    console.log(`\n✅ Project ${projectSlug} build complete — agents learned from this run`);
    return { blueprintResult, forgeResult, shieldResult, inspectorResult };
  }

  async runBeaconScan() {
    console.log('\n🔍 Beacon real scan — evidence-based');
    const task = {
      title: 'Scan Bulawayo schools',
      input: { action: 'scan' },
      skill: 'classify-school-precisely',
      retries: 0
    };
    return this.runTask('beacon', task);
  }
}

// CLI
if (process.argv[1].includes('orchestrator.js')) {
  const orch = new Orchestrator();
  const cmd = process.argv[2] || 'project';
  if (cmd === 'beacon') {
    orch.runBeaconScan().then(r => console.log(JSON.stringify(r, null, 2)));
  } else {
    const slug = process.argv[3] || 'lwazi-academy';
    orch.runProject(slug).then(r => console.log('Done'));
  }
}
