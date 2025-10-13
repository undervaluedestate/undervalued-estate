import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
function absUrl(href, base) {
    if (!href)
        return null;
    try {
        return new URL(href, base).toString();
    }
    catch {
        return null;
    }
}
function pickText($el) {
    const t = $el.first().text().trim();
    return t || null;
}
export class PrimeLocationAdapter extends BaseAdapter {
    getMeta() { return { name: 'PrimeLocation' }; }
    async *discoverListingUrls(ctx) {
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
                }
                catch { /* ignore */ }
            }
            return seed;
        });
        for (const seed of seedsEff) {
            // Cursor-based discovery per seed
            let nextPage = 1;
            try {
                const { data: cur } = await ctx.adminClient
                    .from('discovery_cursors')
                    .select('next_page')
                    .eq('seed_url', seed)
                    .maybeSingle();
                if (cur && typeof cur.next_page === 'number' && cur.next_page > 0)
                    nextPage = cur.next_page;
            }
            catch { /* ignore */ }
            const firstPage = nextPage;
            const lastPage = Math.min(4, Math.max(firstPage, firstPage + (maxPages - 1))); // cap to first 4 pages
            let yielded = 0;
            for (let page = firstPage; page <= lastPage; page++) {
                let listUrl = seed;
                try {
                    const u = new URL(seed);
                    // PrimeLocation uses pn or page depending on context; preserve pn if present else set pn
                    if (!u.searchParams.get('pn'))
                        u.searchParams.set('pn', String(page));
                    else
                        u.searchParams.set('pn', String(page));
                    // Prefer newest listings if not already specified
                    if (!u.searchParams.get('results_sort'))
                        u.searchParams.set('results_sort', 'newest_listings');
                    // Add explicit search_source for WAF heuristics
                    const src = ctx.extra?.listingType === 'rent' ? 'to-rent' : 'for-sale';
                    if (!u.searchParams.get('search_source'))
                        u.searchParams.set('search_source', src);
                    listUrl = u.toString();
                }
                catch { }
                ctx.log('List page', listUrl);
                const html = await ctx.http.getText(listUrl, ctx.requestTimeoutMs);
                const $ = cheerio.load(html);
                const candidates = [];
                // Listing anchors typically contain /for-sale/details/ or /to-rent/details/
                $('a[href*="/details/"]').each((_, a) => {
                    const u = absUrl(String($(a).attr('href') || ''), listUrl);
                    if (!u)
                        return;
                    try {
                        const uu = new URL(u);
                        if (uu.origin !== origin)
                            return;
                        if (/\/details\//.test(uu.pathname))
                            candidates.push(uu.toString());
                    }
                    catch { /* ignore */ }
                });
                // Regex fallback for client-rendered cases
                try {
                    const absRe = /https?:\/\/www\.primelocation\.com\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
                    const relRe = /\b\/[A-Za-z0-9\-\/]*details\/[0-9]+/g;
                    const absMatches = html.match(absRe) || [];
                    const relMatches = (html.match(relRe) || []).map((m) => new URL(m, listUrl).toString());
                    for (const u of [...absMatches, ...relMatches]) {
                        try {
                            const uu = new URL(u);
                            if (uu.origin === origin)
                                candidates.push(uu.toString());
                        }
                        catch { }
                    }
                }
                catch { }
                const unique = Array.from(new Set(candidates));
                for (const u of unique) {
                    yielded++;
                    yield u;
                }
                if (unique.length === 0)
                    break;
            }
            // Wrap to page 1 after hitting page 4
            const nextAfter = lastPage >= 4 ? 1 : (lastPage + 1);
            try {
                await ctx.adminClient
                    .from('discovery_cursors')
                    .upsert({ seed_url: seed, next_page: nextAfter, last_run_at: new Date().toISOString(), last_status: `yielded:${yielded}` }, { onConflict: 'seed_url' });
            }
            catch { /* ignore */ }
        }
    }
    async parseListing(ctx, html, url) {
        const $ = cheerio.load(html);
        const title = pickText($('h1')) || pickText($('meta[property="og:title"]')) || null;
        // Price
        let price = undefined;
        const priceText = pickText($('[data-testid="price"], .price, [itemprop="price"]'))
            || $('meta[property="og:price:amount"]').attr('content')
            || null;
        if (priceText) {
            const num = Number(String(priceText).match(/[0-9,.]+/g)?.[0]?.replace(/,/g, ''));
            if (Number.isFinite(num))
                price = num;
        }
        let currency = 'GBP';
        const bodyText = $('body').text();
        if (/₦|NGN/i.test(String(priceText) + bodyText))
            currency = 'NGN';
        if (/£|GBP/i.test(String(priceText) + bodyText))
            currency = 'GBP';
        if (/€|EUR/i.test(String(priceText) + bodyText))
            currency = 'EUR';
        if (/\$|USD/i.test(String(priceText) + bodyText))
            currency = 'USD';
        try {
            const u0 = new URL(url);
            if (u0.hostname.endsWith('.co.uk'))
                currency = 'GBP';
        }
        catch { }
        // External ID from URL like /details/XXXXXXX
        let external_id = url;
        try {
            const u = new URL(url);
            const m = u.pathname.match(/\/details\/(\d+)/i);
            if (m && m[1])
                external_id = m[1];
        }
        catch { }
        // Address & geo via JSON-LD if present
        let address_line1 = null;
        let address_line2 = null;
        let postal_code = null;
        let latitude = null;
        let longitude = null;
        let listed_at = null;
        let listing_updated_at = null;
        try {
            $('script[type="application/ld+json"]').each((_i, el) => {
                const txt = $(el).contents().text();
                if (!txt || txt.length < 5)
                    return;
                try {
                    const data = JSON.parse(txt);
                    const walk = (node) => {
                        if (!node)
                            return;
                        if (typeof node === 'object') {
                            if (typeof node.datePublished === 'string' && !listed_at)
                                listed_at = node.datePublished;
                            if (typeof node.dateModified === 'string' && !listing_updated_at)
                                listing_updated_at = node.dateModified;
                            const addr = node.address && typeof node.address === 'object' ? node.address : (node['@type'] === 'PostalAddress' ? node : null);
                            if (addr) {
                                const street = addr.streetAddress || addr.address1 || addr.addressLine1 || null;
                                const locality = addr.addressLocality || addr.locality || addr.city || null;
                                const region = addr.addressRegion || addr.region || addr.state || null;
                                const pc = addr.postalCode || addr.postcode || addr.zipCode || null;
                                const parts = [street, locality, region].filter(Boolean).map((s) => String(s).trim());
                                if (parts.length && !address_line1)
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
                        }
                    };
                    walk(data);
                }
                catch { }
            });
        }
        catch { }
        // Address fallback from visible selectors
        if (!address_line1) {
            const addrSel = pickText($('address, [data-testid="address"], .property-address, .css-16jl9ur-Text, .css-10klw3m-Text'));
            if (addrSel)
                address_line1 = addrSel.replace(/\s+/g, ' ').trim();
        }
        // Breadcrumbs -> neighborhood/city/state
        let city = null;
        let state = null;
        let neighborhood = null;
        const crumbs = $('[class*="crumb" i] a, nav.breadcrumb a, .breadcrumbs a').map((_, a) => $(a).text().trim()).get().filter(Boolean);
        if (crumbs.length) {
            neighborhood = crumbs[crumbs.length - 1] || null;
            city = crumbs[crumbs.length - 2] || null;
            state = crumbs[crumbs.length - 3] || null;
        }
        const country = 'United Kingdom';
        // Images: JSON-LD, OpenGraph, visible <img>/<source>
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
                if (!txt || txt.length < 5)
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
            raw: { source: 'PrimeLocation', url },
        };
    }
}
