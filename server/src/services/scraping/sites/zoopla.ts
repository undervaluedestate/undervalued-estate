import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
import type { ScrapeContext } from '../../../types';

function absUrl(href: string, base: string): string | null {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

function pickText($el: cheerio.Cheerio<any>): string | null {
  const t = $el.first().text().trim();
  return t || null;
}

export class ZooplaAdapter extends BaseAdapter {
  getMeta() { return { name: 'Zoopla' }; }

  async *discoverListingUrls(ctx: ScrapeContext): AsyncGenerator<string> {
    const base = ctx.source.base_url;
    const origin = new URL(base).origin;
    const seeds = (ctx.extra?.startUrls && Array.isArray(ctx.extra.startUrls) && ctx.extra.startUrls.length)
      ? ctx.extra.startUrls
      : [new URL('/for-sale/property/', base).toString()];
    const maxPages = Math.max(1, ctx.maxPages || 1);

    for (const seed of seeds) {
      // Cursor-based discovery: resume from last next_page for this seed
      let nextPage = 1;
      try {
        const { data: cur } = await (ctx.adminClient as any)
          .from('discovery_cursors')
          .select('next_page')
          .eq('seed_url', seed)
          .maybeSingle();
        if (cur && typeof cur.next_page === 'number' && cur.next_page > 0) nextPage = cur.next_page;
      } catch { /* ignore */ }

      const firstPage = nextPage;
      const lastPage = Math.min(4, Math.max(firstPage, firstPage + (maxPages - 1))); // cap to first 4 pages
      let yielded = 0;
      for (let page = firstPage; page <= lastPage; page++) {
        let listUrl = seed;
        try {
          const u = new URL(seed);
          if (!u.searchParams.get('pn')) u.searchParams.set('pn', String(page));
          else u.searchParams.set('pn', String(page));
          if (!u.searchParams.get('results_sort')) u.searchParams.set('results_sort', 'newest_listings');
          listUrl = u.toString();
        } catch {}
        ctx.log('List page', listUrl);
        const html = await ctx.http.getText(listUrl, ctx.requestTimeoutMs);
        const $ = cheerio.load(html);

        const candidates: string[] = [];
        // Common listing anchors
        $('a[href*="/for-sale/details/"]').each((_, a) => {
          const u = absUrl(String($(a).attr('href') || ''), listUrl);
          if (u && u.startsWith(origin)) candidates.push(u);
        });
        // Fallback: any anchor with /details/<id>
        $('a[href*="/details/"]').each((_, a) => {
          const u = absUrl(String($(a).attr('href') || ''), listUrl);
          if (u && /\/details\//.test(u) && u.startsWith(origin)) candidates.push(u);
        });
        // Regex from raw HTML
        try {
          const absRe = /https?:\/\/www\.zoopla\.co\.uk\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
          const relRe = /\b\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
          const absMatches = html.match(absRe) || [];
          const relMatches = (html.match(relRe) || []).map((m) => new URL(m, listUrl).toString());
          for (const u of [...absMatches, ...relMatches]) {
            try { const uu = new URL(u); if (uu.origin === origin) candidates.push(uu.toString()); } catch {}
          }
        } catch {}

        const unique = Array.from(new Set(candidates));
        for (const u of unique) { yielded++; yield u; }
        // If no listings found on this page, stop early to avoid scraping empty lists
        if (unique.length === 0) break;
      }
      // Update cursor to next page after processing this seed (wrap to 1 after page 4)
      const nextAfter = lastPage >= 4 ? 1 : (lastPage + 1);
      try {
        await (ctx.adminClient as any)
          .from('discovery_cursors')
          .upsert({ seed_url: seed, next_page: nextAfter, last_run_at: new Date().toISOString(), last_status: `yielded:${yielded}` }, { onConflict: 'seed_url' });
      } catch { /* ignore */ }
    }
  }

  async parseListing(ctx: ScrapeContext, html: string, url: string) {
    const $ = cheerio.load(html);
    const title = pickText($('h1')) || pickText($('meta[property="og:title"]')) || null;

    // Price
    let price: number | undefined = undefined;
    const priceText = pickText($('[data-testid="price"]'))
      || pickText($('[itemprop="price"]'))
      || $('meta[property="og:price:amount"]').attr('content')
      || (pickText($('.css-1xylxj1-Price')) as any);
    if (priceText) {
      const num = Number(String(priceText).match(/[0-9,.]+/g)?.[0]?.replace(/,/g, ''));
      if (Number.isFinite(num)) price = num;
    }
    let currency = 'GBP';
    if (/₦|NGN/i.test(String(priceText))) currency = 'NGN';
    if (/£|GBP/i.test(String(priceText))) currency = 'GBP';
    if (/€|EUR/i.test(String(priceText))) currency = 'EUR';

    // External ID from URL like /details/XXXXXXX
    let external_id: string = url;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/details\/(\d+)/i);
      if (m && m[1]) external_id = m[1];
    } catch {}

    // Address and dates from JSON-LD if present
    let address_line1: string | null = null;
    let address_line2: string | null = null;
    let postal_code: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let listed_at: string | null = null;
    let listing_updated_at: string | null = null;
    try {
      $('script[type="application/ld+json"]').each((_i, el) => {
        const txt = $(el).contents().text();
        if (!txt || txt.length < 5) return;
        try {
          const data = JSON.parse(txt);
          const walk = (node: any) => {
            if (!node) return;
            if (typeof node === 'object') {
              if (typeof node.datePublished === 'string' && !listed_at) listed_at = node.datePublished;
              if (typeof node.dateModified === 'string' && !listing_updated_at) listing_updated_at = node.dateModified;
              const addr = node.address && typeof node.address === 'object' ? node.address : (node['@type'] === 'PostalAddress' ? node : null);
              if (addr) {
                const street = addr.streetAddress || addr.address1 || addr.addressLine1 || null;
                const locality = addr.addressLocality || addr.locality || addr.city || null;
                const region = addr.addressRegion || addr.region || addr.state || null;
                const pc = addr.postalCode || addr.postcode || addr.zipCode || null;
                const parts = [street, locality, region].filter(Boolean).map((s: any) => String(s).trim());
                if (parts.length && !address_line1) address_line1 = parts.join(', ');
                if (!postal_code && pc) postal_code = String(pc);
              }
              if (node.geo && typeof node.geo === 'object') {
                const lat = Number(node.geo.latitude ?? node.geo.lat);
                const lng = Number(node.geo.longitude ?? node.geo.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) { latitude = lat; longitude = lng; }
              }
              Object.values(node).forEach(walk);
            }
          };
          walk(data);
        } catch {}
      });
    } catch {}

    // Address from visible selectors
    if (!address_line1) {
      const addrSel = pickText($('[data-testid="address-label"], .css-16jl9ur-Text, .css-10klw3m-Text, address, .property-address'));
      if (addrSel) address_line1 = addrSel.replace(/\s+/g, ' ').trim();
    }

    // City/State from breadcrumb
    let city: string | null = null; let state: string | null = null; let neighborhood: string | null = null;
    const crumbs = $('[class*="crumb" i] a, nav.breadcrumb a, .breadcrumbs a').map((_, a) => $(a).text().trim()).get().filter(Boolean);
    if (crumbs.length) {
      neighborhood = crumbs[crumbs.length - 1] || null;
      city = crumbs[crumbs.length - 2] || null;
      state = crumbs[crumbs.length - 3] || null;
    }

    // Country
    const country = 'United Kingdom';

    // Images: JSON-LD, OpenGraph, visible <img>/<source>
    let images: string[] = [];
    try {
      const seen = new Set<string>();
      const push = (s?: string | null) => {
        if (!s) return; const t = String(s).trim(); if (!t) return;
        if (/^data:image\//i.test(t)) return;
        if (/sprite|icon|logo|placeholder|avatar|thumbs?/i.test(t)) return;
        try { const abs = new URL(t, url).toString(); if (!seen.has(abs)) { seen.add(abs); images.push(abs); } } catch {}
      };
      $('script[type="application/ld+json"]').each((_i, el) => {
        const txt = $(el).contents().text();
        if (!txt || txt.length < 5) return;
        try {
          const data = JSON.parse(txt);
          const walk = (node: any) => {
            if (!node) return;
            if (Array.isArray(node)) { node.forEach(walk); return; }
            if (typeof node === 'object') {
              if (typeof (node as any).image === 'string') push((node as any).image);
              if (Array.isArray((node as any).image)) (node as any).image.forEach((v: any) => push(v));
              if ((node as any)['@type'] === 'ImageObject' && typeof (node as any).url === 'string') push((node as any).url);
              Object.values(node).forEach(walk);
            }
          };
          walk(data);
        } catch {}
      });
      push($('meta[property="og:image"]').attr('content') || null);
      $('img[src], img[data-src], source[srcset]').each((_i, el) => {
        const $el = $(el);
        const src = $el.attr('src') || $el.attr('data-src') || '';
        const srcset = $el.attr('srcset') || '';
        push(src);
        if (srcset) srcset.split(',').forEach(part => push(part.trim().split(' ')[0]));
      });
      if (images.length > 20) images = images.slice(0, 20);
    } catch {}

    return {
      external_id,
      url,
      title,
      description: $('meta[name="description"]').attr('content') || null,
      price,
      currency,
      images,
      address_line1,
      address_line2,
      neighborhood,
      city,
      state,
      postal_code,
      listing_type: 'buy',
      country,
      latitude,
      longitude,
      listed_at,
      listing_updated_at,
      is_active: true,
      raw: { source: 'Zoopla', url }
    };
  }
}
