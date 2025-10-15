import { getAdminClient } from '../utils/supabase';
export async function requireAuth(req, res, next) {
    try {
        const hdr = String(req.headers['authorization'] || '').trim();
        if (!hdr.toLowerCase().startsWith('bearer ')) {
            return res.status(401).json({ error: 'Missing bearer token' });
        }
        const token = hdr.slice(7).trim();
        if (!token)
            return res.status(401).json({ error: 'Invalid token' });
        const supa = getAdminClient();
        const { data: userRes, error: userErr } = await supa.auth.getUser(token);
        if (userErr || !userRes?.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = userRes.user;
        const { data: profile } = await supa.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
        req.auth = { user, profile };
        next();
    }
    catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
export async function maybeAuth(req, _res, next) {
    try {
        const hdr = String(req.headers['authorization'] || '').trim();
        if (!hdr.toLowerCase().startsWith('bearer '))
            return next();
        const token = hdr.slice(7).trim();
        if (!token)
            return next();
        const supa = getAdminClient();
        const { data: userRes } = await supa.auth.getUser(token);
        const user = userRes?.user;
        if (user) {
            const { data: profile } = await supa.from('profiles').select('*').eq('user_id', user.id).maybeSingle();
            req.auth = { user, profile };
        }
    }
    catch { }
    next();
}
