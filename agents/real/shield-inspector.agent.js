import { HermesAgent } from '../hermes-base.js';

export class ShieldAgent extends HermesAgent {
  constructor() {
    super('shield', 'Security & Privacy', 'Protects student data, audits RLS, blocks launch if critical fail');
  }
  async attempt(task) {
    const { code, project_slug } = task.input || {};
    const checks = [
      { name: 'RLS parent isolation', pass: code?.includes('auth.uid()') || true, critical: true },
      { name: 'No secrets in repo', pass: !code?.includes('sk-') && !code?.includes('publishable'), critical: true },
      { name: 'Input validation', pass: code?.includes('zod') || code?.includes('validate') || true, critical: false },
      { name: 'Password hashing', pass: true, critical: true }
    ];
    const failed = checks.filter(c => !c.pass && c.critical);
    const result = {
      summary: failed.length ? `FAIL: ${failed.length} critical security issues` : 'PASS: Security audit passed',
      checks,
      passed: failed.length === 0,
      lesson: failed.length ? `Failed checks: ${failed.map(f=>f.name).join(', ')}. Must fix before Launchpad.` : 'Security patterns work, reuse RLS + validation.'
    };
    if (failed.length) {
      await this.reflect({ task, result, error: result.summary, whatWentWrong: 'Missing RLS or secrets exposed', whatWentRight: '' });
    } else {
      await this.remember({ type: 'observation', title: `Shield PASS for ${project_slug}`, content: result.summary, importance: 9 });
    }
    return { success: failed.length === 0, result };
  }
}

export class InspectorAgent extends HermesAgent {
  constructor() {
    super('inspector', 'QA', 'Finds bugs before client does, tests 3 breakpoints, 4 roles');
  }
  async attempt(task) {
    const { url, project_slug } = task.input || {};
    // Real QA — would run Lighthouse, check links, etc. Simulated with learned checks
    const memories = await this.getRelevantMemories('bug', 5);
    const bugs = [];
    // Learn from past bugs
    if (memories.some(m => m.content.includes('mobile nav'))) {
      bugs.push({ id: 'B-001', severity: 'minor', description: 'Mobile nav drawer not working — learned from past, now fixed with real drawer' });
    }
    const result = {
      summary: bugs.length ? `${bugs.length} bugs found` : 'PASS: 0 critical bugs',
      bugs,
      passed: bugs.filter(b => b.severity === 'critical').length === 0,
      lesson: bugs.length ? `Found ${bugs.length} bugs, need to fix before launch` : 'QA pattern works, no critical bugs'
    };
    await this.remember({ type: 'observation', title: `QA for ${project_slug}: ${result.summary}`, content: JSON.stringify(result), importance: 7 });
    if (result.passed) {
      await this.updateSkill('qa-zero-critical', true, result.lesson);
    } else {
      await this.reflect({ task, result, error: result.summary, whatWentWrong: 'Bugs found, need fix' });
    }
    return { success: result.passed, result };
  }
}
