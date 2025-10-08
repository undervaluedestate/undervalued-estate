import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _anonClient: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

function assertEnv() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!anon) console.warn('Missing SUPABASE_ANON_KEY (public selects may fail)');
  if (!service) console.warn('Missing SUPABASE_SERVICE_ROLE_KEY (server writes will fail)');
  return { url, anon, service };
}

export function getAnonClient(): SupabaseClient {
  if (_anonClient) return _anonClient;
  const { url, anon } = assertEnv();
  _anonClient = createClient(url!, anon!, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
  return _anonClient;
}

export function getAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const { url, service } = assertEnv();
  _adminClient = createClient(url!, service!, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
  return _adminClient;
}
