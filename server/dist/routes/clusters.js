import { Router } from 'express';
import { getAnonClient } from '../utils/supabase';
const router = Router();
function computePercentile(sorted, p) {
    if (!sorted.length)
        return null;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi)
        return sorted[lo];
    const h = idx - lo;
    return sorted[lo] * (1 - h) + sorted[hi] * h;
}
// GET /api/clusters/city - compute cluster rows by aggregating v_search_results
router.get('/city', async (req, res) => {
    try {
        const { country, state, city, property_type, currency, bedrooms, bathrooms } = req.query;
        if (!city) {
            return res.status(400).json({ error: 'city is required for cluster aggregation' });
        }
        const supa = getAnonClient();
        let q = supa.from('v_search_results')
            .select('id,country,state,city,property_type,currency,bedrooms,bathrooms,price,price_per_sqm')
            .eq('listing_type', 'buy')
            .eq('city', city)
            .limit(2000);
        if (country)
            q = q.eq('country', country);
        if (state)
            q = q.eq('state', state);
        if (property_type)
            q = q.eq('property_type', property_type);
        if (currency)
            q = q.eq('currency', currency);
        if (bedrooms && !Number.isNaN(Number(bedrooms)))
            q = q.eq('bedrooms', Number(bedrooms));
        if (bathrooms && !Number.isNaN(Number(bathrooms)))
            q = q.eq('bathrooms', Number(bathrooms));
        const { data, error } = await q;
        if (error)
            throw error;
        const rows = (data || []);
        // Group by: country,state,city,property_type,currency,bedrooms,bathrooms
        const groups = new Map();
        for (const r of rows) {
            const key = [r.country, r.state, r.city, r.property_type, r.currency, r.bedrooms ?? '', r.bathrooms ?? ''].join('|');
            const arr = groups.get(key) || [];
            arr.push(r);
            groups.set(key, arr);
        }
        const out = Array.from(groups.entries()).map(([key, arr]) => {
            const sample_count = arr.length;
            const prices = arr.map(a => a.price).filter((n) => typeof n === 'number').sort((a, b) => a - b);
            const ppsqm = arr.map(a => a.price_per_sqm).filter((n) => typeof n === 'number');
            const [countryV, stateV, cityV, property_typeV, currencyV, bedroomsV, bathroomsV] = key.split('|');
            return {
                country: countryV || null,
                state: stateV || null,
                city: cityV || null,
                property_type: property_typeV,
                currency: currencyV,
                bedrooms: bedroomsV === '' ? null : Number(bedroomsV),
                bathrooms: bathroomsV === '' ? null : Number(bathroomsV),
                cluster_key_city: `${cityV}:${property_typeV}:${currencyV}:${bedroomsV}:${bathroomsV}`,
                sample_count,
                min_price: prices.length ? prices[0] : null,
                median_price: computePercentile(prices, 0.5),
                max_price: prices.length ? prices[prices.length - 1] : null,
                avg_ppsqm: ppsqm.length ? (ppsqm.reduce((a, b) => a + b, 0) / ppsqm.length) : null,
                representative_id: arr[Math.floor(arr.length / 2)]?.id ?? null,
            };
        }).sort((a, b) => (b.sample_count || 0) - (a.sample_count || 0));
        res.json({ data: out });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to compute clusters' });
    }
});
// GET /api/clusters/city/detail - stats + listings for a given cluster
router.get('/city/detail', async (req, res) => {
    try {
        const { country, state, city, property_type, currency, bedrooms, bathrooms, page = '1', per_page = '24', sort = 'price', order = 'asc' } = req.query;
        if (!city || !property_type) {
            return res.status(400).json({ error: 'city and property_type are required' });
        }
        const supa = getAnonClient();
        let q = supa.from('v_search_results')
            .select('*', { count: 'exact' })
            .eq('listing_type', 'buy')
            .eq('city', city)
            .eq('property_type', property_type);
        if (country)
            q = q.eq('country', country);
        if (state)
            q = q.eq('state', state);
        if (currency)
            q = q.eq('currency', currency);
        if (bedrooms && !Number.isNaN(Number(bedrooms)))
            q = q.eq('bedrooms', Number(bedrooms));
        if (bathrooms && !Number.isNaN(Number(bathrooms)))
            q = q.eq('bathrooms', Number(bathrooms));
        const pageNum = Math.max(1, parseInt(page || '1', 10));
        const perPageNum = Math.min(100, Math.max(1, parseInt(per_page || '24', 10)));
        const from = (pageNum - 1) * perPageNum;
        const to = from + perPageNum - 1;
        const sortField = ['price', 'price_per_sqm', 'scraped_at'].includes((sort || '').toLowerCase()) ? sort : 'price';
        const asc = (order || 'asc').toLowerCase() !== 'desc';
        q = q.order(sortField, { ascending: asc }).range(from, to);
        const { data, error, count } = await q;
        if (error)
            throw error;
        const items = data || [];
        const prices = items.map((a) => a.price).filter((n) => typeof n === 'number').sort((a, b) => a - b);
        const ppsqm = items.map((a) => a.price_per_sqm).filter((n) => typeof n === 'number');
        const stats = {
            sample_count: count || items.length,
            min_price: prices.length ? prices[0] : null,
            median_price: computePercentile(prices, 0.5),
            max_price: prices.length ? prices[prices.length - 1] : null,
            avg_ppsqm: ppsqm.length ? (ppsqm.reduce((a, b) => a + b, 0) / ppsqm.length) : null,
        };
        res.json({ stats, data: items, count: count ?? items.length });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to fetch cluster detail' });
    }
});
// GET /api/clusters/cities - fetch distinct city options for dropdown
router.get('/cities', async (req, res) => {
    try {
        const { country } = req.query;
        const supa = getAnonClient();
        // Pull a reasonable sample and dedupe client-side for compatibility
        let q = supa.from('v_search_results')
            .select('city,country')
            .eq('listing_type', 'buy')
            .not('city', 'is', null);
        if (country)
            q = q.eq('country', country);
        const { data, error } = await q.limit(5000);
        if (error)
            throw error;
        const seen = new Map();
        for (const r of (data || [])) {
            const c = r.city;
            if (!c)
                continue;
            seen.set(c, (seen.get(c) || 0) + 1);
        }
        const list = Array.from(seen.entries()).map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        res.json({ data: list });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Failed to fetch cities' });
    }
});
export default router;
