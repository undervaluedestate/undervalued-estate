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
    // Prefer region-specific bases when provided
    const origin = new URL(ctx.source.base_url).origin;
    const providedBases = Array.isArray((ctx as any).extra?.startUrls) && (ctx as any).extra.startUrls.length
      ? (ctx as any).extra.startUrls as string[]
      : [];
    const toAbs = (u: string) => {
      try { return new URL(u).toString(); } catch { return new URL(u.replace(/^\/*/, '/'), ctx.source.base_url).toString(); }
    };
    // Respect listingType for default bases
    const listingType = (ctx as any).extra?.listingType as ('buy'|'rent'|undefined);
    const salePath = '/for-sale/';
    const rentPath = '/for-rent/';
    const defaultBases = listingType === 'rent'
      ? [new URL(rentPath, ctx.source.base_url).toString(), new URL(rentPath + 'houses/', ctx.source.base_url).toString()]
      : [new URL(salePath, ctx.source.base_url).toString(), new URL(salePath + 'houses/', ctx.source.base_url).toString()];
    const listingBases = providedBases.length ? providedBases.map(toAbs) : defaultBases;
    const maxPages = Math.max(1, ctx.maxPages || 1);

    for (const base of listingBases) {
      // Cursor-based paging per seed URL (preserve existing query params like keywords)
      let nextPage = 1;
      try {
        const { data: cur } = await (ctx.adminClient as any)
          .from('discovery_cursors')
          .select('next_page')
          .eq('seed_url', base)
          .maybeSingle();
        if (cur && typeof cur.next_page === 'number' && cur.next_page > 0) nextPage = cur.next_page;
      } catch { /* ignore */ }

      const firstPage = nextPage;
      const lastPage = Math.max(firstPage, firstPage + (maxPages - 1));
      let yielded = 0;
      for (let page = firstPage; page <= lastPage; page++) {
        let listUrl = base;
        try {
          const u = new URL(base);
          u.searchParams.set('page', String(page));
          listUrl = u.toString();
        } catch { /* keep base */ }

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
          // Heuristic: ensure we are on sale/rent detail pages with enough depth
          try {
            const u = new URL(abs);
            const segs = u.pathname.split('/').filter(Boolean);
            const wantRent = listingType === 'rent';
            const hasSale = u.pathname.includes('/for-sale/');
            const hasRent = u.pathname.includes('/for-rent/');
            if (listingType) {
              if (wantRent && !hasRent) return;
              if (!wantRent && !hasSale) return;
            } else {
              if (!(hasSale || hasRent)) return;
            }
            if (segs.length < 3) return; // avoid very shallow category pages
            candidates.push(abs);
          } catch { /* ignore */ }
        });

        const unique = Array.from(new Set(candidates));
        for (const u of unique) { yielded++; yield u; }
        if (unique.length === 0) break;
      }
      // Bump cursor to next page after processing window
      try {
        await (ctx.adminClient as any)
          .from('discovery_cursors')
          .upsert({ seed_url: base, next_page: lastPage + 1, last_run_at: new Date().toISOString(), last_status: `yielded:${yielded}` }, { onConflict: 'seed_url' });
      } catch { /* ignore */ }
    }
  }

  async parseListing(ctx: ScrapeContext, html: string, url: string) {
    // Load the HTML with Cheerio
    const $ = cheerio.load(html);

    // Helper to compare address completeness safely
    const scoreAddr = (s?: string | null): number => {
      if (!s) return 0;
      const parts = String(s).split(',').length;
      return parts * 1000 + String(s).length;
    };

    // Helper to trim promos, labels and enrich with nearby cues and breadcrumb
    const postProcessAddress = (raw: string, opts?: { strict?: boolean }): string => {
      if (!raw) return raw;
      let s = String(raw);
      // Remove label prefixes
      s = s.replace(/^\s*(Prime\s*Location|Location)\s*:\s*/i, '');
      // If label occurs later in the string, keep only the portion after it
      if (/\b(Prime\s*Location|Location)\s*:/i.test(s)) {
        s = s.replace(/^[\s\S]*?\b(Prime\s*Location|Location)\s*:\s*/i, '');
      }
      // Normalize whitespace
      s = s.replace(/[\s\n]+/g, ' ').replace(/\u00a0|&nbsp;/g, ' ').trim();
      // Remove accidental site phrases
      s = s.replace(/\bthis website\b/gi, '').replace(/\s{2,}/g, ' ').trim();
      // Cut at promo keywords if they appear inside the candidate
      const stopRe = /(Delivery\s*Date|Exclusive\b|Apartment\s*Highlights|Luxury\b|A\s*Premium\b|Facilities\b|Features\b|Fully\s+Equipped|Generator\b|Gym\b|Parking\b|Bedrooms?\b|\b\d+\s*sqm)/i;
      const pos = s.search(stopRe);
      if (pos >= 0) s = s.slice(0, pos).trim();
      if (!opts?.strict) {
        // Remove landmark phrases like ", by <place>"
        s = s.replace(/,\s*by\s+[^,|;:.]+/gi, '');
        // Prepend an "Off <road>" phrase if present in page and not already in s
        try {
          const full = $('body').text();
          const offNear = full.match(/\boff\s+(?!this\b)[A-Za-z][^,|;.]{2,60}/i);
          if (offNear && !/\boff\s/i.test(s)) {
            const offStr = offNear[0].replace(/[\s\n]+/g, ' ').trim();
            s = `${offStr}, ${s}`;
          }
        } catch { /* ignore */ }
        // Append breadcrumb parts if missing
        const bc = $('.breadcrumb li, nav.breadcrumb li, [class*="breadcrumb" i] li').map((_i, li) => $(li).text().trim()).get().filter(Boolean);
        const neigh = bc[bc.length - 1] || '';
        const cty = bc[bc.length - 2] || '';
        const st = bc[bc.length - 3] || '';
        const needPart = (part: string) => part && !new RegExp(`\\b${part.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(s);
        if (needPart(neigh)) s += `, ${neigh}`;
        if (needPart(cty)) s += `, ${cty}`;
        if (needPart(st)) s += `, ${st}`;
      }
      // Remove trailing ", Nigeria"
      s = s.replace(/,\s*Nigeria\s*$/i, '').trim();
      // Keep at most 7 comma parts to avoid dragging too much context
      const parts = s.split(',').map(x => x.trim()).filter(Boolean);
      if (parts.length > 7) s = parts.slice(0, 7).join(', ');
      return s;
    };
    
    // Debug: Log the URL being processed
    console.log(`\n===== NPC Scraper Debug =====`);
    console.log(`[1/4] Starting parse for URL: ${url}`);
    console.log(`[2/4] Page title: ${$('title').text().trim() || 'No title found'}`);
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
    
    // Enhanced debug logging
    console.log('\n===== NPC Scraper Debug =====');
    console.log(`[1/4] Starting scrape for URL: ${url}`);
    console.log(`[2/4] Page title: ${$('title').text().trim() || 'No title found'}`);
    
    // Log the first 1000 characters of the page for debugging
    const pageContent = $.html() || '';
    console.log(`[3/4] Page content sample: ${pageContent.substring(0, 500)}...`);
    
    // Log all address elements found with proper TypeScript types
    const addressElements = $('address, [class*="address"], [class*="location"], [id*="address"], [id*="location"]');
    console.log(`[4/4] Found ${addressElements.length} potential address elements`);
    
    // Process address elements with proper typing
    addressElements.each((index: number, element: any) => {
      const text = $(element).text().trim();
      console.log(`  - Element ${index + 1} (${element.tagName}${element.attribs?.class ? '.' + element.attribs.class.split(' ').join('.') : ''}): ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      
      // If this looks like a good address, use it as a fallback
      if (text.length > 10 && !address_line1 && /[a-z]/i.test(text)) {
        console.log(`  - Using as potential address: ${text}`);
        address_line1 = text;
      }
    });
    
    // Try multiple strategies to get the most complete address
    const addressSources = [
      // 1. Check for <address> element first (common pattern)
      () => {
        const el = $('.property-details address, address').first();
        if (el.length) {
          // Get all text content including nested elements
          return el.text()
            .replace(/\s+/g, ' ')
            .replace(/[\n\t]/g, ' ')
            .replace(/\u00a0|&nbsp;/g, ' ')
            .trim();
        }
        return null;
      },
      
      // 2. Look for common address containers
      () => {
        const selectors = [
          '.property-address', 
          '.address', 
          '.location',
          '.property-location',
          '.property-address',
          '.property-address-full',
          '.address-container',
          '.property-address-container',
          '.property-address-full',
          '.property-address-line',
          '.address-line',
          '.property-location-address',
          '.location-address',
          '.property-address-text',
          '.address-text',
          '.property-full-address'
        ];
        
        for (const sel of selectors) {
          const text = $(sel).first().text().trim();
          if (text && text.length > 5) return text;
        }
        return null;
      },
      
      // 3. Look for meta tags with address info
      () => {
        const metaAddress = $('meta[property="og:description"], meta[property="description"], meta[name="description"]')
          .first()
          .attr('content');
          
        if (metaAddress && /(road|street|avenue|close|drive|way|estate|villa|house|apartment|flat)/i.test(metaAddress)) {
          return metaAddress;
        }
        return null;
      },
      
      // 4. Look for JSON-LD data
      () => {
        try {
          const jsonLd = $('script[type="application/ld+json"]').first().html();
          if (jsonLd) {
            const data = JSON.parse(jsonLd);
            if (data.streetAddress || data.address?.streetAddress) {
              return [
                data.streetAddress || data.address.streetAddress,
                data.addressLocality || data.address?.addressLocality,
                data.addressRegion || data.address?.addressRegion,
                data.postalCode || data.address?.postalCode
              ].filter(Boolean).join(', ');
            }
          }
        } catch {}
        return null;
      },
      
      // 5. Look for Google Maps iframe/links
      () => {
        const mapLink = $('a[href*="google.com/maps"], a[href*="goo.gl/maps"], iframe[src*="google.com/maps"]').first();
        const href = mapLink.attr('href') || mapLink.attr('src') || '';
        if (href) {
          try {
            const url = new URL(href);
            const q = url.searchParams.get('q');
            if (q) return q;
            
            // Try to extract from path segments
            const pathSegs = url.pathname.split('/').filter(Boolean);
            const placeIdx = pathSegs.indexOf('place');
            if (placeIdx >= 0 && pathSegs[placeIdx + 1]) {
              return decodeURIComponent(pathSegs[placeIdx + 1].replace(/\+/g, ' '));
            }
          } catch {}
        }
        return null;
      },

      // 6. Parse a "Prime Location:" or "Location:" section and trim at known promo labels
      () => {
        try {
          const full = $('body').text();
          const re = /\b(?:Prime\s*Location|Location)\s*:\s*([\s\S]*?)(?=\b(Delivery\s*Date|Exclusive|Apartment\s*Highlights|Luxury|A\s*Premium|Price|Facilities|Features)\b|$)/i;
          const m = full.match(re);
          if (m && m[1]) {
            let s = m[1].replace(/[\s\n]+/g, ' ').trim();
            s = s.replace(/\s*\(Ref:.*$/i, '').replace(/\s*\|.*$/, '').trim();
            return postProcessAddress(s);
          }
        } catch { /* ignore */ }
        return null;
      },
      
      // 7. Look for any element with address-like text (regex-based, case-insensitive)
      () => {
        const addrRe = /\b(road|street|avenue|close|drive|way|estate|villa|house|apartment|flat|junction|crescent|highway|boulevard|phase|quarter|quaters|quarters|off\s+[a-z])/i;
        const blocks = $('p, li, .description, .property-description, .details, .key-details, .property-details, .body, .content').toArray();
        let best: string | null = null;
        for (let i = 0; i < Math.min(blocks.length, 200); i++) {
          let t = $(blocks[i]).text().replace(/[\s\n]+/g, ' ').trim();
          if (!t || t.length < 12) continue;
          if (!addrRe.test(t)) continue;
          // Split on common separators and pick the sub-segment with most commas
          const segs = t.split(/\.|\n|\r| - /).map(s => s.trim()).filter(Boolean);
          if (segs.length > 1) {
            segs.sort((a, b) => (b.split(',').length - a.split(',').length) || (b.length - a.length));
            t = segs[0];
          }
          // Trim obvious tails and promos, then enrich
          t = t.replace(/\s*\(Ref:.*$/i, '').replace(/\s*\|.*$/, '').trim();
          t = postProcessAddress(t);
          if (!best || t.split(',').length > best.split(',').length || t.length > best.length) best = t;
        }
        return best;
      }
    ];
    
    // Try each source with weights to prefer semantic quality (<address> first)
    const sourceNames = [
      'address element',                // 0
      'common address containers',      // 1
      'meta tags',                      // 2
      'JSON-LD data',                   // 3
      'Google Maps links',              // 4
      'Prime/Location section',         // 5
      'address-like text'               // 6
    ];
    const sourceWeight = (idx: number) => {
      switch (idx) {
        case 0: return 100; // <address>
        case 1: return 85;  // containers
        case 3: return 80;  // JSON-LD
        case 5: return 75;  // Prime/Location
        case 4: return 60;  // Maps
        case 2: return 50;  // meta
        case 6: return 40;  // regex scan
        default: return 10;
      }
    };
    let bestScore = 0;
    let addressLockedFromTag = false;
    for (let i = 0; i < addressSources.length; i++) {
      try {
        const raw = addressSources[i]();
        const processed = raw ? postProcessAddress(raw, { strict: i === 0 }) : null;
        console.log(`[NPC Scraper] Trying source '${sourceNames[i]}':`, processed || 'No result');
        if (processed && processed.length > 10) {
          const candScore = sourceWeight(i) * 100000 + scoreAddr(processed);
          if (candScore > bestScore) {
            address_line1 = processed;
            bestScore = candScore;
            if (i === 0) addressLockedFromTag = true; // Prefer <address>, prevent later overrides
            console.log('[NPC Scraper] Selected address:', address_line1, 'score=', candScore);
          }
        }
      } catch (e) {
        console.error(`[NPC Scraper] Error in source '${sourceNames[i]}':`, e);
      }
    }
    
    if (!address_line1 && !addressLockedFromTag) {
      console.warn('[NPC Scraper] No valid address found using any method');
    }
    
    // Then try common selectors as fallback
    if (!addressLockedFromTag) {
      const addrCandidates = [
      '.address',
      '.property-address',
      'span[itemprop="streetAddress"]',
      '.property-details .value:contains("Estate"), .property-details .value:contains("Address")',
      '.breadcrumb li:nth-last-child(3) a',
      ];
      for (const sel of addrCandidates) {
        const t = pickText($(sel));
        if (t && t.length >= 3) {
          if (!address_line1 || t.length > address_line1.length) {
            address_line1 = t;
          }
        }
      }
    }

    // Try to read Address from common detail rows: name/value list items
    if (!address_line1 && !addressLockedFromTag) {
      const detailRows = $('.property-details li, .details li, .key-details li, .facts li').toArray();
      for (const li of detailRows) {
        const name = $(li).find('.name, .label, .title').text().trim().toLowerCase();
        const val = $(li).find('.value, .text').text().trim();
        if (!val || val.length < 3) continue;
        if (name.includes('address') || name.includes('location') || name.includes('street') || name.includes('estate')) {
          if (!address_line1 || val.length > address_line1.length) {
            address_line1 = val;
          }
        }
      }
    }

    // Parse tables and definition lists for Address/Location labels
    if (!address_line1 && !addressLockedFromTag) {
      $('table tr').each((_i, tr) => {
        const cells = $(tr).find('th,td');
        if (cells.length < 2) return;
        const label = cells.first().text().trim().toLowerCase();
        const value = cells.slice(1).text().replace(/[\s\n]+/g, ' ').trim();
        if (!value) return;
        if (label.includes('address') || label.includes('location')) {
          if (!address_line1 || value.length > address_line1.length) address_line1 = value;
        }
      });
      if (!address_line1) {
        $('dl').each((_i, dl) => {
          const dts = $(dl).find('dt');
          const dds = $(dl).find('dd');
          dts.each((idx, dt) => {
            const label = $(dt).text().trim().toLowerCase();
            const value = $(dds.get(idx)).text().replace(/[\s\n]+/g, ' ').trim();
            if (!value) return;
            if (label.includes('address') || label.includes('location')) {
              if (!address_line1 || value.length > address_line1.length) address_line1 = value;
            }
          });
        });
      }
    }

    // As a final labeled-text fallback, scan body text for 'Address:' or 'Location:'
    if (!address_line1 && !addressLockedFromTag) {
      try {
        const fullText = $('body').text();
        const m1 = fullText.match(/Address\s*:\s*([^\n|]+)/i);
        const m2 = fullText.match(/Location\s*:\s*([^\n|]+)/i);
        const cand = (m1 && m1[1]) || (m2 && m2[1]) || '';
        if (cand && cand.trim().length > 5) {
          let s = cand.replace(/[\s\n]+/g, ' ').trim();
          s = s.replace(/\s*\(Ref:.*$/i, '').replace(/\s*\|.*$/, '').trim();
          if (!address_line1 || s.length > address_line1.length) address_line1 = s;
        }
      } catch { /* ignore */ }
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

    // JSON-LD PostalAddress + geo + publish/modified dates (after we have city/state/neighborhood)
    let jsonDatePublished: string | null = null;
    let jsonDateModified: string | null = null;
    try {
      $('script[type="application/ld+json"]').each((_idx: number, el: any) => {
        const txt = $(el).contents().text();
        if (!txt || txt.length < 2) return;
        try {
          const data = JSON.parse(txt);
          const walk = (node: any) => {
            if (!node) return;
            if (typeof node === 'object') {
              // Listing dates
              if (!jsonDatePublished && typeof node.datePublished === 'string') jsonDatePublished = node.datePublished;
              if (!jsonDateModified && typeof node.dateModified === 'string') jsonDateModified = node.dateModified;
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

    // Fallback: try to extract from embedded Google Maps links
    if (!address_line1) {
      const mapLink = $('a[href*="google.com/maps"], a[href*="goo.gl/maps"], a[href*="maps.app.goo.gl"], iframe[src*="google.com/maps"]').first();
      const href = mapLink.attr('href') || mapLink.attr('src') || '';
      if (href) {
        try {
          const u = new URL(href, url);
          // Prefer q parameter
          const q = u.searchParams.get('q') || u.searchParams.get('query');
          if (q && q.trim().length > 3) {
            address_line1 = decodeURIComponent(q).trim();
          } else {
            // Try to parse /place/<name>/ or path segments
            const segs = u.pathname.split('/').filter(Boolean);
            const placeIdx = segs.indexOf('place');
            if (placeIdx >= 0 && segs[placeIdx + 1]) {
              address_line1 = decodeURIComponent(segs[placeIdx + 1].replace(/\+/g, ' ')).trim();
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Fallback: if we still lack a street/estate, compose a full address from available parts
    if (!address_line1) {
      const parts = [neighborhood, city, state, 'Nigeria'].filter(Boolean).map((s: any) => String(s).trim());
      if (parts.length) address_line1 = parts.join(', ');
    }

    // Preferred override: extract address directly after "For Sale:" (or Rent/Lease) from page title/meta
    try {
      const titleCandidates = [
        $('meta[property="og:title"]').attr('content') || '',
        $('title').text() || '',
        $('h1').first().text() || ''
      ].map(t => String(t).trim()).filter(Boolean);
      let titleAddr: string | null = null;
      for (const tt of titleCandidates) {
        // Capture the full remainder after the colon, then clean up
        const colonIdx = tt.search(/For\s+(Sale|Rent|Lease)\s*:/i);
        if (colonIdx >= 0) {
          let rest = tt.slice(colonIdx).replace(/^[^:]*:\s*/i, '');
          // Cut off known suffixes: pipe, (Ref: ...), and price tails like " - ₦800,000,000" or " - NGN 800,000,000"
          rest = rest.split('|')[0];
          rest = rest.replace(/\s*\(Ref:.*$/i, '');
          rest = rest.replace(/\s*[-–—]\s*(NGN|USD|GBP|EUR)?\s*[₦$€£]?\s*[0-9.,]+.*$/i, '');
          // Normalize whitespace and trim leading commas
          rest = rest.replace(/\s+/g, ' ').replace(/^\s*,\s*/, '').trim();
          // Remove trailing ", Nigeria"
          rest = rest.replace(/,\s*Nigeria\s*$/i, '').trim();
          // If the first comma-separated segment looks like a property title, drop it; otherwise keep it
          const parts = rest.split(',').map(s => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            const first = parts[0].toLowerCase();
            const looksLikeTitle = /(bed\s*rooms?|bedroom|bath\s*rooms?|bathroom|toilet|sqm|mansion|duplex|apartment|flat|bungalow|land|plot|detached|semi|terrace|storey|storeyed|office|shop|warehouse|luxury|brand\s*new|new|fitted)/i.test(first);
            if (looksLikeTitle) rest = parts.slice(1).join(', ');
          }
          if (rest && rest.length >= 3) { titleAddr = rest; break; }
        }
      }
      if (titleAddr) {
        const better = !addressLockedFromTag && (scoreAddr(titleAddr) > scoreAddr(address_line1));
        if (better) address_line1 = titleAddr;
      } else {
        // Try to parse from body text: For Sale: <title/address remainder>
        let docAddr: string | null = null;
        try {
          const docText = $('body').text();
          const idx = docText.search(/For\s+(Sale|Rent|Lease)\s*:/i);
          if (idx >= 0) {
            let s2 = docText.slice(idx).replace(/^[^:]*:\s*/i, '');
            s2 = s2.split('|')[0];
            s2 = s2.replace(/\s*\(Ref:.*$/i, '');
            s2 = s2.replace(/\s*[-–—]\s*(NGN|USD|GBP|EUR)?\s*[₦$€£]?\s*[0-9.,]+.*$/i, '');
            s2 = s2.replace(/\s+/g, ' ').replace(/^\s*,\s*/, '').trim();
            s2 = s2.replace(/,\s*Nigeria\s*$/i, '').trim();
            // Optional drop of first segment if it's a title-like phrase
            const parts2 = s2.split(',').map(s => s.trim()).filter(Boolean);
            if (parts2.length >= 2) {
              const first2 = parts2[0].toLowerCase();
              const looksLikeTitle2 = /(bed\s*rooms?|bedroom|bath\s*rooms?|bathroom|toilet|sqm|mansion|duplex|apartment|flat|bungalow|land|plot|detached|semi|terrace|storey|storeyed|office|shop|warehouse|luxury|brand\s*new|new|fitted)/i.test(first2);
              if (looksLikeTitle2) s2 = parts2.slice(1).join(', ');
            }
            if (s2 && s2.length >= 3) docAddr = s2;
          }
        } catch { /* ignore */ }
        if (docAddr) {
          const better2 = !addressLockedFromTag && (scoreAddr(docAddr) > scoreAddr(address_line1));
          if (better2) address_line1 = docAddr;
        } else {
        // Secondary fallback: parse inline script var address = "...";
        let scriptAddr: string | null = null;
        $('script').each((_i: number, el: any) => {
          const txt = $(el).contents().text();
          const mm = txt && txt.match(/\bvar\s+address\s*=\s*["']([^"']+)["']/i);
          if (mm && mm[1] && !scriptAddr) {
            let s = mm[1];
            s = s.replace(/^\s*,\s*/, '');
            s = s.replace(/,\s*Nigeria\s*$/i, '');
            s = s.replace(/\s+/g, ' ').trim();
            if (s && s.length >= 3) scriptAddr = s;
          }
        });
        if (scriptAddr) {
          const better3 = !addressLockedFromTag && (scoreAddr(scriptAddr) > scoreAddr(address_line1));
          if (better3) address_line1 = scriptAddr;
        }
        }
      }
    } catch { /* ignore */ }

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

    // Listed/Updated dates (robust)
    // Helper: read labelled values from table cells like "<strong>Added On:</strong> 26 Dec 2024"
    const readLabeledFromTables = (labels: string[]): string | null => {
      let found: string | null = null;
      $('table tr td').each((_i, td) => {
        if (found) return;
        const strong = $(td).find('strong').first();
        const lab = strong.text().trim().replace(/:$/, '');
        if (!lab) return;
        for (const want of labels) {
          if (new RegExp(`^${want}$`, 'i').test(lab)) {
            // Value is the td text without the strong label
            const value = $(td).clone().find('strong').remove().end().text().replace(/\s+/g, ' ').trim().replace(/^:\s*/, '');
            if (value) { found = value; }
            break;
          }
        }
      });
      return found;
    };
    const metaPublished = $('meta[itemprop="datePublished"]').attr('content')
      || $('meta[property="article:published_time"]').attr('content')
      || $('meta[name="date"]').attr('content')
      || $('time[itemprop="datePublished"]').attr('datetime')
      || null;
    const metaModified = $('meta[itemprop="dateModified"]').attr('content')
      || $('meta[property="article:modified_time"]').attr('content')
      || $('meta[name="last-modified"]').attr('content')
      || $('time[itemprop="dateModified"]').attr('datetime')
      || null;
    // Prefer JSON-LD, then meta/time, then visible text patterns
    let listedAt = jsonDatePublished
      || metaPublished
      || $('time[datetime]').first().attr('datetime')
      || null;
    let listingUpdatedAt = jsonDateModified || metaModified || null;
    // Table-labelled dates (higher confidence than arbitrary body text)
    if (!listedAt) {
      const tVal = readLabeledFromTables(['Added On', 'Date Added', 'Added']);
      if (tVal) {
        const d = new Date(tVal);
        if (!isNaN(d.getTime())) listedAt = d.toISOString();
      }
    }
    if (!listingUpdatedAt) {
      const uVal = readLabeledFromTables(['Last Updated', 'Updated On', 'Modified On']);
      if (uVal) {
        const d = new Date(uVal);
        if (!isNaN(d.getTime())) listingUpdatedAt = d.toISOString();
      }
    }
    // Expand text-based extraction for listedAt
    if (!listedAt) {
      // Try visible date containers first
      const dateSelText = pickText($('.date-posted, .listed-date, .date, .post-date, .added-on, .added, .meta-date'));
      if (dateSelText) {
        const m = dateSelText.match(/(\d{1,2}\s*[A-Za-z]{3,9}\s*\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m && m[0]) {
          const d = new Date(m[0]);
          if (!isNaN(d.getTime())) listedAt = d.toISOString();
        }
      }
      if (!listedAt) {
        const m = bodyText.match(/(?:Added|Date\s*Added|Posted|Posted\s*On|Published\s*On|Listed\s*On)\s*:??\s*([^\n|]+)/i);
        if (m && m[1]) {
          const d = new Date(m[1].trim());
          if (!isNaN(d.getTime())) listedAt = d.toISOString();
        }
      }
    }
    // Expand text-based extraction for listingUpdatedAt
    if (!listingUpdatedAt) {
      const upd = bodyText.match(/(?:Last\s*Updated|Updated\s*On|Modified\s*On)\s*:??\s*([^\n|]+)/i);
      if (upd && upd[1]) {
        const d = new Date(upd[1].trim());
        if (!isNaN(d.getTime())) listingUpdatedAt = d.toISOString();
      }
    }

    // Currency: use exactly what listing shows; NPC is NGN, but detect symbols explicitly
    let currency: string = 'NGN';
    try {
      const priceLabel = pickText($('.price, .price-label, [itemprop="price"], .amount')) || bodyText;
      if (/₦|\bNGN\b|naira/i.test(String(priceLabel))) currency = 'NGN';
    } catch { /* default NGN */ }

    return {
      external_id,
      url,
      title,
      description: $('meta[name="description"]').attr('content') || null,
      price: priceNum,
      currency,
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
      listing_updated_at: listingUpdatedAt || null,
      is_active: true,
      raw: { source: 'NigeriaPropertyCentre', url }
    };
  }
}
