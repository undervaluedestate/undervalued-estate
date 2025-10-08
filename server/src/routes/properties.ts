import { Router, Request, Response } from 'express';
import { getAnonClient } from '../utils/supabase';
import type { SearchResultRow } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      q,
      country,
      state,
      city,
      neighborhood,
      property_type,
      min_price,
      max_price,
      min_size_sqm,
      max_size_sqm,
      min_pct_below, // positive number like 10 means <= -10%
      page = '1',
      per_page = '20',
      sort = 'pct_vs_market',
      order = 'asc',
    } = req.query as Record<string, string | undefined>;

    const supa = getAnonClient();
    let query = supa.from('v_search_results').select('*', { count: 'exact' });

    if (country) query = query.eq('country', country);
    if (state) query = query.eq('state', state);
    if (city) query = query.eq('city', city);
    if (neighborhood) query = query.eq('neighborhood', neighborhood);
    if (property_type) query = query.eq('property_type', property_type);

    if (min_price && !Number.isNaN(Number(min_price))) query = query.gte('price', Number(min_price));
    if (max_price && !Number.isNaN(Number(max_price))) query = query.lte('price', Number(max_price));
    if (min_size_sqm && !Number.isNaN(Number(min_size_sqm))) query = query.gte('size_sqm', Number(min_size_sqm));
    if (max_size_sqm && !Number.isNaN(Number(max_size_sqm))) query = query.lte('size_sqm', Number(max_size_sqm));

    if (min_pct_below) {
      query = query.lte('pct_vs_market', -Math.abs(Number(min_pct_below)));
    }

    if (q) {
      query = query.or(
        [
          `title.ilike.%${q}%`,
          `neighborhood.ilike.%${q}%`,
          `city.ilike.%${q}%`,
          `state.ilike.%${q}%`,
          `country.ilike.%${q}%`,
        ].join(',')
      );
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const perPageNum = Math.min(Math.max(1, Number(per_page) || 20), 100);
    const from = (pageNum - 1) * perPageNum;
    const to = from + perPageNum - 1;

    const allowedSort = new Set([
      'pct_vs_market', 'price', 'size_sqm', 'price_per_sqm', 'scraped_at'
    ]);
    const sortKey = allowedSort.has(String(sort)) ? String(sort) : 'pct_vs_market';
    const ord = String(order) === 'desc' ? false : true;
    query = query.order(sortKey as any, { ascending: ord, nullsFirst: true }).range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ data: (data as unknown as SearchResultRow[]) || [], count, page: pageNum, per_page: perPageNum });
  } catch (err: any) {
    console.error('GET /api/properties error', err);
    res.status(500).json({ error: err.message || 'Failed to fetch properties' });
  }
});

export default router;
