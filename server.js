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
app.use(express.json({ limit: '10mb' }));
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

// STUDENTS — Teacher adds students + parents
app.get('/api/students', async (req, res) => {
  const { project_slug, class_name, limit = 100, search, parent_email } = req.query;
  let q = supabase.from('students').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (class_name) q = q.eq('class_name', class_name);
  if (search) q = q.ilike('name', `%${search}%`);
  if (parent_email) q = q.ilike('parent_email', parent_email);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/students', async (req, res) => {
  const { project_slug, name, class_name, gender, parent_name, parent_email, parent_phone, parent_relationship, enrollment_no, address, created_by, created_by_name } = req.body;
  if (!name || !class_name) return res.status(400).json({ error: 'name and class_name required' });
  const { data, error } = await supabase.from('students').insert({
    project_slug: project_slug || 'sobukhazi-high-school',
    name, class_name, gender: gender || 'M',
    parent_name, parent_email: parent_email?.toLowerCase(), parent_phone, parent_relationship: parent_relationship || 'Parent',
    enrollment_no, address,
    created_by: created_by || 'system',
    created_by_name: created_by_name || 'Teacher'
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Auto-create parent portal user if parent_email provided
  if (parent_email) {
    try {
      const parentPass = Math.random().toString(36).slice(-8) + '123';
      await supabase.from('portal_users').upsert({
        project_slug: project_slug || 'sobukhazi-high-school',
        email: parent_email.toLowerCase(),
        password_plain: parentPass,
        role: 'parent',
        name: parent_name || `Parent of ${name}`,
        phone: parent_phone,
        student_name: name,
        class_name,
        created_by: created_by || 'teacher'
      }, { onConflict: 'project_slug,email' });
    } catch (e) { console.log('Auto parent create failed', e.message); }
  }

  await addMemory({
    agent_name: 'teacher',
    memory_type: 'student_added',
    title: `Student added: ${name} ${class_name}`,
    content: `Student ${name} class ${class_name} parent ${parent_name} ${parent_email}`,
    metadata: { project_slug: project_slug || 'sobukhazi-high-school', class_name }
  });
  res.json(data);
});

// TERM RESULTS — Teacher posts end of term results + comments
app.get('/api/results', async (req, res) => {
  const { project_slug, student_name, class_name, term, year, limit = 100, parent_email } = req.query;
  let q = supabase.from('term_results').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (student_name) q = q.ilike('student_name', `%${student_name}%`);
  if (class_name) q = q.eq('class_name', class_name);
  if (term) q = q.eq('term', term);
  if (year) q = q.eq('year', parseInt(year));
  // Parent privacy: if parent_email provided, only show their child's results
  if (parent_email) {
    try {
      const { data: students } = await supabase.from('students').select('name').eq('project_slug', project_slug || 'sobukhazi-high-school').ilike('parent_email', parent_email).limit(20);
      if (students && students.length > 0) {
        const names = students.map(s => s.name);
        q = q.in('student_name', names);
      } else {
        // No linked student, return empty
        return res.json([]);
      }
    } catch {}
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/results', async (req, res) => {
  const { project_slug, student_id, student_name, class_name, term, year, subjects, total, average, position, total_students, teacher_comment, head_comment, conduct, attendance_pct, published, created_by, created_by_name } = req.body;
  if (!student_name || !class_name || !term) return res.status(400).json({ error: 'student_name, class_name, term required' });
  
  let calcTotal = total;
  let calcAvg = average;
  if (subjects && Array.isArray(subjects) && subjects.length > 0 && !total) {
    calcTotal = subjects.reduce((s, sub) => s + (parseInt(sub.subject_score || sub.score) || 0), 0);
    calcAvg = subjects.length ? (calcTotal / subjects.length).toFixed(1) : 0;
  }

  const { data, error } = await supabase.from('term_results').insert({
    project_slug: project_slug || 'sobukhazi-high-school',
    student_id: student_id || null,
    student_name, class_name, term,
    year: year ? parseInt(year) : new Date().getFullYear(),
    subjects: subjects || [],
    total: calcTotal ? parseInt(calcTotal) : null,
    average: calcAvg ? parseFloat(calcAvg) : null,
    position: position ? parseInt(position) : null,
    total_students: total_students ? parseInt(total_students) : null,
    teacher_comment, head_comment, conduct,
    attendance_pct: attendance_pct ? parseFloat(attendance_pct) : null,
    published: published !== false,
    created_by: created_by || 'teacher',
    created_by_name: created_by_name || 'Teacher'
  }).select().single();
  
  if (error) return res.status(400).json({ error: error.message });

  try {
    await supabase.from('parent_notifications').insert({
      student_name,
      type: 'result_published',
      title: `Results: ${term} ${year || new Date().getFullYear()} for ${student_name}`,
      message: `${student_name} (${class_name}) ${term} results published. Average: ${calcAvg || average}%. Teacher: ${teacher_comment?.slice(0,100) || 'See portal for details'}`,
      data: { term, year, average: calcAvg || average, result_id: data.id },
      channel: ['portal','sms']
    });
  } catch {}

  res.json(data);
});

// BULK RESULTS — Teacher pastes whole class at once (spreadsheet / CSV)
app.post('/api/results/bulk', async (req, res) => {
  const { project_slug, class_name, term, year, subjects_list, results, created_by, created_by_name } = req.body;
  // results = [{student_name, scores: {English:78, Maths:85}, teacher_comment, position, ...}]
  if (!class_name || !term || !results || !Array.isArray(results)) return res.status(400).json({ error: 'class_name, term, results array required' });
  
  const yearVal = year ? parseInt(year) : new Date().getFullYear();
  const subjList = subjects_list && subjects_list.length ? subjects_list : ['English','Mathematics','Combined Science','Heritage','Ndebele'];
  
  function gradeFromScore(s){
    s=parseInt(s)||0;
    if(s>=80) return 'A'; if(s>=70) return 'B'; if(s>=60) return 'C'; if(s>=50) return 'D'; if(s>=40) return 'E'; return 'U';
  }

  const toInsert = [];
  for (const r of results) {
    if (!r.student_name) continue;
    const subjects = [];
    let total = 0;
    let count = 0;
    // scores can be object or array
    if (r.scores && typeof r.scores === 'object' && !Array.isArray(r.scores)) {
      for (const subName of subjList) {
        const sc = r.scores[subName] ?? r.scores[subName.toLowerCase()] ?? null;
        if (sc !== null && sc !== '' && !isNaN(sc)) {
          const score = parseInt(sc);
          subjects.push({ name: subName, score, grade: gradeFromScore(score), comment: '' });
          total += score; count++;
        }
      }
    } else if (Array.isArray(r.subjects)) {
      for (const s of r.subjects) {
        const score = parseInt(s.score||0);
        subjects.push({ name: s.name, score, grade: s.grade||gradeFromScore(score), comment: s.comment||'' });
        total += score; count++;
      }
    }
    const avg = count ? (total/count).toFixed(1) : null;
    toInsert.push({
      project_slug: project_slug || 'sobukhazi-high-school',
      student_name: r.student_name,
      class_name,
      term,
      year: yearVal,
      subjects,
      total: total||null,
      average: avg?parseFloat(avg):null,
      position: r.position?parseInt(r.position):null,
      teacher_comment: r.teacher_comment||'',
      conduct: r.conduct||'',
      attendance_pct: r.attendance_pct?parseFloat(r.attendance_pct):null,
      published: true,
      created_by: created_by||'teacher',
      created_by_name: created_by_name||'Teacher'
    });
  }

  if (toInsert.length===0) return res.status(400).json({ error: 'No valid results' });

  const { data, error } = await supabase.from('term_results').insert(toInsert).select();
  if (error) return res.status(400).json({ error: error.message });

  // Notify parents in batch
  try {
    const notifs = data.map(d => ({
      student_name: d.student_name,
      type: 'result_published',
      title: `Results: ${term} ${yearVal} for ${d.student_name}`,
      message: `${d.student_name} (${class_name}) ${term} results published. Average: ${d.average}%. See portal.`,
      data: { term, year: yearVal, average: d.average, result_id: d.id },
      channel: ['portal','sms']
    }));
    await supabase.from('parent_notifications').insert(notifs);
  } catch {}

  res.json({ success: true, count: data.length, results: data });
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
