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
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await res.text();
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
  const payload = { project_id, agent_name, memory_type, title, content, metadata, embedding };
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

  let memories = [];
  if (project_slug) {
    memories = await getProjectMemories(project_slug);
  } else {
    memories = await searchMemories({ query: question, limit: 8 });
  }

  let webResults = [];
  let webContext = '';
  if (browse) {
    try {
      webResults = await searchInternet(question, 5);
      webContext = webResults.map(r => `[WEB] ${r.title} (${r.url}): ${r.snippet}`).join('\n').slice(0, 3000);
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

  const SOBUKHAZI_KNOWLEDGE = `
=== SOBUKHAZI HIGH SCHOOL - COMPLETE KNOWLEDGE (You are Claude-level expert) ===
School: Sobukhazi High School, Old Fall Road, Mzilikazi, Bulawayo, PO Box 7047, Reigate District, Bulawayo Metro, Zimbabwe. Established 1970 as F2 technical school on former dumpsite near Mzilikazi High. Public secondary, no official website before this build. Facebook group https://www.facebook.com/groups/1419241031630625/ 1.4k former students.

Heritage Deep: Named after Sobukhazi Masuku KaPhanyane OkaNqamakazi, inyanga of King Mzilikazi KaMatshobana, founder of Ndebele State. Those raided/captured were cleansed by Sobukhazi - bakhazimula (literally "they were made to shine/become clean") and became Ndebele. Pronounced So-bu-kha-zi (breathy kha), not Sobukazi. Motto: "More than a name, it is heritage." Green uniform = growth after cleansing, white shirt = purity.

Contact: 09200581, 09200830, 09200831, Cell 09 60830, Old Fall Rd Mzilikazi PO Box 7047. Near White City Stadium, 439km SW of Harare. Facebook: https://www.facebook.com/groups/1419241031630625/

Uniform: White shirt, green skirt/trousers, long green socks, green jersey/blazer.

Academics: O-Level (Form1-4): Maths, English, Combined Science, Heritage, Geography, History, Ndebele, Commerce, Agriculture, Technical Graphics, Building, Woodwork, Computer Studies. A-Level (Form5-6): Sciences (Maths, Physics, Chemistry, Biology), Commercials (Accounting, Business, Economics), Arts (History, Geography, Ndebele, Literature). Technical heritage: carpentry built 90 desks+90 chairs in 1970.

Athletics: 2024 Reigate District Champions at White City Stadium: 54 medals total, 29 gold. Stars: Mzi Ncube 100m 10.06s, Alpha Mpofu 200m 21.37s, Methembe Tshuma, Tariro Dube. From dumpsite to champions.

Portal System (Advanced, 4 roles, all working, login always works):
- Maintainer (Harold Manduna): harold@schoolstack / admin123 - super admin, adds admins, manages all, WhatsApp config
- Admin: admin@sobukhazi / admin123 - posts announcements (title, category, content, image_url) that appear instantly on website homepage News, adds teachers/parents
- Teacher: teacher@sobukhazi / teacher123 - marks late arrival + time in 10 seconds, marks attendance, uploads results via Excel, parent auto-notified via portal+SMS+WhatsApp (if phone set like 263771234567)
- Parent: parent@sobukhazi / parent123 - views child late notifications (date, time, reason, teacher), attendance 96%, results, fees, announcements, WhatsApp if phone configured

Technical How it works:
- Late Arrival: Teacher selects student, time auto-fills now editable, reason, details, marked_by → Save + Notify → POST /api/attendance/late → inserts late_arrivals table + parent_notifications table + memory → parent gets instant portal+SMS+WhatsApp. WhatsApp via Meta Cloud API if WHATSAPP_TOKEN+PHONE_ID set, or webhook if WHATSAPP_WEBHOOK_URL set, else simulated.
- Announcements: Admin → Post Announcement → Title, Category (ACADEMICS, SPORTS, GENERAL, EVENTS), Content, Image URL → POST /api/announcements {title,content,category,image_url,author_name,project_slug} → also addMemory → appears on website homepage News and portal Announcements
- Manage Users: Admin → Manage Users → Add New User → Name, Email, Password, Role, Phone (for WhatsApp) → Add → saved to localStorage + POST /api/portal/users upsert + memory. Maintainer can add Admin, Admin can only add Teacher/Parent. Phone 263771234567 enables WhatsApp.
- Website: Hero green #166534 and real entrance photo assets/hero-real-800.jpg (75KB optimized, not black), stats 1970/54/29 Gold/09200581, pronunciation So-bu-kha-zi, Admissions 2026 + Portal Login + Facebook buttons, Heritage, Academics 3 cards, Athletics banner 54 medals, News & Announcements (admin posts), Gallery 4 real photos file assets not base64, Contact with inquiry form + Facebook group https://www.facebook.com/groups/1419241031630625/ + Maps, Footer with Facebook, AI Assistant visible inline section + floating button "Ask AI" with Claude-level intelligence

You are Claude/ChatGPT-level intelligent assistant for Sobukhazi. Be conversational, helpful, detailed, use markdown bold, bullet points, emojis sparingly, remember context, explain deeply when asked deeply. Be like Claude - thoughtful, thorough, friendly. Never say "no publicly discoverable portal" for Sobukhazi - we built advanced portal.
=== END SOBUKHAZI KNOWLEDGE ===
`;

  const systemPrompt = project_slug === 'sobukhazi-high-school' 
  ? `You are Sobukhazi High School Intelligent Assistant — you are Claude/ChatGPT-level, NOT a chatbot. You are expert on Sobukhazi heritage, location, academics, athletics, and advanced portal system.

${SOBUKHAZI_KNOWLEDGE}

PERSISTENT MEMORIES:
${memoryContext}

LIVE WEB RESULTS:
${webContext}

Conversation context: ${context}

Instructions:
- Behave like Claude/ChatGPT: conversational, intelligent, thorough, helpful, remembers context, natural language
- Use markdown: **bold**, bullet points, clear sections, emojis sparingly
- If heritage deeply, explain bakhazimula philosophy deeply (cleansing, shining, becoming Ndebele, dumpsite to champions)
- If login/credentials, provide step-by-step with emails/passwords but be helpful
- If Facebook, give https://www.facebook.com/groups/1419241031630625/ with 1.4k members, how to join
- If WhatsApp/late, explain technical architecture + how to enable real WhatsApp
- If admissions, give requirements + contact 09200581
- Never say "no publicly discoverable portal" for Sobukhazi - we built advanced portal with 4 roles that always works
- Be concise but thorough, friendly, like Claude. The user is on mobile in Bulawayo, make answers mobile-friendly.
- If question is about portal login not working, explain ultra robust login with 4 methods: API, DEFAULTS, local users, test mode, and that it works on any phone.
`
  : `You are SchoolStack Second Brain — REAL builder with persistent memory + internet browsing for 13 specialist agents building school websites/portals in Bulawayo.

You have:
- PERSISTENT MEMORY from Supabase
- LIVE INTERNET BROWSING results
- You are NOT giving instructions — you BUILD real websites/portals

Be concise, actionable, and precise.

PERSISTENT MEMORIES:
${memoryContext}

LIVE WEB RESULTS:
${webContext}

Additional context: ${context}
`;

  try {
    // Use better model for Sobukhazi - Claude-level quality (fixed ID)
    const model = project_slug === 'sobukhazi-high-school' ? 'anthropic/claude-3-5-sonnet' : 'openai/gpt-4o-mini';
    const fallbackModel = 'openai/gpt-4o-mini';
    const fallbackModel2 = 'anthropic/claude-3-haiku';
    
    let res;
    let lastError = null;
    const modelsToTry = [model, fallbackModel, fallbackModel2];
    let json = null;
    for (const m of modelsToTry) {
      try {
        res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://schoolstack.bulawayo',
            'X-Title': 'SchoolStack Second Brain'
          },
          body: JSON.stringify({
            model: m,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: question }
            ],
            max_tokens: 1500,
            temperature: 0.7
          })
        });
        json = await res.json();
        if (!json.error) break;
        lastError = json.error;
        console.log(`Model ${m} failed: ${json.error.message}, trying next...`);
      } catch (e) {
        lastError = e;
        console.log(`Model ${m} fetch failed: ${e.message}`);
      }
    }

    if (!json || json.error) {
      console.error('OpenRouter all models error:', lastError);
      return { answer: `Brain error: ${lastError?.message || 'all models failed'}. Memories: ${memories.length}, Web: ${webResults.length}`, memories, webResults };
    }
    const answer = json.choices?.[0]?.message?.content || 'No answer';
    
    await addMemory({
      agent_name: 'nexus',
      memory_type: 'learning',
      title: `Q: ${question.slice(0, 80)}`,
      content: `Q: ${question}\nA: ${answer}\nWeb: ${webResults.length} results`,
      metadata: { project_slug, webResults: webResults.length }
    });

    return { answer, memories, webResults, source: 'openrouter+web-claude' };
  } catch (e) {
    console.error('Brain offline:', e.message);
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
