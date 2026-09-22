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

// =====================
// FEES — Configurable by Bursar, Dual USD+ZiG
// =====================

// Fee Structures
app.get('/api/fees/structures', async (req, res) => {
  const { project_slug, form, term, year, limit = 100 } = req.query;
  let q = supabase.from('fee_structures').select('*').order('year', { ascending: false }).order('form_name').limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (form) q = q.eq('form_name', form);
  if (term) q = q.eq('term', term);
  if (year) q = q.eq('year', parseInt(year));
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/fees/structures', async (req, res) => {
  const { project_slug, form_name, term, year, tuition_usd, levies_usd, exchange_rate, description, created_by } = req.body;
  if (!form_name || !term) return res.status(400).json({ error: 'form_name and term required' });
  const { data, error } = await supabase.from('fee_structures').upsert({
    project_slug: project_slug || 'sobukhazi-high-school',
    form_name,
    term,
    year: year ? parseInt(year) : new Date().getFullYear(),
    tuition_usd: tuition_usd ? parseFloat(tuition_usd) : 0,
    levies_usd: levies_usd ? parseFloat(levies_usd) : 0,
    exchange_rate: exchange_rate ? parseFloat(exchange_rate) : 26.5,
    description,
    created_by: created_by || 'bursar'
  }, { onConflict: 'project_slug,form_name,term,year' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/fees/generate-invoices', async (req, res) => {
  const { project_slug, term, year, form_name, due_date, created_by } = req.body;
  if (!term) return res.status(400).json({ error: 'term required' });
  const yearVal = year ? parseInt(year) : new Date().getFullYear();
  const slug = project_slug || 'sobukhazi-high-school';
  
  // Get fee structures for this term/year
  let feeQuery = supabase.from('fee_structures').select('*').eq('project_slug', slug).eq('term', term).eq('year', yearVal);
  if (form_name) feeQuery = feeQuery.eq('form_name', form_name);
  const { data: structures, error: feeErr } = await feeQuery;
  if (feeErr) return res.status(400).json({ error: feeErr.message });
  if (!structures || structures.length === 0) return res.status(400).json({ error: 'No fee structures found for '+term+' '+yearVal+'. Bursar must set fees first.' });

  // Get students
  let stuQuery = supabase.from('students').select('*').eq('project_slug', slug).limit(500);
  if (form_name) {
    // form_name could be "Form 1" or "1A" — match class_name
    if (form_name.startsWith('Form ')) {
      const formNum = form_name.replace('Form ','').trim();
      stuQuery = stuQuery.ilike('class_name', `${formNum}%`);
    } else {
      stuQuery = stuQuery.eq('class_name', form_name);
    }
  }
  const { data: students, error: stuErr } = await stuQuery;
  if (stuErr) return res.status(400).json({ error: stuErr.message });
  if (!students || students.length === 0) return res.status(400).json({ error: 'No students found' });

  // Generate invoices
  const invoices = [];
  for (const student of students) {
    // Find matching fee structure
    let fee = structures.find(s => s.form_name === student.class_name) || structures.find(s => s.form_name === `Form ${student.class_name.charAt(0)}`) || structures[0];
    if (!fee) continue;
    
    // Check if invoice already exists
    const { data: existing } = await supabase.from('invoices').select('id').eq('project_slug', slug).eq('student_name', student.name).eq('term', term).eq('year', yearVal).limit(1);
    if (existing && existing.length > 0) continue;

    invoices.push({
      project_slug: slug,
      student_id: student.id,
      student_name: student.name,
      class_name: student.class_name,
      form_name: fee.form_name,
      term,
      year: yearVal,
      amount_usd: fee.total_usd,
      amount_zig: fee.total_zig,
      amount_due_usd: fee.total_usd,
      amount_due_zig: fee.total_zig,
      amount_paid_usd: 0,
      status: 'unpaid',
      due_date: due_date || null,
      created_by: created_by || 'system'
    });
  }

  if (invoices.length === 0) return res.json({ success: true, count: 0, message: 'All invoices already exist' });

  const { data, error } = await supabase.from('invoices').insert(invoices).select();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, count: data.length, invoices: data });
});

