import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { getAdminClient } from '../../utils/supabase';
import { getText } from './http';
import { normalizeToProperty } from './normalize';
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

    for (const adapter of adapters) {
      const meta = adapter.getMeta();
      let source = sources?.find((s: any) => s.name === meta.name);
      if (!source) {
        // Attempt to auto-create source with a sane base_url if adapter is known
        const defaultBaseUrlMap: Record<string, string> = {
          'NigeriaPropertyCentre': 'https://nigeriapropertycentre.com/',
          'Properstar': 'https://www.properstar.co.uk/'
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
      totalDiscovered += urls.length;

      // Utility sleep
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // Fetch + parse + upsert with retry/backoff and optional polite delay for Properstar
      const tasks = urls.map((url) =>
        this.limit(async () => {
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
