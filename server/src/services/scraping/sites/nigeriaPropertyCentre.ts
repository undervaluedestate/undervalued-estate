import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
import type { ScrapeContext } from '../../../types';

function absUrl(href: string, base: string): string | null {
  if (!href) return null;
  try {
    // Ensure absolute URL and same-origin normalization
    const u = new URL(href, base);
    return u.toString();
  } catch {
    return null;
  }
}

function pickText($el: cheerio.Cheerio<any>): string | null {
  const t = $el.first().text().trim();
  return t ? t : null;
}

// Nigeria Property Centre adapter with deterministic selectors
export class NigeriaPropertyCentreAdapter extends BaseAdapter {
  getMeta() { return { name: 'NigeriaPropertyCentre' }; }

  async *discoverListingUrls(ctx: ScrapeContext): AsyncGenerator<string> {
    // Prefer for-sale indexes; try a couple of common category paths
    const origin = new URL(ctx.source.base_url).origin;
    const listingBases = [
      new URL('/for-sale/', ctx.source.base_url).toString(),
      new URL('/for-sale/houses/', ctx.source.base_url).toString(),
    ];
    const maxPages = Math.max(1, ctx.maxPages || 1);

    for (const base of listingBases) {
      for (let page = 1; page <= maxPages; page++) {
        const listUrl = page === 1 ? base : `${base}?page=${page}`;
        ctx.log('List page', listUrl);
        const html = await ctx.http.getText(listUrl, ctx.requestTimeoutMs);
        const $ = cheerio.load(html);

        const candidates: string[] = [];
        // Broader selectors. NPC detail URLs typically include '/for-sale/' path as well.
        $(
          [
            'ul.property-list li a[href]',
            '.property-list .property a[href]',
            'a[title][href*="/for-sale/"]',
            'a[href*="/for-sale/"]',
            'a[href*="/property/"]',
          ].join(', ')
        ).each((_, a) => {
          const href = String($(a).attr('href') || '');
          // Skip obvious nav/self links
          if (!href || href === '#' || href.startsWith('javascript:')) return;
          const abs = absUrl(href, base);
          if (!abs) return;
          if (!abs.startsWith(origin)) return;
          // Heuristic: likely detail pages contain '/for-sale/' and at least one more segment
          try {
            const u = new URL(abs);
            const segs = u.pathname.split('/').filter(Boolean);
            if (!u.pathname.includes('/for-sale/')) return;
            if (segs.length < 3) return; // avoid very shallow category pages
            candidates.push(abs);
          } catch { /* ignore */ }
        });

        const unique = Array.from(new Set(candidates));
        for (const u of unique) yield u;
      }
    }
  }

