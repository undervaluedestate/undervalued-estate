import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

let _authClient: SupabaseClient | null = null;
function getAuthClient(): SupabaseClient {
  if (_authClient) return _authClient;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url) throw new Error('SUPABASE_URL is not set');
  if (!anon) throw new Error('SUPABASE_ANON_KEY is not set');
  _authClient = createClient(url, anon, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
  return _authClient;
}

export async function getUserFromRequest(req: Request) {
  const auth = req.headers.authorization || '';
  const [, token] = auth.split(' ');
  if (!token) return null;
  const { data, error } = await getAuthClient().auth.getUser(token);
  if (error) {
    console.warn('Auth getUser error', error.message);
    return null;
  }
  return data?.user || null;
}

export function requireAuth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    (req as any).user = user;
    next();
  };
}

export function checkApiSecret(req: Request) {
  const header = (req.headers['x-api-secret'] as string) || '';
  const auth = (req.headers['authorization'] as string) || '';
  const fromHeader = String(header).trim();
  const fromBearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  const provided = fromHeader || fromBearer;
  const expected = (process.env.API_SECRET || '').trim();
  return Boolean(provided) && Boolean(expected) && provided === expected;
}

export function requireApiSecret() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!checkApiSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}
