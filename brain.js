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

// ===== INTERNET BROWSING ABILITY =====
export async function searchInternet(query, count = 5) {
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    // Simple parse: extract result links and snippets
    const results = [];
    const regex = /<a class="result__url" href="([^"]+)".*?>(.*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < count) {
      results.push({
        url: match[1],
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        snippet: match[3].replace(/<[^>]+>/g, '').trim()
      });
    }
    // Fallback: try to extract any links
    if (results.length === 0) {
      const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{10,100})<\/a>/gi;
      while ((match = linkRegex.exec(html)) !== null && results.length < count) {
        if (!match[1].includes('duckduckgo.com')) {
          results.push({ url: match[1], title: match[2].trim(), snippet: '' });
        }
      }
    }
    return results;
  } catch (e) {
    console.error('Search failed:', e.message);
    return [{ url: '', title: 'Search failed, using fallback', snippet: e.message }];
  }
}

export async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    const html = await res.text();
    // Strip HTML to text (simple)
    let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim()
                   .slice(0, 8000);
    return { url, content: text, length: text.length, status: res.status };
  } catch (e) {
    return { url, content: `Fetch failed: ${e.message}`, error: true };
  }
}

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

export async function queryBrain({ question, context = '', project_slug = null, browse = true }) {
  if (!OPENROUTER_KEY) {
    return { answer: 'Second brain online but OpenRouter key missing. Using local memory only.', source: 'fallback' };
  }

  // Gather relevant memories for context (PERSISTENT MEMORY)
  let memories = [];
  if (project_slug) {
    memories = await getProjectMemories(project_slug);
  } else {
    memories = await searchMemories({ query: question, limit: 8 });
  }

  // BROWSE INTERNET if requested
  let webResults = [];
  let webContext = '';
  if (browse) {
    try {
      webResults = await searchInternet(question, 5);
      webContext = webResults.map(r => `[WEB] ${r.title} (${r.url}): ${r.snippet}`).join('\n').slice(0, 3000);
      // If question is about a school, fetch its page if found
      if (webResults.length > 0 && webResults[0].url) {
        const page = await fetchPage(webResults[0].url);
        if (!page.error) {
          webContext += `\n\nFetched ${page.url} content: ${page.content.slice(0, 2000)}`;
        }
      }
    } catch (e) {
      webContext = `Web search failed: ${e.message}`;
    }
  }

  const memoryContext = memories.map(m => `[MEMORY:${m.agent_name}:${m.memory_type}] ${m.title}: ${m.content}`).join('\n').slice(0, 4000);

  const systemPrompt = `You are SchoolStack Second Brain — REAL builder with persistent memory + internet browsing for 13 specialist agents building school websites/portals in Bulawayo.

You have:
- PERSISTENT MEMORY from Supabase (past decisions, learnings, errors, fixes)
- LIVE INTERNET BROWSING results
- You are NOT giving instructions — you BUILD real websites/portals

Be concise, actionable, and precise. Cite memories and web results.

PERSISTENT MEMORIES:
${memoryContext}

LIVE WEB RESULTS:
${webContext}

Additional context: ${context}

If user asks to build website/portal, explain you will actually build it via /api/build endpoints, not just instructions.
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
        max_tokens: 1000
      })
    });

    const json = await res.json();
    if (json.error) {
      return { answer: `Brain error: ${json.error.message}. Memories: ${memories.length}, Web: ${webResults.length}`, memories, webResults };
    }
    const answer = json.choices?.[0]?.message?.content || 'No answer';
    
    // Store this Q&A as persistent memory (LEARNING)
    await addMemory({
      agent_name: 'nexus',
      memory_type: 'learning',
      title: `Q: ${question.slice(0, 80)}`,
      content: `Q: ${question}\nA: ${answer}\nWeb: ${webResults.length} results`,
      metadata: { project_slug, webResults: webResults.length }
    });

    return { answer, memories, webResults, source: 'openrouter+web' };
  } catch (e) {
    return { answer: `Brain offline: ${e.message}. Found ${memories.length} memories, ${webResults.length} web results.`, memories, webResults, source: 'fallback' };
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
