import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './supabase.js';
import { addMemory, searchMemories, getProjectMemories, queryBrain, logAgentAction, searchInternet, fetchPage } from './brain.js';
import { buildRealWebsite, buildRealPortal } from './builder.js';
import fs from 'fs';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/projects', express.static(path.join(__dirname, 'public', 'projects')));
app.use('/old-projects', express.static('/home/user/SchoolStack/projects'));

let dbStatus = { connected: false, error: null };

async function testConnection() {
  try {
    const { data, error } = await supabase.from('projects').select('id').limit(1);
    if (error) return { connected: false, error: error.message };
    return { connected: true };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

// Health
app.get('/api/health', async (req, res) => {
  const conn = await testConnection();
  dbStatus = conn;
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    db: conn,
    agents: 13,
    version: '3.0-real-builders+internet',
    features: ['real_website_builder','real_portal_builder','persistent_memory_supabase','internet_browsing','hermes_learning']
  });
});

// Projects
app.get('/api/projects', async (req, res) => {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (error) return res.json([{ slug: 'lwazi-academy', name: 'Lwazi Academy', type: 'website+portal', status: 'draft', fallback: true }]);
  res.json(data);
});

app.post('/api/projects', async (req, res) => {
  const { name, type, brief } = req.body;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { data, error } = await supabase.from('projects').insert({ slug, name, type, brief }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await addMemory({
    project_id: data.id,
    agent_name: 'nexus',
    memory_type: 'decision',
    title: `Project created: ${name}`,
    content: `Created project ${name} type ${type}. Brief: ${brief}`
  });
  res.json(data);
});

// REAL BUILDERS — Actually build websites, not instructions
app.post('/api/build/website', async (req, res) => {
  const { school_name, type, location, tagline, colors } = req.body;
  if (!school_name) return res.status(400).json({ error: 'school_name required' });
  const start = Date.now();
  try {
    const result = await buildRealWebsite({ school_name, type: type || 'website+portal', location: location || 'Bulawayo', tagline, colors });
    await logAgentAction({
      agent_name: 'forge',
      action: `build_website:${school_name}`,
      input: JSON.stringify(req.body),
      output: JSON.stringify(result),
      duration_ms: Date.now() - start
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/build/portal', async (req, res) => {
  const { school_name, modules } = req.body;
  if (!school_name) return res.status(400).json({ error: 'school_name required' });
  const result = await buildRealPortal({ school_name, modules });
  res.json(result);
});

// Memories / Second Brain (PERSISTENT)
app.get('/api/memories', async (req, res) => {
  const { q, agent, project, limit } = req.query;
  const memories = await searchMemories({ query: q, agent_name: agent, limit: parseInt(limit) || 20 });
  res.json(memories);
});

app.post('/api/memories', async (req, res) => {
  const mem = await addMemory(req.body);
  res.json(mem);
});

app.get('/api/projects/:slug/memories', async (req, res) => {
  const memories = await getProjectMemories(req.params.slug);
  res.json(memories);
});

// Brain query with INTERNET BROWSING + PERSISTENT MEMORY
app.post('/api/brain/query', async (req, res) => {
  const { question, context, project_slug, browse } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const start = Date.now();
  const result = await queryBrain({ question, context, project_slug, browse: browse !== false });
  await logAgentAction({
    agent_name: 'nexus',
    action: 'brain_query',
    input: question,
    output: result.answer,
    duration_ms: Date.now() - start
  });
  res.json(result);
});

// INTERNET BROWSING ABILITY
app.post('/api/browse/search', async (req, res) => {
  const { query, count } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const results = await searchInternet(query, count || 8);
  // Store search as memory (persistent)
  await addMemory({
    agent_name: 'beacon',
    memory_type: 'observation',
    title: `Web search: ${query}`,
    content: `Searched "${query}" → ${results.length} results. Top: ${results[0]?.title || 'none'}`,
    metadata: { query, results: results.length, real_browse: true }
  });
  res.json({ query, results, count: results.length });
});

app.post('/api/browse/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  const page = await fetchPage(url);
  await addMemory({
    agent_name: 'beacon',
    memory_type: 'observation',
    title: `Fetched: ${url}`,
    content: `Fetched ${url} → ${page.length} chars. ${page.content.slice(0, 500)}`,
    metadata: { url, real_fetch: true }
  });
  res.json(page);
});

// Beacon leads (PERSISTENT)
app.get('/api/beacon/leads', async (req, res) => {
  const { classification, limit = 50 } = req.query;
  let query = supabase.from('beacon_leads').select('*').order('opportunity_score', { ascending: false }).limit(parseInt(limit));
  if (classification) query = query.eq('classification', classification);
  const { data, error } = await query;
  if (error) {
    try {
      const raw = fs.readFileSync('/home/user/SchoolStack/beacon/leads/bulawayo_2026-09-21.json', 'utf8');
      const leads = JSON.parse(raw);
      return res.json(leads.slice(0, limit));
    } catch {
      return res.json([]);
    }
  }
  res.json(data);
});

app.get('/api/beacon/stats', async (req, res) => {
  const { data, error } = await supabase.from('beacon_leads').select('classification, confidence, opportunity_score');
  if (error) {
    return res.json({ total: 51, by_classification: { no_website_found: 4, website_no_portal: 5, needs_manual: 42 }, fallback: true });
  }
  const stats = {
    total: data.length,
    by_classification: {},
    by_confidence: {},
    high_opportunity: data.filter(d => d.opportunity_score >= 8).length
  };
  data.forEach(d => {
    stats.by_classification[d.classification] = (stats.by_classification[d.classification] || 0) + 1;
    stats.by_confidence[d.confidence] = (stats.by_confidence[d.confidence] || 0) + 1;
  });
  res.json(stats);
});

// Decisions, Tasks, Logs, Skills (PERSISTENT MEMORY VISIBLE)
app.get('/api/decisions', async (req, res) => {
  const { data } = await supabase.from('decisions').select('*').order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
});
app.get('/api/tasks', async (req, res) => {
  const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
});
app.get('/api/logs', async (req, res) => {
  const { data } = await supabase.from('agent_logs').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});
app.get('/api/skills', async (req, res) => {
  const { data } = await supabase.from('agent_skills').select('*').order('success_count', { ascending: false });
  res.json(data || []);
});
app.get('/api/reflections', async (req, res) => {
  const { data } = await supabase.from('agent_reflections').select('*').order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
});

// Serve built projects list
app.get('/api/built', (req, res) => {
  const publicProjects = path.join(__dirname, 'public', 'projects');
  try {
    const dirs = fs.readdirSync(publicProjects, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const built = dirs.map(slug => ({
      slug,
      preview: `/projects/${slug}/`,
      portal: `/projects/${slug}/portal.html`,
      files: fs.existsSync(path.join(publicProjects, slug, 'index.html'))
    }));
    res.json(built);
  } catch {
    res.json([]);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 SchoolStack REAL BUILDERS v3 live on 0.0.0.0:${PORT}`);
  const conn = await testConnection();
  console.log('DB:', conn);
  console.log('Features: real_website_builder, real_portal_builder, persistent_memory, internet_browsing, hermes_learning');
});
