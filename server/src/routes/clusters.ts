import { Router, Request, Response } from 'express';
import { getAnonClient } from '../utils/supabase';

const router = Router();

// GET /api/clusters/city - list cluster rows from the property_clusters_city view
router.get('/city', async (req: Request, res: Response) => {
  try {
    const { country, state, city, property_type, currency, bedrooms, bathrooms } = req.query as Record<string, string | undefined>;
    const supa = getAnonClient();
    let q = supa.from('property_clusters_city').select('*');
    if (country) q = q.eq('country', country);
    if (state) q = q.eq('state', state);
    if (city) q = q.eq('city', city);
    if (property_type) q = q.eq('property_type', property_type);
    if (currency) q = q.eq('currency', currency);
    if (bedrooms && !Number.isNaN(Number(bedrooms))) q = q.eq('bedrooms', Number(bedrooms));
    if (bathrooms && !Number.isNaN(Number(bathrooms))) q = q.eq('bathrooms', Number(bathrooms));
    const { data, error } = await q.order('sample_count', { ascending: false }).limit(1000);
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch clusters' });
  }
});

export default router;
