import { Router } from 'express';
import { getAnonClient } from '../utils/supabase';
const router = Router();
router.get('/', async (req, res) => {
    try {
        const { country, state, city, neighborhood, property_type } = req.query;
        const supa = getAnonClient();
        let q = supa.from('current_benchmarks').select('*');
        if (country)
            q = q.eq('country', country);
        if (state)
            q = q.eq('state', state);
        if (city)
            q = q.eq('city', city);
        if (neighborhood)
            q = q.eq('neighborhood', neighborhood);
        if (property_type)
            q = q.eq('property_type', property_type);
        const { data, error } = await q.limit(500);
        if (error)
            throw error;
        res.json({ data: data || [] });
    }
    catch (err) {
        console.error('GET /api/benchmarks error', err);
        res.status(500).json({ error: err.message || 'Failed to fetch benchmarks' });
    }
});
export default router;
