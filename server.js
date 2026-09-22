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

// WHATSAPP SERVICE — Connect to WhatsApp for parent notifications
const WHATSAPP_CONFIG = {
  token: process.env.WHATSAPP_TOKEN || null,
  phoneId: process.env.WHATSAPP_PHONE_ID || null,
  webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || null,
  enabled: !!(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_WEBHOOK_URL)
};

async function sendWhatsAppNotification({ to, message, student_name }) {
  // Try to get parent phone from portal_users if not provided
  let phone = to;
  if (!phone && student_name) {
    try {
      const { data } = await supabase.from('portal_users').select('phone').eq('role','parent').ilike('student_name', `%${student_name}%`).limit(1).single();
      if (data?.phone) phone = data.phone;
    } catch {}
  }
  // Fallback: check parent user with matching student_name in portal_users
  if (!phone) {
    // Use a demo number for logging if no real number
    console.log(`[WhatsApp] No phone for ${student_name}, would send: ${message.slice(0,100)}`);
    return { success: true, simulated: true, message: 'No phone configured — notification saved to portal only. Add parent phone in Manage Users to enable WhatsApp.' };
  }

  // Normalize phone: must be like 263771234567 for Zimbabwe
  let normalized = phone.replace(/[^0-9]/g, '');
  if (normalized.startsWith('0')) normalized = '263' + normalized.slice(1);
  if (!normalized.startsWith('263') && normalized.length === 9) normalized = '263' + normalized;

  // Method 1: Meta WhatsApp Cloud API
  if (WHATSAPP_CONFIG.token && WHATSAPP_CONFIG.phoneId) {
    try {
      const resp = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_CONFIG.phoneId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalized,
          type: 'text',
          text: { body: message }
        })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      console.log(`[WhatsApp Cloud] Sent to ${normalized}: ${data.messages?.[0]?.id}`);
      return { success: true, method: 'cloud_api', id: data.messages?.[0]?.id, phone: normalized };
    } catch (e) {
      console.error('[WhatsApp Cloud] Failed:', e.message);
      // Fall through to webhook
    }
  }

  // Method 2: Custom webhook (e.g., Twilio, WATI, etc.)
  if (WHATSAPP_CONFIG.webhookUrl) {
    try {
      const resp = await fetch(WHATSAPP_CONFIG.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: normalized, message, student_name, type: 'late_arrival' })
      });
      const data = await resp.text();
      console.log(`[WhatsApp Webhook] Sent to ${normalized}, response: ${data.slice(0,200)}`);
      return { success: true, method: 'webhook', phone: normalized, response: data.slice(0,200) };
    } catch (e) {
      console.error('[WhatsApp Webhook] Failed:', e.message);
    }
  }

  // Fallback: simulated — log for now, but mark as sent to portal
  console.log(`[WhatsApp SIM] To ${normalized}: ${message}`);
  return { success: true, simulated: true, phone: normalized, message: 'WhatsApp configured but no API token — set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in .env to enable real sending. Notification saved to portal.' };
}

// LATE ARRIVAL SYSTEM — Teacher marks late + time, parent auto notified via portal+SMS+WhatsApp
app.post('/api/attendance/late', async (req, res) => {
  const { student_name, class_name, arrival_time, reason, reason_details, marked_by_name, location, parent_phone } = req.body;
  if (!student_name || !class_name) return res.status(400).json({ error: 'student_name and class_name required' });
  
  // First mark late via builder
  const result = await markLateArrival({ student_name, class_name, arrival_time, reason, reason_details, marked_by_name: marked_by_name || 'Teacher', location });
  if (!result.success) return res.status(400).json(result);

  // Then try WhatsApp
  let whatsappResult = null;
  try {
    const time = arrival_time || new Date().toTimeString().slice(0,5);
    const msg = `Sobukhazi High School: ${student_name} (${class_name}) arrived late today at ${time}. Reason: ${reason}${reason_details ? ` (${reason_details})` : ''}. Marked by ${marked_by_name || 'Teacher'}. Please contact school 09200581 if needed.`;
    whatsappResult = await sendWhatsAppNotification({ to: parent_phone, message: msg, student_name });
    
    // Update notification to include whatsapp channel if sent
    if (whatsappResult.success) {
      await supabase.from('parent_notifications').update({ 
        channel: ['portal','sms','whatsapp'],
        data: { ...result.notification?.data, whatsapp: whatsappResult }
      }).eq('id', result.notification?.id);
      
      await supabase.from('late_arrivals').update({
        notification_method: ['portal','sms','whatsapp']
      }).eq('id', result.late_arrival?.id);
    }
  } catch (e) {
    console.error('WhatsApp notify failed:', e.message);
    whatsappResult = { success: false, error: e.message };
  }

  res.json({ ...result, whatsapp: whatsappResult, whatsapp_configured: WHATSAPP_CONFIG.enabled });
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

// WHATSAPP ENDPOINTS
app.get('/api/whatsapp/config', (req, res) => {
  res.json({
    enabled: WHATSAPP_CONFIG.enabled,
    has_token: !!WHATSAPP_CONFIG.token,
    has_phone_id: !!WHATSAPP_CONFIG.phoneId,
    has_webhook: !!WHATSAPP_CONFIG.webhookUrl,
    phone_id: WHATSAPP_CONFIG.phoneId ? WHATSAPP_CONFIG.phoneId.slice(0,6)+'...' : null,
    instructions: WHATSAPP_CONFIG.enabled 
      ? 'WhatsApp configured — late arrivals will auto-send to parent phone if set in portal_users.phone'
      : 'To enable real WhatsApp: 1) Create Meta WhatsApp Business App at developers.facebook.com 2) Get WHATSAPP_TOKEN and WHATSAPP_PHONE_ID 3) Set in Render env vars 4) Redeploy. OR set WHATSAPP_WEBHOOK_URL to your Twilio/WATI webhook. For now notifications save to portal and are simulated.',
    how_to_add_phone: 'Go to Portal → Manage Users → Edit parent → Add phone like 263771234567 or 0771234567. Then when teacher marks late, parent gets portal+WhatsApp.'
  });
});

app.post('/api/whatsapp/send', async (req, res) => {
  const { to, message, student_name } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const result = await sendWhatsAppNotification({ to, message, student_name: student_name || 'Test Student' });
  res.json(result);
});

app.post('/api/whatsapp/test-late', async (req, res) => {
  const { student_name, parent_phone } = req.body;
  const testMsg = `Sobukhazi High School TEST: ${student_name || 'Tariro Dube'} arrived late today at 08:23. Reason: traffic. This is a test of WhatsApp notifications. School contact 09200581.`;
  const result = await sendWhatsAppNotification({ to: parent_phone, message: testMsg, student_name: student_name || 'Tariro Dube' });
  res.json({ test: true, ...result });
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
