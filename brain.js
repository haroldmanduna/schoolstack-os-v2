import dotenv from 'dotenv';
dotenv.config();
import { supabase } from './supabase.js';
import fs from 'fs';
import path from 'path';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LOCAL_BRAIN_PATH = path.join(process.cwd(), 'local-brain.json');

function loadLocalBrain() {
  try {
    const raw = fs.readFileSync(LOCAL_BRAIN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { memories: [], projects: [], decisions: [] };
  }
}

function saveLocalBrain(data) {
  try {
    fs.writeFileSync(LOCAL_BRAIN_PATH, JSON.stringify(data, null, 2));
  } catch {}
}

// Second Brain: persistent memory + reasoning

export async function addMemory({ project_id = null, agent_name, memory_type, title, content, metadata = {} }) {
  let embedding = null;
  const payload = {
    project_id,
    agent_name,
    memory_type,
    title,
    content,
    metadata,
    embedding
  };
  if (!project_id) delete payload.project_id;

  try {
    const { data, error } = await supabase.from('agent_memories').insert(payload).select().single();
    if (!error && data) return data;
    console.log('Supabase insert failed, using local fallback:', error?.message);
  } catch (e) {
    console.log('Supabase unavailable, local fallback:', e.message);
  }

  // Local fallback - persistent
  const brain = loadLocalBrain();
  const mem = { id: 'local-' + Date.now(), ...payload, created_at: new Date().toISOString() };
  brain.memories.unshift(mem);
  saveLocalBrain(brain);
  return { ...mem, fallback: true, persistent: true };
}

export async function searchMemories({ query, agent_name = null, project_id = null, limit = 10 }) {
  try {
    let q = supabase.from('agent_memories').select('*').order('created_at', { ascending: false }).limit(limit);
    if (agent_name) q = q.eq('agent_name', agent_name);
    if (project_id) q = q.eq('project_id', project_id);
    if (query) q = q.ilike('content', `%${query}%`);
    const { data, error } = await q;
    if (!error && data && data.length > 0) return data;
  } catch {}
  // Local fallback
  const brain = loadLocalBrain();
  let mems = brain.memories;
  if (agent_name) mems = mems.filter(m => m.agent_name === agent_name);
  if (query) {
    const lower = query.toLowerCase();
    mems = mems.filter(m => (m.content + m.title).toLowerCase().includes(lower));
  }
  return mems.slice(0, limit);
}

export async function getProjectMemories(slug) {
  try {
    const { data: proj } = await supabase.from('projects').select('id').eq('slug', slug).single();
    if (proj) {
      const { data } = await supabase.from('agent_memories').select('*').eq('project_id', proj.id).order('created_at', { ascending: false }).limit(50);
      if (data && data.length) return data;
    }
  } catch {}
  const brain = loadLocalBrain();
  return brain.memories.filter(m => !m.project_id || m.metadata?.project_slug === slug).slice(0, 50);
}

export async function queryBrain({ question, context = '', project_slug = null }) {
  if (!OPENROUTER_KEY) {
    return { answer: 'Second brain online but OpenRouter key missing. Using local memory only.', source: 'fallback' };
  }

  // Gather relevant memories for context
  let memories = [];
  if (project_slug) {
    memories = await getProjectMemories(project_slug);
  } else {
    memories = await searchMemories({ query: question, limit: 5 });
  }

  const memoryContext = memories.map(m => `[${m.agent_name}:${m.memory_type}] ${m.title}: ${m.content}`).join('\n').slice(0, 4000);

  const systemPrompt = `You are SchoolStack Second Brain — persistent memory for 13 specialist agents building school websites/portals in Bulawayo.
You have access to:
- Project memories
- Beacon leads (Bulawayo schools)
- Decision logs
- Agent expertise

Be concise, actionable, and precise. No hallucinations — cite memory if used.

Context memories:
${memoryContext}

Additional context: ${context}
`;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://schoolstack.bulawayo',
        'X-Title': 'SchoolStack Second Brain'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        max_tokens: 800
      })
    });

    const json = await res.json();
    if (json.error) {
      console.error('OpenRouter error:', json.error);
      return { answer: `Brain error: ${json.error.message}. Memories found: ${memories.length}`, memories };
    }
    const answer = json.choices?.[0]?.message?.content || 'No answer';
    // Store this Q&A as memory
    await addMemory({
      agent_name: 'nexus',
      memory_type: 'learning',
      title: `Q: ${question.slice(0, 80)}`,
      content: `Q: ${question}\nA: ${answer}`,
      metadata: { project_slug }
    });

    return { answer, memories, source: 'openrouter' };
  } catch (e) {
    console.error('Brain query failed:', e.message);
    return { answer: `Brain offline: ${e.message}. Found ${memories.length} memories locally.`, memories, source: 'fallback' };
  }
}

export async function logAgentAction({ project_id, agent_name, action, input, output, duration_ms }) {
  try {
    const { data, error } = await supabase.from('agent_logs').insert({
      project_id,
      agent_name,
      action,
      input: typeof input === 'string' ? input.slice(0, 5000) : JSON.stringify(input).slice(0, 5000),
      output: typeof output === 'string' ? output.slice(0, 5000) : JSON.stringify(output).slice(0, 5000),
      duration_ms
    }).select().single();
    if (!error) return data;
  } catch {}
  return { fallback: true };
}
