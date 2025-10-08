import { Router, Request, Response } from 'express';
import { requireApiSecret } from '../utils/auth';
import { getAdminClient } from '../utils/supabase';
import { ScrapeEngine } from '../services/scraping/engine';
import { NigeriaPropertyCentreAdapter } from '../services/scraping/sites/nigeriaPropertyCentre';
import { ProperstarAdapter } from 'services/scraping/sites/properstar';
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
      adapters: [new NigeriaPropertyCentreAdapter(), new ProperstarAdapter()],
      concurrency: typeof body.concurrency === 'number' && body.concurrency > 0 ? Math.min(10, Math.max(1, Math.floor(body.concurrency))) : 6,
    });

    if (effectiveDryRun) {
      return res.json({ status: 'ok', adapters: engine.listAdapters(), note: 'dryRun=true, no network calls' });
    }

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

// Seed endpoint: parse & upsert specific listing URLs (debugging discovery)
router.post('/seed', requireApiSecret(), async (req: Request, res: Response) => {
  try {
    const { adapterName, urls } = (req.body || {}) as { adapterName?: string; urls?: string[] };
    if (!adapterName) return res.status(400).json({ error: 'adapterName is required' });
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls[] is required' });

    const adapters = [new NigeriaPropertyCentreAdapter(), new ProperstarAdapter()];
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
    for (const url of urls) {
      try {
        const html = await getText(url, 12000);
        const ctx: any = {
          http: { getText }, cheerio: undefined, log: (..._a: any[]) => {}, adminClient: supa,
          source, maxPages: 1, requestTimeoutMs: 12000
        };
        // parse -> normalize -> upsert
        const rawItem = await (adapter as any).parseListing(ctx, html, url);
        const payload = normalizeToProperty({ ...rawItem, source });
        const { error } = await supa.from('properties').upsert(payload, { onConflict: 'source_id,external_id', ignoreDuplicates: false });
        if (error) throw error;
        upserted++;
      } catch (e: any) {
        errors.push(`${url}: ${e.message || 'parse/upsert failed'}`);
      }
    }
    res.json({ status: 'ok', upserted, errors });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /api/scrape/seed error', err);
    res.status(500).json({ error: err.message || 'Seed failed' });
  }
});
