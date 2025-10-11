import { Router, Request, Response } from 'express';
import { requireApiSecret } from '../utils/auth';
import { getAdminClient } from '../utils/supabase';
import { ScrapeEngine } from '../services/scraping/engine';
import { NigeriaPropertyCentreAdapter } from '../services/scraping/sites/nigeriaPropertyCentre';
import { ProperstarAdapter } from '../services/scraping/sites/properstar';
import { ZooplaAdapter } from '../services/scraping/sites/zoopla';
import { getText } from '../services/scraping/http';
import { normalizeToProperty } from '../services/scraping/normalize';

const router = Router();

// Quick auth + fast response
router.get('/ping', requireApiSecret(), (_req: Request, res: Response) => {
  res.json({ status: 'ok', t: new Date().toISOString() });
});

type ScrapeRunDTO = {
  adapterName?: string;
  maxPages?: number;
  maxUrls?: number;
  requestTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  dryRun?: boolean;
  startUrls?: string[];
  concurrency?: number;
  regions?: Array<string | { name?: string; paths?: string[]; startUrls?: string[] }>;
  regionConcurrency?: number;
};

router.post('/run', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    // eslint-disable-next-line no-console
    console.log('[scrape/run] received', { headers: Object.keys(req.headers).length });
    const body = (req.body || {}) as ScrapeRunDTO;
    const errors: string[] = [];
    const adapterName = body.adapterName;
    const maxPagesRaw = body.maxPages ?? 1;
    const maxUrlsRaw = body.maxUrls ?? 5;
    const reqTimeoutRaw = body.requestTimeoutMs ?? 8000;
    const discTimeoutRaw = body.discoveryTimeoutMs ?? 5000;
    const dryRun = !!body.dryRun;

    const maxPages = Math.max(1, Math.min(10, Number(maxPagesRaw)));
    if (!Number.isFinite(maxPages)) errors.push('maxPages must be a number');
    const maxUrls = Math.max(1, Math.min(50, Number(maxUrlsRaw)));
    if (!Number.isFinite(maxUrls)) errors.push('maxUrls must be a number');
    const requestTimeoutMs = Math.max(1000, Math.min(30000, Number(reqTimeoutRaw)));
    if (!Number.isFinite(requestTimeoutMs)) errors.push('requestTimeoutMs must be a number');
    const discoveryTimeoutMs = Math.max(1000, Math.min(20000, Number(discTimeoutRaw)));
    if (!Number.isFinite(discoveryTimeoutMs)) errors.push('discoveryTimeoutMs must be a number');
    if (errors.length) return res.status(400).json({ error: 'Invalid request', details: errors });

    const effectiveDryRun = (String((req.query as any).dryRun || '').toLowerCase() === 'true') || Boolean(dryRun);
    const engine = new ScrapeEngine({
      adapters: [new NigeriaPropertyCentreAdapter(), new ProperstarAdapter(), new ZooplaAdapter()],
      concurrency: typeof body.concurrency === 'number' && body.concurrency > 0 ? Math.min(10, Math.max(1, Math.floor(body.concurrency))) : 6,
    });

    if (effectiveDryRun) {
      return res.json({ status: 'ok', adapters: engine.listAdapters(), note: 'dryRun=true, no network calls' });
    }

    // If regions are provided, fan out runs per region with bounded parallelism
    const regions = Array.isArray(body.regions) ? body.regions : [];
    if (regions.length > 0) {
      if (!adapterName) return res.status(400).json({ error: 'adapterName is required when using regions[]' });
      // Determine base_url for adapter to prefix region paths when needed
      const defaultBaseUrlMap: Record<string, string> = {
        'NigeriaPropertyCentre': 'https://nigeriapropertycentre.com/',
        'Properstar': 'https://www.properstar.co.uk/'
      };
      const base_url = defaultBaseUrlMap[adapterName] || defaultBaseUrlMap['NigeriaPropertyCentre'];
      const toAbsolute = (u: string) => {
        try { return new URL(u).toString(); } catch { return new URL(u.replace(/^\/*/, '/'), base_url).toString(); }
      };
      const pLimit = (await import('p-limit')).default as any;
      const limit = pLimit(Math.min(10, Math.max(1, Number(body.regionConcurrency) || 5)));
      const supa = getAdminClient();
      const perRegionTasks = regions.map((r, idx) => limit(async () => {
        const name = typeof r === 'string' ? r : (r.name || `region_${idx+1}`);
        const lock_key = `${adapterName}:${name}`;
        const owner = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const lockForMs = 5 * 60 * 1000; // 5 minutes: reduce contention
        // Per-adapter freshness pacing (skip if region updated recently)
        const freshnessWindowMs = (
          adapterName === 'Zoopla' ? 15 * 60 * 1000 :
          adapterName === 'Properstar' ? 12 * 60 * 1000 :
          10 * 60 * 1000
        );
        // Freshness guard: if region was updated very recently, skip without locking
        try {
          const { data: fresh } = await supa
            .from('crawl_state')
            .select('updated_at')
            .eq('adapter_name', adapterName)
            .eq('region', name)
            .maybeSingle();
          if (fresh?.updated_at) {
            const ut = new Date(fresh.updated_at).getTime();
            if (Date.now() - ut < freshnessWindowMs) {
              return { name, skipped: true, reason: 'fresh' } as any;
            }
          }
        } catch { /* ignore */ }
        // Try to acquire lock atomically via RPC (only succeeds if expired or new)
        try {
          const ttlSeconds = Math.floor(lockForMs / 1000);
          const { data: acquired, error: lockErr } = await supa.rpc('acquire_run_lock', {
            p_lock_key: lock_key,
            p_owner: owner,
            p_ttl_seconds: ttlSeconds,
          });
          if (lockErr) {
            return { name, skipped: true, reason: 'locked' } as any;
          }
          if (!acquired) {
            return { name, skipped: true, reason: 'locked' } as any;
          }
        } catch {
          // non-fatal; proceed without lock
        }
        const startUrls: string[] = Array.isArray((r as any).startUrls) && (r as any).startUrls!.length
          ? (r as any).startUrls!
          : (Array.isArray((r as any).paths) && (r as any).paths!.length ? (r as any).paths! : [String(r)]);
        const absStartUrls = startUrls.map(toAbsolute);
        // Read current crawl_state target_max_pages if any
        let regionMaxPages = maxPages;
        try {
          const { data: cs } = await supa
            .from('crawl_state')
            .select('target_max_pages, low_yield_streak')
            .eq('adapter_name', adapterName)
            .eq('region', name)
            .maybeSingle();
          if (cs && typeof cs.target_max_pages === 'number' && cs.target_max_pages > 0) {
            regionMaxPages = Math.min(10, Math.max(1, cs.target_max_pages));
          }
        } catch { /* ignore */ }
        let regionResult;
        try {
          regionResult = await engine.run({
            adapterName,
            maxPages: regionMaxPages,
            maxUrls,
            requestTimeoutMs,
            discoveryTimeoutMs,
            extraStartUrls: absStartUrls,
            extraListingType: (body as any).listingType as 'buy' | 'rent' | undefined,
            concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
          });
        } finally {
          // Release lock only if we own it
          try { await supa.rpc('release_run_lock', { p_lock_key: lock_key, p_owner: owner }); } catch { /* ignore */ }
        }
        // Heuristic tuning of target_max_pages based on yield
        try {
          const inserted = Number(regionResult.inserted || 0);
          const discovered = Number(regionResult.discovered || 0);
          // Fetch current state to get streak
          const { data: cur } = await supa
            .from('crawl_state')
            .select('target_max_pages, low_yield_streak')
            .eq('adapter_name', adapterName)
            .eq('region', name)
            .maybeSingle();
          let target = regionMaxPages;
          let streak = Number(cur?.low_yield_streak || 0);
          if (inserted > 0) {
            streak = 0;
          } else {
            streak = Math.min(10, streak + 1);
          }
          // Increase when high yield; decrease when repeated zero-yield
          if (inserted >= 10 || discovered >= regionMaxPages * 20) {
            target = Math.min(5, target + 1);
          } else if (inserted === 0 && streak >= 2) {
            target = Math.max(1, target - 1);
          }
          await supa
            .from('crawl_state')
            .upsert({
              adapter_name: adapterName,
              region: name,
              target_max_pages: target,
              last_discovered: discovered,
              last_inserted: inserted,
              low_yield_streak: streak,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'adapter_name,region' });
        } catch { /* ignore */ }
        return { name, requestedMaxPages: regionMaxPages, ...regionResult };
      }));
      if (respondQuick) {
        // Fire-and-forget to avoid upstream 524 timeouts
        (async () => {
          try {
            const regionResults = await Promise.all(perRegionTasks);
            const inserted = regionResults.reduce((s, r) => s + (r.inserted || 0), 0);
            const discovered = regionResults.reduce((s, r) => s + (r.discovered || 0), 0);
            const errorsAgg = regionResults.flatMap(r => (r.errors || []).map((e: string) => `${r.name}: ${e}`));
            // eslint-disable-next-line no-console
            console.log('[scrape.run][bg] done', { adapterName, inserted, discovered, errors: errorsAgg.slice(0, 5) });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[scrape.run][bg] failed', e);
          }
        })();
        return res.status(202).json({ status: 'accepted', queued: true, adapter: adapterName });
      } else {
        const regionResults = await Promise.all(perRegionTasks);
        const inserted = regionResults.reduce((s, r) => s + (r.inserted || 0), 0);
        const discovered = regionResults.reduce((s, r) => s + (r.discovered || 0), 0);
        const errorsAgg = regionResults.flatMap(r => (r.errors || []).map((e: string) => `${r.name}: ${e}`));
        return res.json({ status: 'ok', inserted, discovered, regions: regionResults, errors: errorsAgg, adapters: engine.listAdapters() });
      }
    }

    // Single-run path (no regions[] provided)
    if (respondQuick) {
      (async () => {
        try {
          const results = await engine.run({
            adapterName,
            maxPages,
            maxUrls,
            requestTimeoutMs,
            discoveryTimeoutMs,
            extraStartUrls: Array.isArray(body.startUrls) ? body.startUrls : [],
            extraListingType: (body as any).listingType as 'buy' | 'rent' | undefined,
            concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
          });
          // eslint-disable-next-line no-console
          console.log('[scrape.run][bg-single] done', { adapterName, inserted: results.inserted, discovered: results.discovered });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[scrape.run][bg-single] failed', e);
        }
      })();
      return res.status(202).json({ status: 'accepted', queued: true, adapter: adapterName });
    } else {
      const results = await engine.run({
        adapterName,
        maxPages,
        maxUrls,
        requestTimeoutMs,
        discoveryTimeoutMs,
        extraStartUrls: Array.isArray(body.startUrls) ? body.startUrls : [],
        extraListingType: (body as any).listingType as 'buy' | 'rent' | undefined,
        concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
      });
      res.json({ status: 'ok', ...results, adapters: engine.listAdapters() });
    }
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /api/scrape/run error', err);
    res.status(500).json({ error: err.message || 'Scrape failed' });
  }
});

