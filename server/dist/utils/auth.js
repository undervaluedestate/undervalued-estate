import { createClient } from '@supabase/supabase-js';
let _authClient = null;
function getAuthClient() {
    if (_authClient)
        return _authClient;
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    if (!url)
        throw new Error('SUPABASE_URL is not set');
    if (!anon)
        throw new Error('SUPABASE_ANON_KEY is not set');
    _authClient = createClient(url, anon, {
        auth: { persistSession: false, detectSessionInUrl: false },
    });
    return _authClient;
}
export async function getUserFromRequest(req) {
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' ');
    if (!token)
        return null;
    const { data, error } = await getAuthClient().auth.getUser(token);
    if (error) {
        console.warn('Auth getUser error', error.message);
        return null;
    }
    return data?.user || null;
}
export function requireAuth() {
    return async (req, res, next) => {
        const user = await getUserFromRequest(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        req.user = user;
        next();
    };
}
export function checkApiSecret(req) {
    const header = req.headers['x-api-secret'] || '';
    const auth = req.headers['authorization'] || '';
    const fromHeader = String(header).trim();
    const fromBearer = auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : '';
    const provided = fromHeader || fromBearer;
    const expected = (process.env.API_SECRET || '').trim();
    return Boolean(provided) && Boolean(expected) && provided === expected;
}
export function requireApiSecret() {
    return (req, res, next) => {
        if (!checkApiSecret(req)) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
}
