import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _anonClient: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

function assertEnv() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  try {
    // Validate that SUPABASE_URL is a valid absolute URL (e.g. https://xxxxx.supabase.co)
    // This avoids cryptic errors like: 'The string did not match the expected pattern.'
    // which can be thrown deeper in the stack if an invalid URL is provided.
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`Invalid SUPABASE_URL: '${url}'. Expected a valid https URL like https://YOUR_PROJECT.supabase.co`);
  }
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
