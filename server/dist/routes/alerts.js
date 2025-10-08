import { Router } from 'express';
import { getAdminClient } from '../utils/supabase';
import { requireAuth, requireApiSecret } from '../utils/auth';
import { dispatchAlerts } from '../services/alerts/dispatch';
const router = Router();
router.get('/', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.id;
        const supa = getAdminClient();
        const { data, error } = await supa
            .from('alerts')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1000);
        if (error)
            throw error;
        res.json({ data: data || [] });
    }
    catch (err) {
        console.error('GET /api/alerts error', err);
        res.status(500).json({ error: err.message || 'Failed to fetch alerts' });
    }
});
router.post('/', requireAuth(), async (req, res) => {
    try {
        const userId = req.user.id;
        const body = (req.body || {});
        // Basic DTO validation
        const errors = [];
        if (!body.country)
            errors.push('country is required');
        if (!body.email)
            errors.push('email is required');
        const thr = Number(body.threshold_percent);
        if (!Number.isFinite(thr) || thr < 0 || thr > 95)
            errors.push('threshold_percent must be between 0 and 95');
        const minP = body.min_price != null ? Number(body.min_price) : null;
        const maxP = body.max_price != null ? Number(body.max_price) : null;
        if (minP != null && !Number.isFinite(minP))
            errors.push('min_price must be a number');
        if (maxP != null && !Number.isFinite(maxP))
            errors.push('max_price must be a number');
        const minS = body.min_size_sqm != null ? Number(body.min_size_sqm) : null;
        const maxS = body.max_size_sqm != null ? Number(body.max_size_sqm) : null;
        if (minS != null && !Number.isFinite(minS))
            errors.push('min_size_sqm must be a number');
        if (maxS != null && !Number.isFinite(maxS))
            errors.push('max_size_sqm must be a number');
        if (errors.length)
            return res.status(400).json({ error: 'Invalid request', details: errors });
        const insert = {
            user_id: userId,
            country: String(body.country),
            state: body.state || null,
            city: body.city || null,
            neighborhood: body.neighborhood || null,
            property_type: body.property_type || null,
            threshold_percent: thr,
            min_price: minP,
            max_price: maxP,
            min_size_sqm: minS,
            max_size_sqm: maxS,
            email: String(body.email),
            is_active: body.is_active != null ? !!body.is_active : true,
        };
        const supa = getAdminClient();
        const { data, error } = await supa.from('alerts').insert(insert).select('*').single();
        if (error)
            throw error;
        res.status(201).json({ data: data });
    }
    catch (err) {
        console.error('POST /api/alerts error', err);
        res.status(400).json({ error: err.message || 'Failed to create alert' });
    }
});
// Protected job endpoint (use x-api-secret or Bearer)
router.post('/dispatch', requireApiSecret(), async (req, res) => {
    try {
        const { maxPerAlert = 20 } = (req.body || {});
        const result = await dispatchAlerts({ maxPerAlert: Number(maxPerAlert) || 20 });
        res.json({ status: 'ok', ...result });
    }
    catch (err) {
        console.error('POST /api/alerts/dispatch error', err);
        res.status(500).json({ error: err.message || 'Dispatch failed' });
    }
});
export default router;