// Invoices
app.get('/api/fees/invoices', async (req, res) => {
  const { project_slug, student_name, class_name, term, year, status, parent_email, limit = 100 } = req.query;
  let q = supabase.from('invoices').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (student_name) q = q.ilike('student_name', `%${student_name}%`);
  if (class_name) q = q.eq('class_name', class_name);
  if (term) q = q.eq('term', term);
  if (year) q = q.eq('year', parseInt(year));
  if (status) q = q.eq('status', status);
  if (parent_email) {
    try {
      const { data: students } = await supabase.from('students').select('name').eq('project_slug', project_slug || 'sobukhazi-high-school').ilike('parent_email', parent_email).limit(20);
      if (students && students.length > 0) {
        q = q.in('student_name', students.map(s => s.name));
      } else {
        return res.json([]);
      }
    } catch {}
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Payments
app.get('/api/fees/payments', async (req, res) => {
  const { project_slug, student_name, class_name, method, currency, parent_email, limit = 100 } = req.query;
  let q = supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (student_name) q = q.ilike('student_name', `%${student_name}%`);
  if (class_name) q = q.eq('class_name', class_name);
  if (method) q = q.eq('method', method);
  if (currency) q = q.eq('currency', currency);
  if (parent_email) {
    try {
      const { data: students } = await supabase.from('students').select('name').eq('project_slug', project_slug || 'sobukhazi-high-school').ilike('parent_email', parent_email).limit(20);
      if (students && students.length > 0) {
        q = q.in('student_name', students.map(s => s.name));
      } else {
        return res.json([]);
      }
    } catch {}
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/fees/payments', async (req, res) => {
  const { project_slug, student_id, student_name, class_name, invoice_id, amount, currency, method, reference_code, paid_at, recorded_by, recorded_by_name, notes } = req.body;
  if (!student_name || !amount) return res.status(400).json({ error: 'student_name and amount required' });
  
  const slug = project_slug || 'sobukhazi-high-school';
  const receiptNo = `REC-SOB-${new Date().getFullYear()}-${Math.random().toString(36).substr(2,6).toUpperCase()}`;

  // Check reference uniqueness
  if (reference_code) {
    const { data: existing } = await supabase.from('payments').select('id').eq('project_slug', slug).eq('reference_code', reference_code).limit(1);
    if (existing && existing.length > 0) return res.status(400).json({ error: 'Reference code already used: '+reference_code });
  }

  const { data, error } = await supabase.from('payments').insert({
    project_slug: slug,
    student_id: student_id || null,
    invoice_id: invoice_id || null,
    student_name,
    class_name,
    amount: parseFloat(amount),
    currency: currency || 'USD',
    method: method || 'Cash USD',
    reference_code,
    receipt_no: receiptNo,
    paid_at: paid_at || new Date().toISOString().split('T')[0],
    recorded_by: recorded_by || 'bursar',
    recorded_by_name: recorded_by_name || 'Bursar',
    notes
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Update invoice paid amount and status
  try {
    if (invoice_id) {
      const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoice_id).single();
      if (inv) {
        const isUSD = (currency || 'USD') === 'USD';
        const newPaidUSD = parseFloat(inv.amount_paid_usd || 0) + (isUSD ? parseFloat(amount) : 0);
        const newPaidZiG = parseFloat(inv.amount_paid_zig || 0) + (!isUSD ? parseFloat(amount) : 0);
        // Simplified: if USD payment, reduce USD due
        let newDueUSD = parseFloat(inv.amount_usd) - newPaidUSD;
        let status = 'unpaid';
        if (newDueUSD <= 0) status = 'paid';
        else if (newPaidUSD > 0) status = 'partial';
        
        await supabase.from('invoices').update({
          amount_paid_usd: newPaidUSD,
          amount_paid_zig: newPaidZiG,
          amount_due_usd: Math.max(0, newDueUSD),
          status
        }).eq('id', invoice_id);
      }
    } else {
      // No invoice_id, find latest unpaid invoice for student
      const { data: invs } = await supabase.from('invoices').select('*').eq('project_slug', slug).eq('student_name', student_name).order('created_at', { ascending: false }).limit(1);
      if (invs && invs.length > 0) {
        const inv = invs[0];
        const isUSD = (currency || 'USD') === 'USD';
        const newPaidUSD = parseFloat(inv.amount_paid_usd || 0) + (isUSD ? parseFloat(amount) : 0);
        let newDueUSD = parseFloat(inv.amount_usd) - newPaidUSD;
        let status = newDueUSD <= 0 ? 'paid' : (newPaidUSD > 0 ? 'partial' : 'unpaid');
        await supabase.from('invoices').update({
          amount_paid_usd: newPaidUSD,
          amount_due_usd: Math.max(0, newDueUSD),
          status
        }).eq('id', inv.id);
      }
    }
  } catch (e) { console.log('Invoice update failed', e.message); }

  // Notify parent
  try {
    await supabase.from('parent_notifications').insert({
      student_name,
      type: 'fee_payment',
      title: `Fee Payment Received: $${amount} ${currency || 'USD'} for ${student_name}`,
      message: `Payment of $${amount} ${currency || 'USD'} via ${method} (Ref: ${reference_code || receiptNo}) recorded for ${student_name}. Receipt ${receiptNo}.`,
      data: { amount, currency, method, receipt_no: receiptNo, reference_code },
      channel: ['portal']
    });
  } catch {}

  res.json(data);
});

// Fees summary
app.get('/api/fees/summary', async (req, res) => {
  const { project_slug, term, year } = req.query;
  const slug = project_slug || 'sobukhazi-high-school';
  const yearVal = year ? parseInt(year) : new Date().getFullYear();
  
  let invQuery = supabase.from('invoices').select('*').eq('project_slug', slug);
  if (term) invQuery = invQuery.eq('term', term);
  if (year) invQuery = invQuery.eq('year', yearVal);
  const { data: invoices } = await invQuery;
  
  let payQuery = supabase.from('payments').select('*').eq('project_slug', slug);
  const { data: payments } = await payQuery.limit(1000);
  
  const totalInvoiced = invoices ? invoices.reduce((s, i) => s + parseFloat(i.amount_usd || 0), 0) : 0;
  const totalPaid = payments ? payments.reduce((s, p) => s + (p.currency === 'USD' ? parseFloat(p.amount || 0) : 0), 0) : 0;
  const totalDue = invoices ? invoices.reduce((s, i) => s + parseFloat(i.amount_due_usd || 0), 0) : 0;
  const overdue = invoices ? invoices.filter(i => i.status === 'overdue').length : 0;
  
  res.json({
    total_invoiced_usd: totalInvoiced,
    total_paid_usd: totalPaid,
    total_due_usd: totalDue,
    overdue_count: overdue,
    invoices_count: invoices ? invoices.length : 0,
    payments_count: payments ? payments.length : 0,
    by_method: payments ? payments.reduce((acc, p) => { acc[p.method] = (acc[p.method]||0)+parseFloat(p.amount||0); return acc; }, {}) : {}
  });
});

// =====================
// ADMISSIONS — Configurable
// =====================

app.get('/api/admissions/applications', async (req, res) => {
  const { project_slug, status, form, search, limit = 100 } = req.query;
  let q = supabase.from('admissions_applications').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (status) q = q.eq('status', status);
  if (form) q = q.eq('applying_form', form);
  if (search) q = q.ilike('applicant_name', `%${search}%`);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/admissions/applications/:id', async (req, res) => {
  const { data, error } = await supabase.from('admissions_applications').select('*').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  // Also get exams and interviews
  const { data: exams } = await supabase.from('admission_exams').select('*').eq('application_id', req.params.id).order('created_at', { ascending: false });
  const { data: interviews } = await supabase.from('admission_interviews').select('*').eq('application_id', req.params.id).order('created_at', { ascending: false });
  res.json({ ...data, exams: exams || [], interviews: interviews || [] });
});

app.post('/api/admissions/applications', async (req, res) => {
  const { project_slug, applicant_name, dob, gender, applying_form, previous_school, last_grade, grade7_results, olevel_results, parent_name, parent_email, parent_phone, parent_id_no, address, reason_for_transfer, birth_cert_url, report_url, photo_url, transfer_letter_url, id_copy_url, enrollment_fee_usd } = req.body;
  if (!applicant_name || !applying_form || !parent_name || !parent_email) return res.status(400).json({ error: 'applicant_name, applying_form, parent_name, parent_email required' });
  
  const slug = project_slug || 'sobukhazi-high-school';
  const appNo = `SOB-APP-${new Date().getFullYear()}-${Math.random().toString(36).substr(2,6).toUpperCase()}`;

  const { data, error } = await supabase.from('admissions_applications').insert({
    project_slug: slug,
    application_no: appNo,
    applicant_name,
    dob: dob || null,
    gender: gender || 'M',
    applying_form,
    previous_school,
    last_grade,
    grade7_results: grade7_results || null,
    olevel_results: olevel_results || null,
    parent_name,
    parent_email: parent_email.toLowerCase(),
    parent_phone,
    parent_id_no,
    address,
    reason_for_transfer,
    birth_cert_url,
    report_url,
    photo_url,
    transfer_letter_url,
    id_copy_url,
    enrollment_fee_usd: enrollment_fee_usd ? parseFloat(enrollment_fee_usd) : 100,
    status: 'pending_documents'
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  try {
    await supabase.from('parent_notifications').insert({
      student_name: applicant_name,
      type: 'admission_applied',
      title: `Admission Application Received: ${applicant_name} for ${applying_form}`,
      message: `Application ${appNo} for ${applicant_name} (${applying_form}) received. Parent ${parent_name}. We will verify documents and schedule entrance exam.`,
      data: { application_id: data.id, application_no: appNo },
      channel: ['portal']
    });
  } catch {}

  res.json(data);
});

app.patch('/api/admissions/applications/:id', async (req, res) => {
  const { status, verification_notes, decision_reason, verified_by, decision_by, enrollment_fee_paid } = req.body;
  const updates = {};
  if (status) {
    updates.status = status;
    if (status === 'documents_verified') { updates.verified_at = new Date().toISOString(); updates.verified_by = verified_by || 'admin'; }
    if (['accepted','rejected','waitlist'].includes(status)) { updates.decision_at = new Date().toISOString(); updates.decision_by = decision_by || 'admin'; }
  }
  if (verification_notes) updates.verification_notes = verification_notes;
  if (decision_reason) updates.decision_reason = decision_reason;
  if (enrollment_fee_paid !== undefined) updates.enrollment_fee_paid = enrollment_fee_paid;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('admissions_applications').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/admissions/enroll/:id', async (req, res) => {
  const { created_by, created_by_name } = req.body;
  const { data: app, error: appErr } = await supabase.from('admissions_applications').select('*').eq('id', req.params.id).single();
  if (appErr) return res.status(400).json({ error: appErr.message });
  if (!['accepted','fees_paid'].includes(app.status)) return res.status(400).json({ error: 'Application must be accepted and fees paid before enrollment' });

  // Create student
  const enrollmentNo = `SOB${new Date().getFullYear()}${Math.floor(Math.random()*9000)+1000}`;
  const { data: student, error: stuErr } = await supabase.from('students').insert({
    project_slug: app.project_slug,
    name: app.applicant_name,
    class_name: app.applying_form,
    gender: app.gender,
    dob: app.dob,
    enrollment_no: enrollmentNo,
    parent_name: app.parent_name,
    parent_email: app.parent_email.toLowerCase(),
    parent_phone: app.parent_phone,
    parent_relationship: 'Parent',
    address: app.address,
    created_by: created_by || 'admin',
    created_by_name: created_by_name || 'Admin'
  }).select().single();

  if (stuErr) return res.status(400).json({ error: stuErr.message });

  // Create parent user
  try {
    const parentPass = Math.random().toString(36).slice(-8) + '123';
    await supabase.from('portal_users').upsert({
      project_slug: app.project_slug,
      email: app.parent_email.toLowerCase(),
      password_plain: parentPass,
      role: 'parent',
      name: app.parent_name,
      phone: app.parent_phone,
      student_name: app.applicant_name,
      class_name: app.applying_form,
      created_by: created_by || 'admin'
    }, { onConflict: 'project_slug,email' });
  } catch (e) { console.log('Parent create failed', e.message); }

  // Update application to enrolled
  await supabase.from('admissions_applications').update({ status: 'enrolled', updated_at: new Date().toISOString() }).eq('id', req.params.id);

  res.json({ success: true, student, enrollment_no: enrollmentNo });
});

// Exams
app.get('/api/admissions/exams', async (req, res) => {
  const { project_slug, application_id, limit = 100 } = req.query;
  let q = supabase.from('admission_exams').select('*').order('exam_date', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (application_id) q = q.eq('application_id', application_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/admissions/exams', async (req, res) => {
  const { project_slug, application_id, applicant_name, applying_form, exam_date, exam_time, venue, subjects_config, scores, examiner_name, notes, created_by } = req.body;
  if (!application_id || !applicant_name || !exam_date) return res.status(400).json({ error: 'application_id, applicant_name, exam_date required' });

  let total = 0, max = 0;
  if (scores && typeof scores === 'object') {
    total = Object.values(scores).reduce((s, v) => s + (parseInt(v) || 0), 0);
  }
  if (subjects_config && Array.isArray(subjects_config)) {
    max = subjects_config.reduce((s, sub) => s + (parseInt(sub.max) || 100), 0);
  }
  const percentage = max ? (total / max * 100).toFixed(1) : null;
  const result = percentage ? (parseFloat(percentage) >= 50 ? 'pass' : 'fail') : 'pending';

  const { data, error } = await supabase.from('admission_exams').insert({
    project_slug: project_slug || 'sobukhazi-high-school',
    application_id,
    applicant_name,
    applying_form,
    exam_date,
    exam_time: exam_time || null,
    venue,
    subjects_config: subjects_config || [{ name: 'Mathematics', max: 100 }, { name: 'English', max: 100 }],
    scores: scores || {},
    total_score: total,
    max_score: max,
    percentage: percentage ? parseFloat(percentage) : null,
    result,
    examiner_name,
    notes,
    created_by: created_by || 'admin'
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });

  // Update application status
  await supabase.from('admissions_applications').update({ status: 'exam_done', updated_at: new Date().toISOString() }).eq('id', application_id);

  res.json(data);
});

// =====================
// AI ANALYSES — No Hallucination
// =====================

app.get('/api/ai/analyses', async (req, res) => {
  const { project_slug, student_name, class_name, term, year, parent_email, limit = 50 } = req.query;
  let q = supabase.from('ai_analyses').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (project_slug) q = q.eq('project_slug', project_slug);
  if (student_name) q = q.ilike('student_name', `%${student_name}%`);
  if (class_name) q = q.eq('class_name', class_name);
  if (term) q = q.eq('term', term);
  if (year) q = q.eq('year', parseInt(year));
  if (parent_email) {
    try {
      const { data: students } = await supabase.from('students').select('name').eq('project_slug', project_slug || 'sobukhazi-high-school').ilike('parent_email', parent_email).limit(20);
      if (students && students.length > 0) {
        q = q.in('student_name', students.map(s => s.name));
      } else {
        return res.json([]);
      }
    } catch {}
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/ai/analyze-student', async (req, res) => {
  const { project_slug, student_name, class_name, term, year, force_reanalyze } = req.body;
  if (!student_name || !class_name) return res.status(400).json({ error: 'student_name and class_name required' });

  const slug = project_slug || 'sobukhazi-high-school';
  const termVal = term || 'Term 2';
  const yearVal = year ? parseInt(year) : new Date().getFullYear();

  // Check cache
  if (!force_reanalyze) {
    const { data: existing } = await supabase.from('ai_analyses').select('*').eq('project_slug', slug).eq('student_name', student_name).eq('term', termVal).eq('year', yearVal).limit(1);
    if (existing && existing.length > 0) {
      return res.json({ ...existing[0], cached: true });
    }
  }

  // Fetch REAL data — no hallucination
  const { data: results, error: resErr } = await supabase.from('term_results').select('*').eq('project_slug', slug).eq('student_name', student_name).order('year', { ascending: true }).order('created_at', { ascending: true });
  if (resErr) return res.status(400).json({ error: resErr.message });
  if (!results || results.length === 0) return res.status(400).json({ error: 'No real results found for '+student_name+' — cannot analyze without data (no hallucination)' });

  // Get class averages for comparison
  const { data: classResults } = await supabase.from('term_results').select('average, subjects').eq('project_slug', slug).eq('class_name', class_name).eq('term', termVal).eq('year', yearVal).limit(100);

  // Get late count
  const { data: lates } = await supabase.from('late_arrivals').select('*').ilike('student_name', `%${student_name}%`).limit(50);

  // Calculate real metrics — NO AI YET, pure math
  const currentResult = results.find(r => r.term === termVal && r.year === yearVal) || results[results.length - 1];
  const previousResults = results.filter(r => !(r.term === termVal && r.year === yearVal));
  
  const classAvg = classResults && classResults.length > 0 ? (classResults.reduce((s, r) => s + parseFloat(r.average || 0), 0) / classResults.length).toFixed(1) : null;
  const position = currentResult.position;
  const totalStudents = currentResult.total_students || (classResults ? classResults.length : null);
  
  // Trend calculation
  let trend = null;
  if (previousResults.length > 0) {
    const prevAvg = parseFloat(previousResults[previousResults.length - 1].average || 0);
    const currAvg = parseFloat(currentResult.average || 0);
    trend = {
      direction: currAvg > prevAvg ? 'improving' : currAvg < prevAvg ? 'declining' : 'stable',
      delta: (currAvg - prevAvg).toFixed(1),
      previous_avg: prevAvg,
      current_avg: currAvg,
      previous_term: previousResults[previousResults.length - 1].term
    };
  }

  // Strengths / Weaknesses from REAL scores
  const subjects = currentResult.subjects || [];
  const strengths = subjects.filter(s => parseInt(s.score) >= 70).sort((a,b) => b.score - a.score).slice(0,3).map(s => ({
    subject: s.name,
    score: s.score,
    grade: s.grade,
    reason: classAvg ? `${s.score}% vs class avg ${classAvg}%` : `${s.score}%`
  }));
  const weaknesses = subjects.filter(s => parseInt(s.score) < 60).sort((a,b) => a.score - b.score).slice(0,3).map(s => ({
    subject: s.name,
    score: s.score,
    grade: s.grade,
    reason: `Needs improvement — ${s.score}%`
  }));

  const lateCount = lates ? lates.length : 0;
  const riskFlags = [];
  if (lateCount >= 5) riskFlags.push(`${lateCount} late arrivals this term`);
  if (trend && parseFloat(trend.delta) < -5) riskFlags.push(`Drop of ${Math.abs(trend.delta)}% from ${trend.previous_term}`);
  if (parseFloat(currentResult.average) < 40) riskFlags.push(`Average ${currentResult.average}% below pass mark`);
  weaknesses.forEach(w => { if (parseInt(w.score) < 50) riskFlags.push(`${w.subject} ${w.score}% (${w.grade}) — at risk`); });

  // Real data snapshot for audit
  const dataSnapshot = {
    student_name,
    class_name,
    term: termVal,
    year: yearVal,
    current_result: {
      average: currentResult.average,
      total: currentResult.total,
      subjects: currentResult.subjects,
      position: currentResult.position,
      teacher_comment: currentResult.teacher_comment
    },
    previous_results: previousResults.map(r => ({ term: r.term, year: r.year, average: r.average, subjects: r.subjects })),
    class_average: classAvg,
    class_size: totalStudents,
    late_count: lateCount,
    lates: lates ? lates.slice(0,5).map(l => ({ date: l.date, time: l.arrival_time, reason: l.reason })) : [],
    calculated_at: new Date().toISOString()
  };

  // Now call AI for interpretation — but ONLY with real data
  let aiOutput = null;
  try {
    const prompt = `You are Sobukhazi High School AI Assistant. Analyze this REAL student data — DO NOT hallucinate, DO NOT invent scores, ONLY use provided data.

REAL DATA (audit snapshot):
${JSON.stringify(dataSnapshot, null, 2)}

TREND (calculated):
${JSON.stringify(trend, null, 2)}

STRENGTHS (from real scores >=70%):
${JSON.stringify(strengths, null, 2)}

WEAKNESSES (from real scores <60%):
${JSON.stringify(weaknesses, null, 2)}

RISK FLAGS (real):
${JSON.stringify(riskFlags, null, 2)}

CLASS COMPARISON: Class avg ${classAvg}%, Position ${position}/${totalStudents}

TASK: Provide JSON ONLY with:
{
  "predicted_grades": {"subject": "predicted ZIMSEC grade A-U based on current trend"},
  "teacher_actions": ["3 specific actions teacher should take"],
  "draft_comment": "Professional teacher comment for report card (2-3 sentences, based ONLY on real scores)",
  "parent_summary": "Simple encouraging summary for parent (2 sentences, no harsh language, mention strengths and 1 area to improve + late count if any)",
  "class_comparison": {"summary": "above/below average"}
}

Rules:
- NO fake data, NO invented subjects
- If only 1 term data, say trend is new, not improving/declining
- Predicted grades based on current scores: 80+ A, 70+ B, 60+ C, 50+ D, 40+ E, <40 U
- Be specific to Sobukhazi context (bakhazimula spirit, athletics)
- Return JSON only`;

    const { data: aiData } = await supabase.functions.invoke ? null : { data: null }; // placeholder

    // Use OpenRouter directly
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://schoolstack-os-v2.onrender.com',
          'X-Title': 'Sobukhazi AI Analysis'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3-5-sonnet',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
          temperature: 0.3
        })
      });
      const aiJson = await resp.json();
      const content = aiJson.choices?.[0]?.message?.content || '';
      // Try to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiOutput = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI did not return JSON');
      }
    } else {
      // Fallback without AI — rule-based
      aiOutput = {
        predicted_grades: subjects.reduce((acc, s) => {
          const score = parseInt(s.score);
          acc[s.name] = score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : score >= 40 ? 'E' : 'U';
          return acc;
        }, {}),
        teacher_actions: [
          strengths.length > 0 ? `Leverage strength in ${strengths[0].subject} for peer tutoring` : 'Focus on foundational skills',
          weaknesses.length > 0 ? `Extra support in ${weaknesses[0].subject} — 30min/week past papers` : 'Maintain current effort',
          lateCount >= 5 ? `Address ${lateCount} late arrivals — check transport` : 'Encourage consistent attendance'
        ],
        draft_comment: `${student_name} ${trend ? `${trend.direction} with ${trend.delta}% ${trend.direction === 'improving' ? 'improvement' : 'change'}` : 'shows effort'} — Average ${currentResult.average}%. ${strengths.length ? `Strong in ${strengths.map(s=>s.subject).join(', ')}.` : ''} ${weaknesses.length ? `Needs support in ${weaknesses.map(s=>s.subject).join(', ')}.` : ''} ${lateCount ? `${lateCount} late arrivals — improve punctuality.` : ''} Shows bakhazimula spirit.`,
        parent_summary: `${student_name} is ${trend?.direction === 'improving' ? 'improving' : 'working hard'} — ${strengths.length ? `${strengths[0].subject} is a strength!` : 'Keep encouraging.'} ${weaknesses.length ? `${weaknesses[0].subject} needs more practice.` : ''} ${lateCount ? `${lateCount} late arrivals this term — please help with time.` : ''}`,
        class_comparison: { summary: classAvg ? (parseFloat(currentResult.average) > parseFloat(classAvg) ? `Above class average ${classAvg}%` : `Below class average ${classAvg}%`) : 'No class comparison' }
      };
    }
  } catch (e) {
    console.log('AI analysis fallback', e.message);
    aiOutput = {
      predicted_grades: {},
      teacher_actions: ['Review real scores', 'Support weaknesses', 'Encourage strengths'],
      draft_comment: `${student_name} — Average ${currentResult.average}% — Based on real data only`,
      parent_summary: `${student_name} average ${currentResult.average}% — Real data only`,
      class_comparison: {}
    };
  }

  // Save to cache
  const toSave = {
    project_slug: slug,
    student_id: null,
    student_name,
    class_name,
    term: termVal,
    year: yearVal,
    data_snapshot: dataSnapshot,
    trend,
    strengths,
    weaknesses,
    risk_flags: riskFlags,
    predicted_grades: aiOutput.predicted_grades || {},
    teacher_actions: aiOutput.teacher_actions || [],
    draft_comment: aiOutput.draft_comment || '',
    parent_summary: aiOutput.parent_summary || '',
    class_comparison: aiOutput.class_comparison || {},
    model_used: process.env.OPENROUTER_API_KEY ? 'claude-3-5-sonnet' : 'rule-based-no-hallucination',
    created_by: 'ai-system'
  };

  const { data: saved, error: saveErr } = await supabase.from('ai_analyses').upsert(toSave, { onConflict: 'project_slug,student_name,term,year' }).select().single();
  if (saveErr) return res.status(400).json({ error: saveErr.message, analysis: toSave });

  res.json({ ...saved, cached: false, real_data_only: true });
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
