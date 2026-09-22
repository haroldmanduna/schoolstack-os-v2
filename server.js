import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './supabase.js';
import { addMemory, searchMemories, getProjectMemories, queryBrain, logAgentAction, searchInternet, fetchPage } from './brain.js';
import { buildRealWebsite, buildRealPortal, markLateArrival } from './builder.js';
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

async function testConnection() {
  try {
    const { data, error } = await supabase.from('projects').select('id').limit(1);
    if (error) return { connected: false, error: error.message };
    return { connected: true };
  } catch (e) {
    return { connected: false, error: e.message };
  }
}

app.get('/api/health', async (req, res) => {
  const conn = await testConnection();
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    db: conn,
    agents: 13,
    version: '3.1-real-builders+late-system+internet',
    features: ['real_website_builder','real_portal_builder','late_arrival_auto_notify','persistent_memory_supabase','internet_browsing','hermes_learning']
  });
});

// Projects
app.get('/api/projects', async (req, res) => {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (error) return res.json([{ slug: 'lwazi-academy', name: 'Lwazi Academy', type: 'website+portal', status: 'draft', fallback: true }]);
  res.json(data);
});

// REAL BUILDERS
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

// LATE ARRIVAL SYSTEM — Teacher marks late + time, parent auto notified
app.post('/api/attendance/late', async (req, res) => {
  const { student_name, class_name, arrival_time, reason, reason_details, marked_by_name, location } = req.body;
  if (!student_name || !class_name) return res.status(400).json({ error: 'student_name and class_name required' });
  const result = await markLateArrival({ student_name, class_name, arrival_time, reason, reason_details, marked_by_name: marked_by_name || 'Teacher', location });
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.get('/api/attendance/late', async (req, res) => {
  const { student, class: className, date, limit = 50 } = req.query;
  let q = supabase.from('late_arrivals').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (student) q = q.ilike('student_name', `%${student}%`);
  if (className) q = q.eq('class_name', className);
  if (date) q = q.eq('date', date);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/notifications', async (req, res) => {
  const { student, type, limit = 50 } = req.query;
  let q = supabase.from('parent_notifications').select('*').order('sent_at', { ascending: false }).limit(parseInt(limit));
  if (student) q = q.ilike('student_name', `%${student}%`);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ANNOUNCEMENTS — Admin posts, appears on website
app.get('/api/announcements', async (req, res) => {
  const { project_slug, limit = 20 } = req.query;
  let q = supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message, fallback: true });
  res.json(data);
});

app.post('/api/announcements', async (req, res) => {
  const { title, content, category, image_url, author_name, author_email, project_slug } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });
  const { data, error } = await supabase.from('announcements').insert({
    title, content, category: category || 'GENERAL', image_url,
    author_name: author_name || 'Admin', author_email,
    project_slug: project_slug || 'sobukhazi-high-school'
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  // Also save as memory for website to pick up
  await addMemory({
    agent_name: 'admin',
    memory_type: 'announcement',
    title: `${category || 'GENERAL'}: ${title}`,
    content: content + (image_url ? ` Image:${image_url}` : ''),
    metadata: { project_slug: project_slug || 'sobukhazi-high-school', category, image_url, author: author_name }
  });
  res.json(data);
});

// PORTAL USERS — Maintainer, Admin, Teacher, Parent credentials
app.get('/api/portal/users', async (req, res) => {
  const { project_slug, role, limit = 100 } = req.query;
  let q = supabase.from('portal_users').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (role) q = q.eq('role', role);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/portal/users', async (req, res) => {
  const { email, password, role, name, phone, student_name, class_name, project_slug, created_by } = req.body;
  if (!email || !password || !role || !name) return res.status(400).json({ error: 'email, password, role, name required' });
  const { data, error } = await supabase.from('portal_users').upsert({
    project_slug: project_slug || 'sobukhazi-high-school',
    email: email.toLowerCase(),
    password_plain: password,
    role,
    name,
    phone,
    student_name,
    class_name,
    created_by: created_by || 'system'
  }, { onConflict: 'project_slug,email' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await addMemory({
    agent_name: 'admin',
    memory_type: 'user_added',
    title: `User added: ${name} ${role}`,
    content: `Email ${email} Role ${role} Added by ${created_by || 'system'}`,
    metadata: { project_slug: project_slug || 'sobukhazi-high-school', role, email }
  });
  res.json(data);
});

app.post('/api/portal/login', async (req, res) => {
  const { email, password, project_slug } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const { data, error } = await supabase.from('portal_users').select('*').eq('email', email.toLowerCase()).eq('project_slug', project_slug || 'sobukhazi-high-school').single();
  if (error || !data) return res.status(401).json({ error: 'Invalid credentials', fallback: true });
  if (data.password_plain !== password) return res.status(401).json({ error: 'Invalid password' });
  res.json({ success: true, user: { id: data.id, email: data.email, role: data.role, name: data.name, project_slug: data.project_slug } });
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

// INTERNET BROWSING
app.post('/api/browse/search', async (req, res) => {
  const { query, count } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const results = await searchInternet(query, count || 8);
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

// Beacon
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
  console.log(`🚀 SchoolStack REAL BUILDERS v3.1 live on 0.0.0.0:${PORT} — Late Arrival System + Internet Browsing + Persistent Memory`);
  const conn = await testConnection();
  console.log('DB:', conn);
});
