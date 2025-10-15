import { Router } from 'express';
import { getAdminClient } from '../utils/supabase';
import { requireAuth } from '../middleware/auth';
function parseAllowlist(val) {
    if (!val)
        return [];
    return String(val).split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
const router = Router();
// GET /api/auth/me - returns current user and profile; promotes admin if email in allowlist
router.get('/me', requireAuth, async (req, res) => {
    try {
        const supa = getAdminClient();
        const user = req.auth.user;
        const email = String(user.email || '').toLowerCase();
        const allow = new Set(parseAllowlist(process.env.ADMIN_EMAILS));
        // Ensure profile exists
        const { data: prof, error: profErr } = await supa
            .from('profiles')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
        let profile = prof;
        if (!profile) {
            const { data: ins, error: insErr } = await supa
                .from('profiles')
                .insert({ user_id: user.id, display_name: email || null })
                .select('*')
                .single();
            if (!insErr)
                profile = ins;
        }
        // Promote to admin if in allowlist
        if (email && allow.has(email) && profile?.role !== 'admin') {
            const { data: up } = await supa
                .from('profiles')
                .update({ role: 'admin' })
                .eq('user_id', user.id)
                .select('*')
                .single();
            if (up)
                profile = up;
        }
        res.json({ user, profile });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to load profile' });
    }
});
export default router;
