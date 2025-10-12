import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { getAdminClient } from '../../utils/supabase';
import { getText } from './http';
import { normalizeToProperty } from './normalize';
import { canonicalizeUrl } from './url';
import type { BaseAdapter, ScrapeContext } from '../../types';

interface RunOptions {
  adapterName?: string;
  maxPages?: number;
  maxUrls?: number;
  requestTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  extraStartUrls?: string[];
}

export class ScrapeEngine {
  private adapters: BaseAdapter[];
  private limit: ReturnType<typeof pLimit>;
  private concurrency: number = 5;

  constructor({ adapters = [], concurrency = 5 }: { adapters?: BaseAdapter[]; concurrency?: number } = {}) {
    this.adapters = adapters;
    if (typeof concurrency === 'number' && concurrency > 0) {
      this.concurrency = Math.min(10, Math.max(1, Math.floor(concurrency)));
      this.limit = pLimit(this.concurrency);
    } else {
      this.concurrency = 5;
      this.limit = pLimit(this.concurrency);
    }
  }

  listAdapters() {
    return this.adapters.map((a) => a.getMeta());
  }

  getAdapterByName(name?: string) {
    if (!name) return undefined;
    return this.adapters.find((a) => a.getMeta().name === name);
  }

  async run({ adapterName, maxPages = 1, maxUrls = 10, requestTimeoutMs = 12000, discoveryTimeoutMs = 5000, extraStartUrls = [], extraListingType, concurrency }: RunOptions & { extraListingType?: 'buy' | 'rent'; concurrency?: number } = {}) {
    const admin = getAdminClient();

    const adapters = adapterName ? [this.getAdapterByName(adapterName)].filter(Boolean) as BaseAdapter[] : this.adapters;
    if (!adapters.length) {
      return { inserted: 0, adapters: 0, errors: ['No adapters selected'], discovered: 0 };
    }

    const { data: sources, error: srcErr } = await admin.from('sources').select('*');
    if (srcErr) throw srcErr;

    let totalInserted = 0;
    let totalDiscovered = 0;
    const errors: string[] = [];

    // Determine per-run concurrency limiter
    const effectiveConcurrency = typeof concurrency === 'number' && concurrency > 0
      ? Math.min(10, Math.max(1, Math.floor(concurrency)))
      : this.concurrency;
    const runLimit = pLimit(effectiveConcurrency);

    for (const adapter of adapters) {
      const meta = adapter.getMeta();
      let source = sources?.find((s: any) => s.name === meta.name);
      if (!source) {
        // Attempt to auto-create source with a sane base_url if adapter is known
        const defaultBaseUrlMap: Record<string, string> = {
          'NigeriaPropertyCentre': 'https://nigeriapropertycentre.com/',
          'Properstar': 'https://www.properstar.co.uk/',
          'Zoopla': 'https://www.zoopla.co.uk/',
          'PrimeLocation': 'https://www.primelocation.com/'
        };
        const base_url = defaultBaseUrlMap[meta.name];
        if (!base_url) {
          errors.push(`Missing source row for adapter ${meta.name}`);
          continue;
        }
        const { data: inserted, error: insErr } = await admin
          .from('sources')
          .insert({ name: meta.name, base_url })
          .select('*')
          .single();
        if (insErr) {
          errors.push(`Failed to create source for ${meta.name}: ${insErr.message}`);
          continue;
        }
        source = inserted as any;
      }

      const ctx: ScrapeContext = {
        http: { getText },
        cheerio,
        log: (...args: any[]) => console.log(`[${meta.name}]`, ...args),
        adminClient: admin,
        source,
        maxPages,
        requestTimeoutMs,
        extra: { startUrls: Array.isArray(extraStartUrls) ? extraStartUrls : [], listingType: extraListingType },
      };

      // Discover URLs (timeboxed, capped)
      const urls: string[] = [];
      try {
        const startedAt = Date.now();
        for await (const url of adapter.discoverListingUrls(ctx)) {
          urls.push(url);
          if (urls.length >= maxUrls) break;
          if (Date.now() - startedAt > discoveryTimeoutMs) {
            errors.push(`discover timeout for ${meta.name} after ${discoveryTimeoutMs}ms`);
            break;
          }
        }
      } catch (e: any) {
        errors.push(`discover failed for ${meta.name}: ${e.message}`);
        continue;
      }
      // Deduplicate discovered URLs by canonical form to avoid redundant fetches
      const canonicalToUrl = new Map<string, string>();
      for (const u of urls) {
        try {
          const c = canonicalizeUrl(u);
          if (!canonicalToUrl.has(c)) canonicalToUrl.set(c, u);
        } catch {
          if (!canonicalToUrl.has(u)) canonicalToUrl.set(u, u);
        }
      }
      let uniqueUrls = Array.from(canonicalToUrl.values());
      totalDiscovered += uniqueUrls.length;

      // Pre-check: derive external_id from URL and skip recently seen listings (stop-on-known optimization)
      try {
        const deriveId = (u: string): string | null => {
          try {
            const pu = new URL(u);
            if (meta.name === 'NigeriaPropertyCentre') {
              const segs = pu.pathname.split('/').filter(Boolean);
              return segs[segs.length - 1] || null;
            }
            if (meta.name === 'Properstar') {
              const m = pu.pathname.match(/\/listing\/([A-Za-z0-9_-]+)/i);
              return m && m[1] ? m[1] : null;
            }
          } catch { /* ignore */ }
          return null;
        };
        const ids: string[] = [];
        const idToUrl = new Map<string, string>();
        for (const u of uniqueUrls) {
          const id = deriveId(u);
          if (id) { ids.push(id); idToUrl.set(id, u); }
        }
        if (ids.length) {
          const CHUNK = 200;
          const now = Date.now();
          const keepUrls = new Set<string>();
          for (let i = 0; i < ids.length; i += CHUNK) {
            const slice = ids.slice(i, i + CHUNK);
            const { data, error } = await admin.from('properties')
              .select('external_id,last_seen_at')
              .eq('source_id', (source as any).id)
              .in('external_id', slice);
            if (error) continue;
            const recent = new Set<string>();
            for (const row of data || []) {
              const ls = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
              if (ls && (now - ls) < 12 * 60 * 60 * 1000) { // 12h freshness window
                recent.add(row.external_id);
              }
            }
            for (const eid of slice) {
              if (!recent.has(eid)) {
                const u = idToUrl.get(eid);
                if (u) keepUrls.add(u);
              }
            }
          }
          // If no DB rows found (all new), keep original; otherwise filter to keepUrls
          if (keepUrls.size > 0) uniqueUrls = uniqueUrls.filter((u) => keepUrls.has(u));
        }
      } catch { /* best-effort */ }

      // Utility sleep
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // Fetch + parse + upsert with retry/backoff and optional polite delay for Properstar
      const tasks = uniqueUrls.map((url) =>
        runLimit(async () => {
          // Insert a small delay for Properstar to reduce rate-limits
          if (meta.name === 'Properstar') {
            await sleep(250 + Math.floor(Math.random() * 150)); // 250–400ms
          }
          const maxAttempts = 3; // initial + 2 retries
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              ctx.log('Fetching', url, `(attempt ${attempt})`);
              const html = await getText(url, requestTimeoutMs);
              const rawItem = await adapter.parseListing(ctx, html, url);
              if (!rawItem || !rawItem.external_id) return 0;
              const payload: any = normalizeToProperty({ ...rawItem, source });
              if (ctx.extra?.listingType) payload.listing_type = ctx.extra.listingType;
              // Always bump scraped_at on successful fetch so updates are visible downstream
              payload.scraped_at = new Date().toISOString();
              // Track last seen; allow DB default to set first_seen_at only on brand-new inserts
              payload.last_seen_at = payload.scraped_at;
              if (payload.first_seen_at == null) delete payload.first_seen_at;
              const { error } = await admin.from('properties').upsert(payload, {
                onConflict: 'source_id,external_id',
                ignoreDuplicates: false,
              });
              if (error) throw error;
              return 1;
            } catch (e: any) {
              const status = e?.response?.status;
              const isTimeout = /timeout/i.test(String(e?.message || '')) || e?.code === 'ECONNABORTED';
              const isRateLimit = status === 429;
              const canRetry = isTimeout || isRateLimit;
              if (attempt < maxAttempts && canRetry) {
                const backoff = attempt * 1000; // 1s then 2s
                await sleep(backoff);
                continue;
              }
              errors.push(`parse/upsert failed for ${meta.name}: ${e?.message || 'unknown error'}`);
              return 0;
            }
          }
          return 0;
        })
      );

      const results = await Promise.all(tasks);
      const batchInserted = results.reduce((a: number, b: number) => a + b, 0);
      totalInserted += batchInserted;
    }

    return { inserted: totalInserted, adapters: adapters.length, discovered: totalDiscovered, errors };
  }
}
