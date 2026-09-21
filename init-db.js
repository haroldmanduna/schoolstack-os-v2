import { supabase } from './supabase.js';
import fs from 'fs';

const leadsPath = '/home/user/SchoolStack/beacon/leads/bulawayo_2026-09-21.json';

async function init() {
  console.log('Initializing SchoolStack Second Brain...');
  
  // Check connection
  const { data: existing } = await supabase.from('projects').select('id').limit(1);
  console.log('Supabase check:', existing ? 'connected' : 'needs schema.sql run in dashboard');

  // If projects table doesn't exist, user needs to run schema.sql manually in Supabase SQL editor
  // We'll try to seed anyway

  try {
    const raw = fs.readFileSync(leadsPath, 'utf8');
    const leads = JSON.parse(raw);
    console.log(`Found ${leads.length} leads to seed`);

    for (const lead of leads.slice(0, 50)) {
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
        notes: lead.notes
      };
      const { error } = await supabase.from('beacon_leads').upsert(payload, { onConflict: 'slug' });
      if (error) console.log(`Lead ${lead.school_name} insert error:`, error.message);
    }
    console.log('✅ Leads seeded');

    // Seed memories
    const memories = [
      { agent_name: 'nexus', memory_type: 'decision', title: 'Agency created', content: '13 agents created: Nexus, Beacon, Scout, Scholar, Blueprint, Canvas, Wordsmith, Forge, Core, Shield, Inspector, Launchpad, Caretaker. Both websites+portals. Blueprint recommends per project. Auto-build in safe draft.' },
      { agent_name: 'beacon', memory_type: 'observation', title: 'Bulawayo scan 51 schools', content: 'Scanned 51 schools in Bulawayo. 4 no_website_found, 5 website_no_portal, 42 needs_manual. Top opportunity Masiyephambili College score 9.' },
      { agent_name: 'blueprint', memory_type: 'decision', title: 'Stack for Lwazi Academy', content: 'Recommended Astro static for website phase, Next.js+Supabase for portal phase. Dual currency RTGS/USD. Cost <$30/mo. Host Cloudflare Pages.' },
      { agent_name: 'canvas', memory_type: 'learning', title: 'Design system Lwazi', content: 'Colors #0F172A slate-900, #F59E0B amber, #FFF7ED cream. Fonts Fraunces + Plus Jakarta Sans. Mobile-first for 3G parents.' },
      { agent_name: 'forge', memory_type: 'observation', title: 'Lwazi draft built', content: 'Built fantastic website draft at /projects/lwazi-academy/draft/index.html with hero, trust bar, academics, admissions, portal teaser, campus, news. Lighthouse 98.' }
    ];

    for (const m of memories) {
      await supabase.from('agent_memories').insert(m);
    }
    console.log('✅ Memories seeded');

  } catch (e) {
    console.error('Init error:', e.message);
    console.log('If tables missing, run schema.sql in Supabase SQL Editor: https://supabase.com/dashboard/project/hsckgramsgokjtvcymhv/sql');
  }
}

init();
