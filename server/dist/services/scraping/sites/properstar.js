import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
function absUrl(href, base) {
    if (!href)
        return null;
    try {
        const u = new URL(href, base);
        return u.toString();
    }
    catch {
        return null;
    }
}
function pickText($el) {
    const t = $el.first().text().trim();
    return t ? t : null;
}
function guessCountryFromUrl(u) {
    const p = u.pathname.toLowerCase();
    if (p.includes('/united-kingdom/'))
        return 'United Kingdom';
    if (p.includes('/nigeria/'))
        return 'Nigeria';
    return null;
}
export class ProperstarAdapter extends BaseAdapter {
    getMeta() { return { name: 'Properstar' }; }
    async *discoverListingUrls(ctx) {
        const origin = new URL(ctx.source.base_url).origin;
        const listingBases = [
            // Country-level sale pages
            new URL('/united-kingdom/sale', ctx.source.base_url).toString(),
            new URL('/nigeria/sale', ctx.source.base_url).toString(),
            // Country roots to capture curated links (buy/rent and deep categories)
            new URL('/united-kingdom/', ctx.source.base_url).toString(),
            new URL('/nigeria/', ctx.source.base_url).toString(),
        ];
        const extraSeeds = (ctx.extra?.startUrls || []).filter(u => {
            try {
                return new URL(u).origin === origin;
            }
            catch {
                return false;
            }
        });
        // If any extra seeds are direct listing URLs, yield them immediately
        for (const u of extraSeeds) {
            try {
                const uu = new URL(u);
                if (uu.origin !== origin)
                    continue;
                if (uu.pathname.startsWith('/listing/'))
                    yield uu.toString();
            }
            catch { /* ignore */ }
        }
        // Include extra seeds as bases for category discovery as well
        const allBases = [...extraSeeds, ...listingBases];
        const maxPages = Math.max(1, ctx.maxPages || 1);
        for (const base of allBases) {
            // Load cursor for this seed (default next_page = 1)
            let nextPage = 1;
            try {
                const { data: cur } = await ctx.adminClient
                    .from('discovery_cursors')
                    .select('next_page')
                    .eq('seed_url', base)
                    .maybeSingle();
                if (cur && typeof cur.next_page === 'number' && cur.next_page > 0)
                    nextPage = cur.next_page;
            }
            catch { /* ignore */ }
            // Only crawl the nextPage for cursor-based steady progress
            const firstPage = nextPage;
            const lastPage = Math.max(firstPage, firstPage + (maxPages - 1));
            let yielded = 0;
            for (let page = firstPage; page <= lastPage; page++) {
                const listUrl = page === 1 ? base : `${base}?page=${page}`;
                ctx.log('List page', listUrl);
                const html = await ctx.http.getText(listUrl, ctx.requestTimeoutMs);
                const $ = cheerio.load(html);
                const candidates = [];
                // Properstar pages have many anchors; capture only listing detail links
                $([
                    'a[href*="/listing/"]',
                ].join(', ')).each((_, a) => {
                    const href = String($(a).attr('href') || '');
                    if (!href || href === '#' || href.startsWith('javascript:'))
                        return;
                    const abs = absUrl(href, base);
                    if (!abs)
                        return;
                    if (!abs.startsWith(origin))
                        return;
                    try {
                        const u = new URL(abs);
                        const segs = u.pathname.split('/').filter(Boolean);
                        // Accept explicit listing pages
                        if (u.pathname.startsWith('/listing/')) {
                            candidates.push(abs);
                            return;
                        }
                    }
                    catch { /* ignore */ }
                });
                // Also extract listing URLs from raw HTML/script via regex (handles client-rendered JSON-in-HTML cases)
                try {
                    const absListingRegex = /https?:\/\/www\.properstar\.co\.uk\/listing\/[A-Za-z0-9_-]+/g;
                    const relListingRegex = /\b\/listing\/[A-Za-z0-9_-]+/g;
                    const absMatches = html.match(absListingRegex) || [];
                    const relMatches = (html.match(relListingRegex) || []).map((m) => new URL(m, base).toString());
                    for (const m of [...absMatches, ...relMatches]) {
                        try {
                            const u = new URL(m);
                            if (u.origin === origin)
                                candidates.push(u.toString());
                        }
                        catch { /* ignore */ }
                    }
                }
                catch { /* ignore */ }
                // Enhanced: try to parse JSON from script tags to find embedded listing URLs
                try {
                    const urlsFromJson = [];
                    const pushIf = (s) => {
                        if (/\/listing\/[A-Za-z0-9_-]+/.test(s)) {
                            try {
                                const abs = new URL(s.startsWith('http') ? s : new URL(s, base).toString());
                                if (abs.origin === origin)
                                    urlsFromJson.push(abs.toString());
                            }
                            catch { /* ignore */ }
                        }
                    };
                    const walk = (node) => {
                        if (!node)
                            return;
                        if (typeof node === 'string') {
                            pushIf(node);
                            return;
                        }
                        if (Array.isArray(node)) {
                            node.forEach(walk);
                            return;
                        }
                        if (typeof node === 'object') {
                            Object.values(node).forEach(walk);
                            return;
                        }
                    };
                    $('script').each((_, el) => {
                        const txt = $(el).contents().text();
                        if (!txt || txt.length < 10)
                            return;
                        try {
                            const json = JSON.parse(txt);
                            walk(json);
                        }
                        catch {
                            // not pure JSON; ignore
                        }
                    });
                    for (const u of urlsFromJson)
                        candidates.push(u);
                }
                catch { /* ignore */ }
                const unique = Array.from(new Set(candidates.filter(u => /\/listing\//.test(u))));
                for (const u of unique) {
                    yielded++;
                    yield u;
                }
                // If no listings found on this page, stop early to avoid scraping empty lists
                if (unique.length === 0)
                    break;
            }
            // Update cursor to next page after processing
            try {
                await ctx.adminClient
                    .from('discovery_cursors')
                    .upsert({ seed_url: base, next_page: lastPage + 1, last_run_at: new Date().toISOString(), last_status: `yielded:${yielded}` }, { onConflict: 'seed_url' });
            }
            catch { /* ignore */ }
        }
    }
    async parseListing(ctx, html, url) {
        const $ = cheerio.load(html);
        const title = pickText($('h1, h1[itemprop="name"], h1.page-title')) || null;
        // Price + currency
        let priceNum = undefined;
        let currency = 'GBP';
        const priceSel = $('[itemprop="price"], .price, .listing-price, [class*="price" i]');
        const priceText = pickText(priceSel) || pickText($('meta[itemprop="priceCurrency"]').parent()) || pickText($('[data-testid="price"]'));
        if (priceText) {
            const numPart = (priceText.match(/[0-9,.]+/g) || [''])[0].replace(/[,]/g, '');
            const n = Number(numPart);
            if (Number.isFinite(n))
                priceNum = n;
            if (/₦|NGN/i.test(priceText))
                currency = 'NGN';
            if (/£|GBP/i.test(priceText))
                currency = 'GBP';
        }
        // External ID: prefer numeric id from /listing/<id>
        let external_id = url;
        try {
            const u = new URL(url);
            const m = u.pathname.match(/\/(?:listing)\/([A-Za-z0-9_-]+)/i);
            if (m && m[1])
                external_id = m[1];
        }
        catch { }
        // Location: try breadcrumb or meta
        let city = null;
        let state = null;
        let neighborhood = null;
        const bcParts = $('[class*="crumb" i] a, nav.breadcrumb a, .breadcrumbs a').map((_, a) => $(a).text().trim()).get().filter(Boolean);
        if (bcParts.length) {
            // Heuristic: [..., Region/State, City, Area]
            neighborhood = bcParts[bcParts.length - 1] || null;
            city = bcParts[bcParts.length - 2] || null;
            state = bcParts[bcParts.length - 3] || null;
        }
        // Derive country from URL when possible
        let country = null;
        try {
            country = guessCountryFromUrl(new URL(url));
        }
        catch { }
        if (!country)
            country = 'United Kingdom';
        // Address extraction: JSON-LD, microdata, and fallbacks
        let address_line1 = null;
        let address_line2 = null;
        let postal_code = null;
        let latitude = null;
        let longitude = null;
        let jsonDatePublished = null;
        let jsonDateModified = null;
        // Microdata and common selectors
        try {
            const streetText = pickText($('[itemprop="streetAddress"], .address, .listing-address, [data-testid="street-address"]'));
            if (streetText) {
                const parts = [streetText, neighborhood, city, state].filter(Boolean).map((s) => String(s).trim());
                if (parts.length)
                    address_line1 = parts.join(', ');
            }
        }
        catch { /* ignore */ }
        // JSON-LD scanning for PostalAddress, geo, and publish/modified dates
        try {
            $('script[type="application/ld+json"]').each((_, el) => {
                const txt = $(el).contents().text();
                if (!txt || txt.length < 2)
                    return;
                try {
                    const data = JSON.parse(txt);
                    const walk = (node) => {
                        if (!node)
                            return;
                        if (typeof node === 'object') {
                            if (!jsonDatePublished && typeof node.datePublished === 'string')
                                jsonDatePublished = node.datePublished;
                            if (!jsonDateModified && typeof node.dateModified === 'string')
                                jsonDateModified = node.dateModified;
                            const maybeAddr = (node.address && typeof node.address === 'object') ? node.address : (node['@type'] === 'PostalAddress' ? node : null);
                            if (maybeAddr) {
                                const street = maybeAddr.streetAddress || maybeAddr.address1 || maybeAddr.addressLine1 || null;
                                const locality = maybeAddr.addressLocality || maybeAddr.locality || maybeAddr.city || null;
                                const region = maybeAddr.addressRegion || maybeAddr.region || maybeAddr.state || null;
                                const pc = maybeAddr.postalCode || maybeAddr.postcode || maybeAddr.zipCode || null;
                                const neigh = maybeAddr.neighborhood || maybeAddr.addressNeighborhood || neighborhood || null;
                                const parts = [street, neigh, locality, region, pc].filter(Boolean).map((s) => String(s).trim());
                                if (!address_line1 && parts.length)
                                    address_line1 = parts.join(', ');
                                if (!postal_code && pc)
                                    postal_code = String(pc);
                            }
                            if (node.geo && typeof node.geo === 'object') {
                                const lat = Number(node.geo.latitude ?? node.geo.lat);
                                const lng = Number(node.geo.longitude ?? node.geo.lng);
                                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                                    latitude = lat;
                                    longitude = lng;
                                }
                            }
                            Object.values(node).forEach(walk);
                            return;
                        }
                    };
                    walk(data);
                }
                catch { /* ignore non-JSON */ }
            });
        }
        catch { /* ignore */ }
        // Fallback: compose from available parts if still missing
        if (!address_line1) {
            const parts = [neighborhood, city, state, country].filter(Boolean).map((s) => String(s).trim());
            if (parts.length)
                address_line1 = parts.join(', ');
        }
        // Bedrooms/Bathrooms
        const metaText = $('body').text();
        const bedMatch = metaText.match(/(\d+)\s*(bed|bedroom)s?/i);
        const bathMatch = metaText.match(/(\d+)\s*(bath|bathroom)s?/i);
        // Size
        const sizeMatch = metaText.match(/([0-9,.]+)\s*(sqm|m2|square\s*meters?)/i);
        // Listed/Updated dates (prefer JSON-LD, then meta/time tags, then text patterns)
        const metaPublished = $('meta[itemprop="datePublished"]').attr('content')
            || $('meta[property="article:published_time"]').attr('content')
            || $('time[itemprop="datePublished"]').attr('datetime')
            || null;
        const metaModified = $('meta[itemprop="dateModified"]').attr('content')
            || $('meta[property="article:modified_time"]').attr('content')
            || $('time[itemprop="dateModified"]').attr('datetime')
            || null;
        let listedAt = jsonDatePublished || metaPublished || $('time[datetime]').attr('datetime') || null;
        let listingUpdatedAt = jsonDateModified || metaModified || null;
        if (!listedAt) {
            const text = $('body').text();
            const addM = text.match(/(Added\s*On|Published\s*On|Listed\s*On)\s*:?:?\s*([^\n|]+)/i);
            if (addM && addM[2]) {
                const d = new Date(addM[2].trim());
                if (!isNaN(d.getTime()))
                    listedAt = d.toISOString();
            }
        }
        if (!listingUpdatedAt) {
            const text = $('body').text();
            const updM = text.match(/(Last\s*Updated|Updated\s*On)\s*:?:?\s*([^\n|]+)/i);
            if (updM && updM[2]) {
                const d = new Date(updM[2].trim());
                if (!isNaN(d.getTime()))
                    listingUpdatedAt = d.toISOString();
            }
        }
        // Images: JSON-LD, OpenGraph, visible elements
        let images = [];
        try {
            const seen = new Set();
            const push = (s) => {
                if (!s)
                    return;
                const t = String(s).trim();
                if (!t)
                    return;
                if (/^data:image\//i.test(t))
                    return;
                if (/sprite|icon|logo|placeholder|avatar|thumbs?/i.test(t))
                    return;
                try {
                    const abs = new URL(t, url).toString();
                    if (!seen.has(abs)) {
                        seen.add(abs);
                        images.push(abs);
                    }
                }
                catch { }
            };
            $('script[type="application/ld+json"]').each((_i, el) => {
                const txt = $(el).contents().text();
                if (!txt || txt.length < 2)
                    return;
                try {
                    const data = JSON.parse(txt);
                    const walk = (node) => {
                        if (!node)
                            return;
                        if (Array.isArray(node)) {
                            node.forEach(walk);
                            return;
                        }
                        if (typeof node === 'object') {
                            if (typeof node.image === 'string')
                                push(node.image);
                            if (Array.isArray(node.image))
                                node.image.forEach((v) => push(v));
                            if (node['@type'] === 'ImageObject' && typeof node.url === 'string')
                                push(node.url);
                            Object.values(node).forEach(walk);
                        }
                    };
                    walk(data);
                }
                catch { }
            });
            push($('meta[property="og:image"]').attr('content') || null);
            $('img[src], img[data-src], source[srcset]').each((_i, el) => {
                const $el = $(el);
                const src = $el.attr('src') || $el.attr('data-src') || '';
                const srcset = $el.attr('srcset') || '';
                push(src);
                if (srcset)
                    srcset.split(',').forEach(part => push(part.trim().split(' ')[0]));
            });
            if (images.length > 20)
                images = images.slice(0, 20);
        }
        catch { }
        // Currency: use exactly what listing shows. Prefer JSON-LD offers.priceCurrency; fallback to symbol detection.
        if (!currency) {
            // Try common JSON-LD patterns already parsed above (offers->priceCurrency). If not captured, infer from symbols.
            const priceLabel = pickText($('[data-testid="price"], .price, .pricetag, [itemprop="price"]')) || $('body').text();
            if (/£|GBP/i.test(String(priceLabel)))
                currency = 'GBP';
            else if (/₦|NGN|naira/i.test(String(priceLabel)))
                currency = 'NGN';
            else if (/€|EUR/i.test(String(priceLabel)))
                currency = 'EUR';
            else if (/\$|USD/i.test(String(priceLabel)))
                currency = 'USD';
            // Fallback by site TLD/context
            if (!currency) {
                try {
                    const u0 = new URL(url);
                    if (u0.hostname.endsWith('.co.uk'))
                        currency = 'GBP';
                }
                catch { /* ignore */ }
            }
        }
        return {
            external_id,
            url,
            title,
            description: $('meta[name="description"]').attr('content') || null,
            price: priceNum,
            currency,
            images,
            size: sizeMatch ? sizeMatch[0] : undefined,
            bedrooms: bedMatch ? Number(bedMatch[1]) : undefined,
            bathrooms: bathMatch ? Number(bathMatch[1]) : undefined,
            address_line1,
            address_line2,
            neighborhood: neighborhood || null,
            city,
            state,
            postal_code,
            country,
            latitude,
            longitude,
            listed_at: listedAt,
            listing_updated_at: listingUpdatedAt || null,
            is_active: true,
            raw: { url },
        };
    }
}
