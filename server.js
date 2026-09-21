import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, testConnection } from './supabase.js';
import { addMemory, searchMemories, getProjectMemories, queryBrain, logAgentAction } from './brain.js';
import fs from 'fs';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/draft', express.static('/home/user/SchoolStack/projects/lwazi-academy/draft'));
app.use('/old-dashboard', express.static('/home/user/SchoolStack/dashboard'));

let dbStatus = { connected: false, error: null };

// Health
app.get('/api/health', async (req, res) => {
  const conn = await testConnection();
  dbStatus = conn;
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    db: conn,
    agents: 13,
    version: '2.0-brain'
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

// Memories / Second Brain
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

// Brain query (second brain reasoning with OpenRouter)
app.post('/api/brain/query', async (req, res) => {
  const { question, context, project_slug } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });
  const start = Date.now();
  const result = await queryBrain({ question, context, project_slug });
  await logAgentAction({
    agent_name: 'nexus',
    action: 'brain_query',
    input: question,
    output: result.answer,
    duration_ms: Date.now() - start
  });
  res.json(result);
});

// Beacon leads
app.get('/api/beacon/leads', async (req, res) => {
  const { classification, limit = 50 } = req.query;
  let query = supabase.from('beacon_leads').select('*').order('opportunity_score', { ascending: false }).limit(parseInt(limit));
  if (classification) query = query.eq('classification', classification);
  const { data, error } = await query;
  if (error) {
    // Fallback to file
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

// Decisions
app.get('/api/decisions', async (req, res) => {
  const { project_id } = req.query;
  let q = supabase.from('decisions').select('*').order('created_at', { ascending: false }).limit(50);
  if (project_id) q = q.eq('project_id', project_id);
  const { data } = await q;
  res.json(data || []);
});

app.post('/api/decisions', async (req, res) => {
  const { data, error } = await supabase.from('decisions').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Tasks
app.get('/api/tasks', async (req, res) => {
  const { project_id } = req.query;
  let q = supabase.from('tasks').select('*').order('created_at', { ascending: false });
  if (project_id) q = q.eq('project_id', project_id);
  const { data } = await q;
  res.json(data || []);
});

app.post('/api/tasks', async (req, res) => {
  const { data, error } = await supabase.from('tasks').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Logs
app.get('/api/logs', async (req, res) => {
  const { data } = await supabase.from('agent_logs').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

// Fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 SchoolStack Second Brain live on 0.0.0.0:${PORT}`);
  const conn = await testConnection();
  dbStatus = conn;
  console.log('DB:', conn);
  console.log('Agents: 13 live');
  console.log('Second brain: OpenRouter enabled?', !!process.env.OPENROUTER_API_KEY);
});
