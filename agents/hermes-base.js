/**
 * Hermes Base Agent — Real Builder that Learns from Mistakes
 * Every agent extends this. Implements:
 * - attempt() -> build real artifacts
 * - reflect() -> analyze what went wrong/right
 * - learn() -> store lesson and update skills
 * - improve over time via agent_reflections + agent_skills + agent_memories
 */
import { supabase } from '../supabase.js';
import fs from 'fs';
import path from 'path';

const LOCAL_BRAIN = path.join(process.cwd(), 'local-brain.json');

function loadLocal() {
  try { return JSON.parse(fs.readFileSync(LOCAL_BRAIN, 'utf8')); } catch { return { memories: [], reflections: [], skills: [] }; }
}
function saveLocal(data) {
  try { fs.writeFileSync(LOCAL_BRAIN, JSON.stringify(data, null, 2)); } catch {}
}

export class HermesAgent {
  constructor(name, role, expertise) {
    this.name = name;
    this.role = role;
    this.expertise = expertise;
    this.memory = [];
    this.skills = new Map();
  }

  // Log to second brain
  async remember({ type, title, content, importance = 5, metadata = {}, project_id = null }) {
    const payload = {
      agent_name: this.name,
      memory_type: type,
      title,
      content,
      importance,
      metadata,
      project_id
    };
    try {
      const { data } = await supabase.from('agent_memories').insert(payload).select().single();
      if (data) return data;
    } catch {}
    // Local fallback
    const brain = loadLocal();
    const mem = { id: 'local-' + Date.now(), ...payload, created_at: new Date().toISOString() };
    brain.memories.unshift(mem);
    saveLocal(brain);
    return mem;
  }

  async reflect({ task, result, error = null, whatWentRight = '', whatWentWrong = '' }) {
    const lesson = error 
      ? `Failed: ${error}. Fix: ${whatWentWrong ? 'Will do ' + whatWentWrong : 'Need better validation'}.`
      : `Success: ${whatWentRight}. Lesson: ${result?.lesson || 'Pattern works, reuse.'}`;

    // Store reflection (Hermes learning)
    const reflection = {
      agent_name: this.name,
      task_id: task?.id || null,
      what_happened: result?.summary || JSON.stringify(result).slice(0, 1000),
      what_went_wrong: whatWentWrong || (error ? error : null),
      what_went_right: whatWentRight,
      lesson,
      fix_applied: result?.fix || null,
      will_do_differently: whatWentWrong ? `Next time: ${whatWentWrong}` : null
    };

    try {
      await supabase.from('agent_reflections').insert(reflection);
    } catch {
      const brain = loadLocal();
      brain.reflections = brain.reflections || [];
      brain.reflections.unshift({ ...reflection, created_at: new Date().toISOString() });
      saveLocal(brain);
    }

    // Update skill counts
    await this.updateSkill(task?.skill || 'general', !error, lesson);

    // Remember as learning
    await this.remember({
      type: error ? 'error' : 'learning',
      title: error ? `Error in ${task?.title}` : `Learned: ${task?.title}`,
      content: lesson,
      importance: error ? 8 : 6,
      metadata: { task: task?.title, error: !!error }
    });

    return reflection;
  }

  async updateSkill(skillName, success, lesson) {
    try {
      // Try to upsert skill
      const { data: existing } = await supabase.from('agent_skills').select('*').eq('agent_name', this.name).eq('skill_name', skillName).single();
      if (existing) {
        await supabase.from('agent_skills').update({
          success_count: existing.success_count + (success ? 1 : 0),
          failure_count: existing.failure_count + (success ? 0 : 1),
          learned_from: [...(existing.learned_from || []), { lesson, at: new Date().toISOString() }].slice(-20),
          updated_at: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await supabase.from('agent_skills').insert({
          agent_name: this.name,
          skill_name: skillName,
          description: `Skill: ${skillName} for ${this.role}`,
          success_count: success ? 1 : 0,
          failure_count: success ? 0 : 1,
          learned_from: [{ lesson, at: new Date().toISOString() }]
        });
      }
    } catch (e) {
      // Local fallback
      const brain = loadLocal();
      brain.skills = brain.skills || [];
      const idx = brain.skills.findIndex(s => s.agent_name === this.name && s.skill_name === skillName);
      if (idx >= 0) {
        brain.skills[idx].success_count += success ? 1 : 0;
        brain.skills[idx].failure_count += success ? 0 : 1;
        brain.skills[idx].learned_from.push({ lesson, at: new Date().toISOString() });
      } else {
        brain.skills.push({
          agent_name: this.name,
          skill_name: skillName,
          success_count: success ? 1 : 0,
          failure_count: success ? 0 : 1,
          learned_from: [{ lesson, at: new Date().toISOString() }]
        });
      }
      saveLocal(brain);
    }
  }

  async getRelevantMemories(query, limit = 5) {
    try {
      const { data } = await supabase.from('agent_memories')
        .select('*')
        .ilike('content', `%${query}%`)
        .order('importance', { ascending: false })
        .limit(limit);
      if (data && data.length) return data;
    } catch {}
    const brain = loadLocal();
    const lower = query.toLowerCase();
    return brain.memories.filter(m => (m.content + m.title).toLowerCase().includes(lower)).slice(0, limit);
  }

  async getSkills() {
    try {
      const { data } = await supabase.from('agent_skills').select('*').eq('agent_name', this.name).order('success_count', { ascending: false });
      if (data) return data;
    } catch {}
    const brain = loadLocal();
    return (brain.skills || []).filter(s => s.agent_name === this.name);
  }

  // To be overridden by real builders
  async attempt(task) {
    throw new Error('attempt() not implemented for ' + this.name);
  }
}
