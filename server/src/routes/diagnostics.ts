import { Router, Request, Response } from 'express';
import { getAdminClient, getAnonClient } from '../utils/supabase';
import { requireApiSecret } from '../utils/auth';

const router = Router();

router.get('/', requireApiSecret(), async (_req: Request, res: Response) => {
  try {
    const supa = getAdminClient();

    // Check sources
    const { data: sources, error: srcErr } = await supa
      .from('sources')
      .select('id, name, base_url')
      .order('name', { ascending: true })
      .limit(10);
    if (srcErr) throw srcErr;

    // Properties counts (admin)
    const { count: propsCount, error: propsCntErr } = await supa
      .from('properties')
      .select('*', { count: 'exact', head: true });
    if (propsCntErr) throw propsCntErr;

    const { count: propsPpsqmCount, error: propsPpsqmCntErr } = await supa
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .not('price_per_sqm', 'is', null as any);
    if (propsPpsqmCntErr) throw propsPpsqmCntErr;

    // Sample current_benchmarks
    const { data: currBench, error: currBenchErr } = await supa
      .from('current_benchmarks')
      .select('*')
      .limit(5);
    if (currBenchErr) throw currBenchErr;

    // Sample benchmarks (latest)
    const { data: histBench, error: histBenchErr } = await supa
      .from('benchmarks')
      .select('*')
      .order('computed_on', { ascending: false })
      .limit(5);
    if (histBenchErr) throw histBenchErr;

    res.json({
      status: 'ok',
      sources,
      counts: {
        properties_total: propsCount ?? 0,
        properties_with_ppsqm: propsPpsqmCount ?? 0,
        sample_curr_benchmarks: currBench?.length ?? 0,
        sample_hist_benchmarks: histBench?.length ?? 0,
      },
      samples: {
        current_benchmarks: currBench || [],
        latest_benchmarks: histBench || [],
      }
    });
  } catch (err: any) {
    console.error('[diagnostics] error', err);
    res.status(500).json({ error: err?.message || 'Diagnostics failed' });
  }
});

// Log a scheduled run (called by Netlify scheduler)
router.post('/schedule/log', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const supa = getAdminClient();
    const payload = {
      created_at: new Date().toISOString(),
      region: (req.body?.region as string) ?? null,
      adapter: (req.body?.adapter as string) ?? null,
      discovered: Number(req.body?.discovered ?? 0),
      inserted: Number(req.body?.inserted ?? 0),
      errors: Number(req.body?.errors ?? 0),
      raw: req.body?.raw ?? null,
    };
    const { data, error } = await supa.from('scheduled_runs').insert(payload).select('*').single();
    if (error) {
      // If table missing, return 200 with message so scheduler doesn't fail
      if (String(error.message || '').toLowerCase().includes('relation') && String(error.message).includes('does not exist')) {
        return res.json({ status: 'ok', note: 'scheduled_runs table missing', inserted: 0 });
      }
      throw error;
    }
    res.json({ status: 'ok', run: data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'schedule log failed' });
  }
});

// View last N scheduled runs
router.get('/schedule/last', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const supa = getAdminClient();
    const limit = Math.min(100, Math.max(1, Number((req.query?.limit as string) ?? 20)));
    const { data, error } = await supa
      .from('scheduled_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (String(error.message || '').toLowerCase().includes('relation') && String(error.message).includes('does not exist')) {
        return res.json({ status: 'ok', runs: [], note: 'scheduled_runs table missing' });
      }
      throw error;
    }
    res.json({ status: 'ok', runs: data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'schedule fetch failed' });
  }
});

// View last N scheduled runs with pagination
router.get('/schedule/last/paginated', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const supa = getAdminClient();
    const limit = Math.min(100, Math.max(1, Number((req.query?.limit as string) ?? 20)));
    const offset = Math.max(0, Number((req.query?.offset as string) ?? 0));
    const { data, error } = await supa
      .from('scheduled_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit);
    if (error) {
      if (String(error.message || '').toLowerCase().includes('relation') && String(error.message).includes('does not exist')) {
        return res.json({ status: 'ok', runs: [], note: 'scheduled_runs table missing' });
      }
      throw error;
    }
    res.json({ status: 'ok', runs: data });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'schedule fetch failed' });
  }
});

// Public diagnostics to test anon access to granted views
router.get('/public', async (_req: Request, res: Response) => {
  try {
    const supa = getAnonClient();
    const { count: searchCount, error: sErr } = await supa
      .from('v_search_results')
      .select('*', { count: 'exact', head: true });
    if (sErr) throw sErr;
    const { count: currCount, error: cErr } = await supa
      .from('current_benchmarks')
      .select('*', { count: 'exact', head: true });
    if (cErr) throw cErr;
    res.json({ status: 'ok', anon_counts: { v_search_results: searchCount ?? 0, current_benchmarks: currCount ?? 0 } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Public diagnostics failed' });
  }
});

export default router;