  async parseListing(ctx: ScrapeContext, html: string, url: string) {
    const $ = ctx.cheerio.load(html);
    // Listing type from URL path
    let listing_type: 'buy' | 'rent' = 'buy';
    try {
      const u = new URL(url);
      if (/\/for-rent\//i.test(u.pathname)) listing_type = 'rent';
      else if (/\/for-sale\//i.test(u.pathname)) listing_type = 'buy';
    } catch {/* default to buy */}

    // Title selectors
    const title = pickText($(
      'h1.property-title, h1[itemprop="name"], h1.title, h1'
    )) || null;

    // Address line 1 (estate / street)
    let address_line1: string | null = null;
    let postal_code: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    const addrCandidates = [
      '.address',
      '.property-address',
      'span[itemprop="streetAddress"]',
      '.property-details .value:contains("Estate"), .property-details .value:contains("Address")',
      '.breadcrumb li:nth-last-child(3) a',
    ];
    for (const sel of addrCandidates) {
      const t = pickText($(sel));
      // Accept address text even if it contains city/state (user prefers completeness over cleanliness)
      if (t && t.length >= 3) { address_line1 = t; break; }
    }

    // Try to read Address from common detail rows: name/value list items
    if (!address_line1) {
      const detailRows = $('.property-details li, .details li, .key-details li, .facts li').toArray();
      for (const li of detailRows) {
        const name = $(li).find('.name, .label, .title').text().trim().toLowerCase();
        const val = $(li).find('.value, .text').text().trim();
        if (!val || val.length < 3) continue;
        if (name.includes('address') || name.includes('location') || name.includes('street') || name.includes('estate')) {
          address_line1 = val;
          break;
        }
      }
    }

    // Price selectors
    const priceText = pickText($(
      '#price, .price, .property-price, [class*="price" i]'
    ));
    const priceNum = priceText ? Number((priceText.match(/[0-9,.]+/g) || [''])[0].replace(/[,]/g, '')) : undefined;

    // External ID from URL slug
    let external_id: string;
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // often ends with numeric slug; fallback to full url
      external_id = parts[parts.length - 1] || url;
    } catch {
      external_id = url;
    }

    // Location from breadcrumb (do this before JSON-LD so composed address can include these)
    let city: string | null = null; let state: string | null = null; let neighborhood: string | null = null;
    const bcParts = $(
      '.breadcrumb li, nav.breadcrumb li, [class*="breadcrumb" i] li'
    ).map((_i: number, li: any) => $(li).text().trim()).get().filter(Boolean);
    if (bcParts.length) {
      // Heuristic: [..., State, City, Neighborhood] or similar ordering
      neighborhood = bcParts[bcParts.length - 1] || null;
      city = bcParts[bcParts.length - 2] || null;
      state = bcParts[bcParts.length - 3] || null;
      // Normalize obvious noise
      if (city && /home|for\s*sale/i.test(city)) city = null;
      if (state && /home|for\s*sale/i.test(state)) state = null;
      if (neighborhood && /home|for\s*sale/i.test(neighborhood)) neighborhood = null;
    }

    // JSON-LD PostalAddress + geo (after we have city/state/neighborhood)
    try {
      $('script[type="application/ld+json"]').each((_idx: number, el: any) => {
        const txt = $(el).contents().text();
        if (!txt || txt.length < 2) return;
        try {
          const data = JSON.parse(txt);
          const walk = (node: any) => {
            if (!node) return;
            if (typeof node === 'object') {
              const maybeAddr = (node.address && typeof node.address === 'object') ? node.address : (node['@type'] === 'PostalAddress' ? node : null);
              if (maybeAddr) {
                const street = maybeAddr.streetAddress || maybeAddr.address1 || maybeAddr.addressLine1 || null;
                const locality = maybeAddr.addressLocality || maybeAddr.locality || maybeAddr.city || city || null;
                const region = maybeAddr.addressRegion || maybeAddr.region || maybeAddr.state || state || null;
                const pc = maybeAddr.postalCode || maybeAddr.postcode || maybeAddr.zipCode || null;
                const neigh = maybeAddr.neighborhood || maybeAddr.addressNeighborhood || neighborhood || null;
                const parts = [street, neigh, locality, region, pc].filter(Boolean).map((s: any) => String(s).trim());
                if (!address_line1 && parts.length) address_line1 = parts.join(', ');
                if (!postal_code && pc) postal_code = String(pc);
              }
              if (node.geo && typeof node.geo === 'object') {
                const lat = Number(node.geo.latitude ?? node.geo.lat);
                const lng = Number(node.geo.longitude ?? node.geo.lng);
                if (Number.isFinite(lat) && Number.isFinite(lng)) { latitude = lat; longitude = lng; }
              }
              Object.values(node).forEach(walk);
              return;
            }
          };
          walk(data);
        } catch { /* ignore non-JSON */ }
      });
    } catch { /* ignore */ }

    // Fallback: if we still lack a street/estate, compose a full address from available parts
    if (!address_line1) {
      const parts = [neighborhood, city, state, 'Nigeria'].filter(Boolean).map((s: any) => String(s).trim());
      if (parts.length) address_line1 = parts.join(', ');
    }

    // Fallback: if we still lack a street/estate, compose a full address from available parts
    if (!address_line1) {
      const parts = [neighborhood, city, state, 'Nigeria'].filter(Boolean).map((s: any) => String(s).trim());
      if (parts.length) address_line1 = parts.join(', ');
    }

    // Property meta lists
    const metaLis = $('.property-meta li, .facts li, ul.meta li').map((_i: number, li: any) => $(li).text().trim()).get();
    const metaText = metaLis.join(' \u2022 ');
    const bodyText = $('body').text();

    // Bedrooms/Bathrooms
    const bedMatch = metaText.match(/(\d+)\s*(bed|bedroom)s?/i) || bodyText.match(/(\d+)\s*(bed|bedroom)s?/i);
    const bathMatch = metaText.match(/(\d+)\s*(bath|bathroom)s?/i) || bodyText.match(/(\d+)\s*(bath|bathroom)s?/i);

    // Size
    const sizeMatch = metaText.match(/([0-9,.]+)\s*(sqm|m2|square\s*meters?)/i) || bodyText.match(/([0-9,.]+)\s*(sqm|m2|square\s*meters?)/i);

    // Listed date (optional)
    const listedAt = $('time[datetime]').attr('datetime') || pickText($('.date-posted, .listed-date')) || null;

    return {
      external_id,
      url,
      title,
      description: $('meta[name="description"]').attr('content') || null,
      price: priceNum,
      currency: 'NGN',
      size: sizeMatch ? sizeMatch[0] : undefined,
      bedrooms: bedMatch ? Number(bedMatch[1]) : undefined,
      bathrooms: bathMatch ? Number(bathMatch[1]) : undefined,
      // let normalizer infer property_type from body text/title
      address_line1,
      address_line2: null,
      neighborhood,
      city,
      state,
      postal_code,
      listing_type,
      country: 'Nigeria',
      latitude,
      longitude,
      listed_at: listedAt,
      is_active: true,
      raw: { source: 'NigeriaPropertyCentre', url }
    };
  }
}
