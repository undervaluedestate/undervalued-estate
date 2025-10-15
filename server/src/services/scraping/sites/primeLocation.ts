import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
import type { ScrapeContext, PropertyType } from '../../../types';

function absUrl(href: string, base: string): string | null {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

function pickText($el: cheerio.Cheerio<any>): string | null {
  const t = $el.first().text().trim();
  return t || null;
}

export class PrimeLocationAdapter extends BaseAdapter {
  getMeta() { return { name: 'PrimeLocation' }; }

  async *discoverListingUrls(ctx: ScrapeContext): AsyncGenerator<string> {
    const base = ctx.source.base_url; // e.g. https://www.primelocation.com/
    const origin = new URL(base).origin;
    const seeds = (ctx.extra?.startUrls && Array.isArray(ctx.extra.startUrls) && ctx.extra.startUrls.length)
      ? ctx.extra.startUrls
      : [new URL('/for-sale/property/', base).toString()];
    const maxPages = Math.max(1, ctx.maxPages || 1);

    // If listingType requested, try to reflect it in seeds by path replacement
    const seedsEff = seeds.map((seed) => {
      if (ctx.extra?.listingType === 'rent') {
        try {
          const u = new URL(seed);
          u.pathname = u.pathname.replace('/for-sale/', '/to-rent/');
          if (u.searchParams.get('search_source')) {
            u.searchParams.set('search_source', 'to-rent');
          }
          return u.toString();
        } catch { /* ignore */ }
      }
      return seed;
    });

    for (const seed of seedsEff) {
      // Cursor-based discovery per seed
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
          // PrimeLocation uses pn or page depending on context; preserve pn if present else set pn
          if (!u.searchParams.get('pn')) u.searchParams.set('pn', String(page));
          else u.searchParams.set('pn', String(page));
          // Prefer newest listings if not already specified
          if (!u.searchParams.get('results_sort')) u.searchParams.set('results_sort', 'newest_listings');
          // Add explicit search_source for WAF heuristics
          const src = ctx.extra?.listingType === 'rent' ? 'to-rent' : 'for-sale';
          if (!u.searchParams.get('search_source')) u.searchParams.set('search_source', src);
          listUrl = u.toString();
        } catch {}

        ctx.log('List page', listUrl);
        const html = await ctx.http.getText(listUrl, ctx.requestTimeoutMs);
        const $ = cheerio.load(html);

        const candidates: string[] = [];
        // Listing anchors typically contain /for-sale/details/ or /to-rent/details/
        $('a[href*="/details/"]').each((_, a) => {
          const u = absUrl(String($(a).attr('href') || ''), listUrl);
          if (!u) return;
          try {
            const uu = new URL(u);
            if (uu.origin !== origin) return;
            if (/\/details\//.test(uu.pathname)) candidates.push(uu.toString());
          } catch { /* ignore */ }
        });

        // Regex fallback for client-rendered cases
        try {
          const absRe = /https?:\/\/www\.primelocation\.com\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
          const relRe = /\b\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
          const absMatches = html.match(absRe) || [];
          const relMatches = (html.match(relRe) || []).map((m) => new URL(m, listUrl).toString());
          for (const u of [...absMatches, ...relMatches]) {
            try { const uu = new URL(u); if (uu.origin === origin) candidates.push(uu.toString()); } catch {}
          }
        } catch {}

        const unique = Array.from(new Set(candidates));
        for (const u of unique) { yielded++; yield u; }
        if (unique.length === 0) break;
      }
      // Wrap to page 1 after hitting page 4
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
    // Canonical URL if provided
    const url_canonical = $('link[rel="canonical"]').attr('href') || null;
    // Determine listing type from URL
    let listing_type: 'buy' | 'rent' = 'buy';
    try { const u = new URL(url); if (/\/to-rent\//i.test(u.pathname)) listing_type = 'rent'; } catch {}
    // Map string to typed PropertyType
    const toPropertyType = (s: string | null): PropertyType | undefined => {
      if (!s) return undefined;
      const v = String(s).toLowerCase();
      if (v.includes('apartment') || v.includes('flat')) return 'apartment';
      if (v.includes('house') || v.includes('bungalow') || v.includes('villa')) return 'house';
      if (v.includes('duplex')) return 'duplex';
      if (v.includes('townhouse') || v.includes('terrace') || v.includes('terraced')) return 'townhouse';
      if (v.includes('land') || v.includes('plot')) return 'land';
      if (v.includes('studio')) return 'studio';
      if (v.includes('condo')) return 'condo';
      return 'other';
    };

    const title = pickText($('h1'))
      || $('meta[property="og:title"]').attr('content')
      || $('title').text().trim()
      || null;
    const propertyTypeFromTitle = toPropertyType(title);

    // Price & Currency (prefer currency sign next to the price)
    let price: number | undefined = undefined;
    const priceSelector = $('[data-testid="price"], .price, [itemprop="price"]');
    const priceText = pickText(priceSelector) || $('meta[property="og:price:amount"]').attr('content') || null;
    const metaCurrency = $('meta[property="og:price:currency"]').attr('content') || $('meta[itemprop="priceCurrency"]').attr('content') || null;
    const bodyText = $('body').text();

    // Detect currency based on symbol/abbr appearing before the number
    const detectCurrency = (txt?: string | null): string | null => {
      if (!txt) return null;
      const s = String(txt);
      // strong: symbol at start
      const m0 = s.match(/^\s*(£|€|\$|₦)/);
      if (m0) {
        const sym = m0[1];
        if (sym === '£') return 'GBP';
        if (sym === '€') return 'EUR';
        if (sym === '$') return 'USD';
        if (sym === '₦') return 'NGN';
      }
      // otherwise: symbol immediately before digits anywhere
      const m1 = s.match(/(£|€|\$|₦)\s*[0-9]/);
      if (m1) {
        const sym = m1[1];
        if (sym === '£') return 'GBP';
        if (sym === '€') return 'EUR';
        if (sym === '$') return 'USD';
        if (sym === '₦') return 'NGN';
      }
      // explicit codes
      if (/\bGBP\b/i.test(s)) return 'GBP';
      if (/\bEUR\b/i.test(s)) return 'EUR';
      if (/\bUSD\b/i.test(s)) return 'USD';
      if (/\bNGN\b/i.test(s)) return 'NGN';
      return null;
    };

    // Parse numeric price: take the first number-like token
    if (priceText) {
      const nums = String(priceText).match(/[0-9][0-9,\.]{0,12}/g);
      const first = nums?.[0];
      if (first) {
        const p = Number(first.replace(/,/g, ''));
        if (Number.isFinite(p)) price = p;
      }
    }

    // Currency priority: from price sign -> meta -> domain fallback
    let currency = detectCurrency(priceText) || metaCurrency || null;
    if (!currency) {
      try { const u0 = new URL(url); if (u0.hostname.endsWith('.co.uk')) currency = 'GBP'; } catch {}
    }
    // Final fallback from body if still missing
    if (!currency) {
      const c2 = detectCurrency(bodyText);
      if (c2) currency = c2;
    }
    if (!currency) currency = 'GBP';

    // External ID from URL like /details/XXXXXXX
    let external_id: string = url;
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/details\/(\d+)/i);
      if (m && m[1]) external_id = m[1];
    } catch {}

    // Address & geo via JSON-LD if present (+ enrich: bedrooms/bathrooms/floorSize/property type)
    let address_line1: string | null = null;
    let address_line2: string | null = null;
    let postal_code: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let listed_at: string | null = null;
    let listing_updated_at: string | null = null;
    let bedrooms: number | null = null;
    let bathrooms: number | null = null;
    let size_sqm: number | null = null;
    let propertyType: PropertyType | undefined = undefined;
    let cityFromJsonLd: string | null = null;
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
                if (!cityFromJsonLd && locality) try { cityFromJsonLd = String(locality).trim(); } catch {}
              }
              if (node.geo && typeof node.geo === 'object') {
                const lat = Number(node.geo.latitude ?? node.geo.lat);
                const lng = Number(node.geo.longitude ?? node.geo.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) { latitude = lat; longitude = lng; }
              }
              // Offers: price and currency fallback
              try {
                if (price === undefined) {
                  const cand = (node as any)?.offers;
                  const pRaw = cand?.price ?? cand?.lowPrice ?? cand?.highPrice ?? (node as any)?.price;
                  const pv = Number(pRaw);
                  if (Number.isFinite(pv)) price = pv;
                }
                if (!currency) {
                  const cand = (node as any)?.offers;
                  const cur = cand?.priceCurrency ?? cand?.currency ?? (node as any)?.priceCurrency;
                  if (typeof cur === 'string' && cur.trim()) currency = cur.trim().toUpperCase();
                }
              } catch { /* ignore */ }
              // Bedrooms / Bathrooms
              const nb = Number(node.numberOfBedrooms ?? (node.offers && node.offers.numberOfBedrooms));
              if (Number.isFinite(nb) && bedrooms === null) bedrooms = nb;
              const nba = Number(node.numberOfBathroomsTotal ?? node.numberOfBathrooms ?? (node.offers && node.offers.numberOfBathrooms));
              if (Number.isFinite(nba) && bathrooms === null) bathrooms = nba;
              // Floor size (QuantitativeValue)
              const toSqm = (val: any): number | null => {
                if (!val) return null;
                try {
                  const v = Number(val.value ?? val);
                  const unit = String(val.unitCode ?? val.unitText ?? '').toUpperCase();
                  if (!Number.isFinite(v)) return null;
                  if (unit.includes('SQF') || unit.includes('FT')) return Math.round((v / 10.7639) * 100) / 100;
                  if (unit.includes('M2') || unit.includes('SQM') || unit.includes('MTK')) return Math.round(v * 100) / 100;
                  return null;
                } catch { return null; }
              };
              const fs = (node.floorSize || (node['@type'] === 'QuantitativeValue' ? node : null));
              const sqm = Array.isArray(fs) ? (toSqm(fs[0]) ?? null) : toSqm(fs);
              if (sqm && size_sqm === null) size_sqm = sqm;
              // Property type
              const ptype = (typeof node.propertyType === 'string' ? node.propertyType : (typeof node['@type'] === 'string' ? node['@type'] : null));
              if (!propertyType && ptype) propertyType = toPropertyType(ptype);
              Object.values(node).forEach(walk);
            }
          };
          walk(data);
        } catch {}
      });
    } catch {}

    // Prefer title-derived property type if JSON-LD didn't provide one
    if (!propertyType && propertyTypeFromTitle && propertyTypeFromTitle !== 'other') {
      propertyType = propertyTypeFromTitle;
    }

    // Fallback: parse "Listed on" / "Added on" from visible text (detail page)
    if (!listed_at) {
      try {
        const text = $('body').text();
        const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const parseMonthDate = (t: string): string | null => {
          const m = t.match(/\b(Listed on|Added on)\s+(\d{1,2})(st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})/i);
          if (!m) return null;
          const day = Number(m[2]);
          const monthName = m[4];
          const year = Number(m[5]);
          const mi = months.indexOf(monthName.toLowerCase());
          if (day >= 1 && day <= 31 && mi >= 0 && year >= 1900) {
            return new Date(Date.UTC(year, mi, day)).toISOString();
          }
          return null;
        };
        const parseSlashDate = (t: string): string | null => {
          // UK format dd/mm/yyyy or dd/mm/yy
          const m = t.match(/\b(Listed on|Added on)\s+(\d{1,2})\s*[\/-]\s*(\d{1,2})\s*[\/-]\s*(\d{2,4})\b/i);
          if (!m) return null;
          let day = Number(m[2]);
          let month = Number(m[3]);
          let year = Number(m[4]);
          if (year < 100) year += (year >= 70 ? 1900 : 2000);
          if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900) {
            return new Date(Date.UTC(year, month - 1, day)).toISOString();
          }
          return null;
        };
        listed_at = parseMonthDate(text) || parseSlashDate(text) || listed_at;
      } catch {}
    }

    // Address fallback from visible selectors
    if (!address_line1) {
      const addrSel = pickText($('address, [data-testid="address"], .property-address, .css-16jl9ur-Text, .css-10klw3m-Text'));
      if (addrSel) address_line1 = addrSel.replace(/\s+/g, ' ').trim();
    }

    // Bedrooms / bathrooms fallback via visible text
    if (bedrooms === null) {
      try { const m = String(title + ' ' + bodyText).match(/(\d+)\s*bed(room)?s?/i); if (m && m[1]) bedrooms = Number(m[1]); } catch {}
    }
    if (bathrooms === null) {
      try { const m = String(bodyText).match(/(\d+)\s*bath(rooms?)?/i); if (m && m[1]) bathrooms = Number(m[1]); } catch {}
    }

    // Size fallback via visible text (sq ft or sqm)
    if (size_sqm === null) {
      try {
        const m = String(bodyText).match(/([0-9][0-9,\.]{1,6})\s*(sq\s*ft|sqft|ft²|m2|m²|sqm)/i);
        if (m && m[1]) {
          const val = Number(m[1].replace(/,/g, ''));
          const unit = m[2].toLowerCase();
          if (Number.isFinite(val)) size_sqm = /(sq\s*ft|sqft|ft²)/i.test(unit) ? Math.round((val / 10.7639) * 100) / 100 : Math.round(val * 100) / 100;
        }
      } catch {}
    }

    // Property type fallback from title/body and breadcrumbs
    if (!propertyType) {
      const crumbsTxt = $('[class*="crumb" i] a, nav.breadcrumb a, .breadcrumbs a').map((_, a) => $(a).text().trim()).get().join(' ');
      const maybe = [title, crumbsTxt, bodyText].filter(Boolean).join(' ');
      propertyType = toPropertyType(maybe) || undefined;
    }

    // Breadcrumbs -> neighborhood/city/state
    let city: string | null = cityFromJsonLd; let state: string | null = null; let neighborhood: string | null = null;
    const crumbs = $('[class*="crumb" i] a, nav.breadcrumb a, .breadcrumbs a').map((_, a) => $(a).text().trim()).get().filter(Boolean);
    if (crumbs.length) {
      neighborhood = crumbs[crumbs.length - 1] || null;
      city = crumbs[crumbs.length - 2] || null;
      state = crumbs[crumbs.length - 3] || null;
    }
    // Right-to-left parse from address_line1: '<street>, <neighbourhood>, <city> <postcode>'
    if (address_line1) {
      try {
        const rawParts = address_line1.split(',').map(s => s.trim()).filter(Boolean);
        const parts = rawParts.filter(p => !/^(united kingdom|england|scotland|wales|northern ireland)$/i.test(p));
        if (parts.length >= 1) {
          const last = parts[parts.length - 1];
          // Capture outward code (e.g., AB15) optionally followed by inward (e.g., 1AA)
          const m = last.match(/([A-Za-z]{1,2}\d[A-Za-z0-9]?)(?:\s*\d[A-Za-z]{2})?$/i);
          let cityFromAddr: string | null = null;
          if (m) {
            const outward = m[1].toUpperCase();
            postal_code = outward; // per requirement: capture outward code
            cityFromAddr = last.replace(m[0], '').trim().replace(/[,\s]+$/,'');
          } else {
            cityFromAddr = last.trim();
          }
          if (cityFromAddr) city = cityFromAddr;
          // Neighbourhood is the token before the last when present
          if (parts.length >= 2) {
            neighborhood = parts[parts.length - 2] || neighborhood;
          }
        }
      } catch { /* ignore */ }
    }

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
              if (node['@type'] === 'ImageObject' && typeof (node as any).url === 'string') push((node as any).url);
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

    // Extract Key Features (best-effort)
    let features: string[] = [];
    try {
      const push = (s?: string | null) => { if (!s) return; const t = String(s).trim(); if (t) features.push(t); };
      $('.key-features li, [data-testid="key-features"] li').each((_i, li) => push($(li).text()));
      // Sections that contain "Key features"
      $('section').each((_i, sec) => {
        const txt = $(sec).text();
        if (/key\s*features/i.test(txt)) $('li', sec).each((_j, li) => push($(li).text()));
      });
      // Deduplicate (case-insensitive)
      const norm = features.map(f => f.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const seen = new Set<string>();
      const uniq: string[] = [];
      for (const f of norm) {
        const k = f.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(f);
      }
      features = uniq;
    } catch {}

    // Extract details table (best-effort: table th/td or dl dt/dd)
    const details: Record<string, string> = {};
    try {
      $('table').each((_i, tbl) => {
        $('tr', tbl).each((_j, tr) => {
          const k = $(tr).find('th, td').first().text().trim();
          const v = $(tr).find('td').last().text().trim();
          if (k && v) details[k] = v;
        });
      });
      $('dl').each((_i, dl) => {
        const dts = $(dl).find('dt');
        const dds = $(dl).find('dd');
        dts.each((idx, dt) => {
          const k = $(dt).text().trim();
          const v = $(dds.get(idx)).text().trim();
          if (k && v) details[k] = v;
        });
      });
    } catch {}

    // Capture specific metadata into raw: tenure, EPC rating, council tax band
    const pickDetail = (keys: string[]): string | null => {
      const entries = Object.entries(details);
      for (const [k, v] of entries) {
        if (keys.some(kk => k.toLowerCase().includes(kk))) return v;
      }
      return null;
    };
    let tenure: string | null = pickDetail(['tenure']) || null;
    // Also detect tenure from features/body text (Freehold/Leasehold)
    if (!tenure) {
      const txt = [features.join(' | '), $('body').text()].join(' | ');
      const m = txt.match(/\b(Freehold|Leasehold|Share of Freehold)\b/i);
      if (m) tenure = m[1];
    }
    let epc_rating: string | null = pickDetail(['epc', 'energy performance']) || null;
    if (!epc_rating) {
      const t = $('body').text();
      const m = t.match(/EPC[^A-Za-z0-9]*([A-G][+\-]?)/i);
      if (m) epc_rating = m[1].toUpperCase();
    }
    let council_tax_band: string | null = pickDetail(['council tax', 'council-tax']) || null;
    if (council_tax_band) {
      const m = council_tax_band.match(/band\s*([A-H])/i);
      if (m) council_tax_band = m[1].toUpperCase();
    } else {
      const t = $('body').text();
      const m = t.match(/council\s*tax\s*band\s*([A-H])/i);
      if (m) council_tax_band = m[1].toUpperCase();
    }

    return {
      external_id,
      url,
      url_canonical,
      title,
      description: $('meta[name="description"]').attr('content') || null,
      price,
      currency,
      size_sqm,
      bedrooms,
      bathrooms,
      property_type: propertyType,
      images,
      address_line1,
      address_line2,
      neighborhood,
      city,
      state,
      postal_code,
      listing_type,
      country,
      latitude,
      longitude,
      listed_at,
      listing_updated_at,
      is_active: true,
      raw: { source: 'PrimeLocation', url, features, details, tenure, epc_rating, council_tax_band },
    } as any;
  }
}
