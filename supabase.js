import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';
global.WebSocket = ws;
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or KEY');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: { WebSocket: ws }
});

// Helper: ensure tables exist (if not, we work with local fallback)
export async function testConnection() {
  try {
    const { data, error } = await supabase.from('projects').select('id').limit(1);
    if (error) {
      console.log('Supabase not yet initialized, using fallback. Error:', error.message);
      return { connected: false, error: error.message };
    }
    console.log('✅ Supabase connected, projects count check ok');
    return { connected: true };
  } catch (e) {
    console.log('Supabase connection failed:', e.message);
    return { connected: false, error: e.message };
  }
}
