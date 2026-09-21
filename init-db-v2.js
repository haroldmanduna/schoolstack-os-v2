import { supabase } from './supabase.js';
import fs from 'fs';

const leadsPath = '/home/user/SchoolStack/beacon/leads/bulawayo_2026-09-21.json';

async function init() {
  console.log('🚀 Initializing SchoolStack Second Brain v2 with Supabase...');
  
  // Check connection
  const { data: projCheck, error: projErr } = await supabase.from('projects').select('id').limit(1);
  if (projErr) {
    console.log('Projects table error:', projErr.message);
    console.log('Make sure you ran supabase_complete.sql');
    return;
  }
  console.log('✅ Supabase connected, projects table exists');

  // Seed leads
  try {
    const raw = fs.readFileSync(leadsPath, 'utf8');
    const leads = JSON.parse(raw);
    console.log(`Found ${leads.length} leads to seed`);

    let success = 0;
    for (const lead of leads) {
      const slug = lead.school_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const payload = {
        school_name: lead.school_name,
        slug,
        type: lead.type,
        category: lead.category,
        location: lead.location,
        website_url: lead.website_url,
        website_status: lead.website_status,
        portal_url: lead.portal_url,
        portal_status: lead.portal_status,
        classification: lead.classification,
        confidence: lead.confidence,
        opportunity_score: lead.opportunity_score,
        evidence: lead.evidence,
        contact: lead.contact,
        enrichment: { notes: lead.notes || '', original_type: lead.type }
      };
      const { error } = await supabase.from('beacon_leads').upsert(payload, { onConflict: 'slug' });
      if (error) {
        console.log(`Lead ${lead.school_name} error:`, error.message);
      } else {
        success++;
      }
    }
    console.log(`✅ Leads seeded: ${success}/${leads.length}`);

    // Check counts
    const { count: leadCount } = await supabase.from('beacon_leads').select('*', { count: 'exact', head: true });
    const { count: memCount } = await supabase.from('agent_memories').select('*', { count: 'exact', head: true });
    const { count: skillCount } = await supabase.from('agent_skills').select('*', { count: 'exact', head: true });
    const { count: projCount } = await supabase.from('projects').select('*', { count: 'exact', head: true });

    console.log(`\n📊 DB Stats:`);
    console.log(`- Projects: ${projCount}`);
    console.log(`- Beacon leads: ${leadCount}`);
    console.log(`- Memories: ${memCount}`);
    console.log(`- Skills: ${skillCount}`);

    console.log('\n✅ Second brain fully initialized with Supabase persistent memory!');

  } catch (e) {
    console.error('Init error:', e.message, e.stack);
  }
}

init();