router.post('/benchmarks/refresh', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const { country, state, city, neighborhood, property_type } = (req.body || {}) as any;
    const supa = getAdminClient();
    const { error } = await supa.rpc('refresh_benchmarks', {
      target_country: country || null,
      target_state: state || null,
      target_city: city || null,
      target_neighborhood: neighborhood || null,
      target_property_type: property_type || null,
    });
    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /api/scrape/benchmarks/refresh error', err);
    res.status(500).json({ error: err.message || 'Refresh failed' });
  }
});

export default router;

router.post('/seed', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const { adapterName, urls, respondQuick } = (req.body || {}) as { adapterName?: string; urls?: string[]; respondQuick?: boolean };
    if (!adapterName) return res.status(400).json({ error: 'adapterName is required' });
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls[] is required' });

    const adapters = [new NigeriaPropertyCentreAdapter(), new ProperstarAdapter(), new ZooplaAdapter()];
    const adapter = adapters.find(a => a.getMeta().name === adapterName);
    if (!adapter) return res.status(400).json({ error: `Unknown adapter ${adapterName}` });

    const supa = getAdminClient();
    // Ensure source exists
    const defaultBaseUrlMap: Record<string, string> = {
      'NigeriaPropertyCentre': 'https://nigeriapropertycentre.com/',
      'Properstar': 'https://www.properstar.co.uk/'
    };
    const base_url = defaultBaseUrlMap[adapterName];
    if (!base_url) return res.status(400).json({ error: `No base_url mapping for adapter ${adapterName}` });
    let { data: srcList, error: srcErr } = await supa.from('sources').select('*').eq('name', adapterName).limit(1);
    if (srcErr) throw srcErr;
    let source = srcList?.[0];
    if (!source) {
      const ins = await supa.from('sources').insert({ name: adapterName, base_url }).select('*').single();
      if (ins.error) throw ins.error;
      source = ins.data;
    }

    let upserted = 0;
    const errors: string[] = [];
    const results: Array<{
      url: string;
      external_id: string;
      address_line1: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
      listed_at: string | null;
      listing_updated_at: string | null;
      price: number;
      currency: string;
      property_type: any;
    }> = [];
    for (const url of urls) {
      try {
        const html = await getText(url, 12000);
        const ctx: any = {
          http: { getText }, cheerio: undefined, log: (..._a: any[]) => {}, adminClient: supa,
          source, maxPages: 1, requestTimeoutMs: 12000
        };
        // parse -> normalize -> upsert
        const rawItem = await (adapter as any).parseListing(ctx, html, url);
        const payload: any = normalizeToProperty({ ...rawItem, source });
        // Mirror engine behavior: always bump scraped_at/last_seen_at; let DB set first_seen_at on new inserts
        payload.scraped_at = new Date().toISOString();
        payload.last_seen_at = payload.scraped_at;
        if (payload.first_seen_at == null) delete payload.first_seen_at;
        const { error } = await supa.from('properties').upsert(payload, { onConflict: 'source_id,external_id', ignoreDuplicates: false });
        if (error) throw error;
        results.push({
          url,
          external_id: payload.external_id,
          address_line1: payload.address_line1,
          neighborhood: payload.neighborhood,
          city: payload.city,
          state: payload.state,
          listed_at: payload.listed_at,
          listing_updated_at: payload.listing_updated_at,
          price: payload.price,
          currency: payload.currency,
          property_type: payload.property_type,
        });
        upserted++;
      } catch (e: any) {
        errors.push(`${url}: ${e.message || 'parse/upsert failed'}`);
      }
    }
    res.json({ status: 'ok', upserted, results, errors });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /api/scrape/seed error', err);
    res.status(500).json({ error: err.message || 'Seed failed' });
  }
});
