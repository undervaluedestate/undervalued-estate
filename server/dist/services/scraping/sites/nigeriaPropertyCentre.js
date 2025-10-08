import * as cheerio from 'cheerio';
import { BaseAdapter } from '../baseAdapter';
function absUrl(href, base) {
    if (!href)
        return null;
    try {
        // Ensure absolute URL and same-origin normalization
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
// Nigeria Property Centre adapter with deterministic selectors
export class NigeriaPropertyCentreAdapter extends BaseAdapter {
    getMeta() { return { name: 'NigeriaPropertyCentre' }; }
    async *discoverListingUrls(ctx) {
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
                const candidates = [];
                // Broader selectors. NPC detail URLs typically include '/for-sale/' path as well.
                $([
                    'ul.property-list li a[href]',
                    '.property-list .property a[href]',
                    'a[title][href*="/for-sale/"]',
                    'a[href*="/for-sale/"]',
                    'a[href*="/property/"]',
                ].join(', ')).each((_, a) => {
                    const href = String($(a).attr('href') || '');
                    // Skip obvious nav/self links
                    if (!href || href === '#' || href.startsWith('javascript:'))
                        return;
                    const abs = absUrl(href, base);
                    if (!abs)
                        return;
                    if (!abs.startsWith(origin))
                        return;
                    // Heuristic: likely detail pages contain '/for-sale/' and at least one more segment
                    try {
                        const u = new URL(abs);
                        const segs = u.pathname.split('/').filter(Boolean);
                        if (!u.pathname.includes('/for-sale/'))
                            return;
                        if (segs.length < 3)
                            return; // avoid very shallow category pages
                        candidates.push(abs);
                    }
                    catch { /* ignore */ }
                });
                const unique = Array.from(new Set(candidates));
                for (const u of unique)
                    yield u;
            }
        }
    }
    async parseListing(ctx, html, url) {
        const $ = ctx.cheerio.load(html);
        // Listing type from URL path
        let listing_type = 'buy';
        try {
            const u = new URL(url);
            if (/\/for-rent\//i.test(u.pathname))
                listing_type = 'rent';
            else if (/\/for-sale\//i.test(u.pathname))
                listing_type = 'buy';
        }
        catch { /* default to buy */ }
        // Title selectors
        const title = pickText($('h1.property-title, h1[itemprop="name"], h1.title, h1')) || null;
        // Address line 1 (estate / street)
        let address_line1 = null;
        const addrCandidates = [
            '.address',
            '.property-address',
            'span[itemprop="streetAddress"]',
            '.property-details .value:contains("Estate"), .property-details .value:contains("Address")',
            '.breadcrumb li:nth-last-child(3) a',
        ];
        for (const sel of addrCandidates) {
            const t = pickText($(sel));
            if (t && t.length >= 3 && !/lekki|lagos|nigeria/i.test(t)) {
                address_line1 = t;
                break;
            }
        }
        // Price selectors
        const priceText = pickText($('#price, .price, .property-price, [class*="price" i]'));
        const priceNum = priceText ? Number((priceText.match(/[0-9,.]+/g) || [''])[0].replace(/[,]/g, '')) : undefined;
        // External ID from URL slug
        let external_id;
        try {
            const u = new URL(url);
            const parts = u.pathname.split('/').filter(Boolean);
            // often ends with numeric slug; fallback to full url
            external_id = parts[parts.length - 1] || url;
        }
        catch {
            external_id = url;
        }
        // Location from breadcrumb
        let city = null;
        let state = null;
        let neighborhood = null;
        const bcParts = $('.breadcrumb li, nav.breadcrumb li, [class*="breadcrumb" i] li').map((_i, li) => $(li).text().trim()).get().filter(Boolean);
        if (bcParts.length) {
            // Heuristic: [..., State, City, Neighborhood] or similar ordering
            neighborhood = bcParts[bcParts.length - 1] || null;
            city = bcParts[bcParts.length - 2] || null;
            state = bcParts[bcParts.length - 3] || null;
            // Normalize obvious noise
            if (city && /home|for\s*sale/i.test(city))
                city = null;
            if (state && /home|for\s*sale/i.test(state))
                state = null;
            if (neighborhood && /home|for\s*sale/i.test(neighborhood))
                neighborhood = null;
        }
        // Property meta lists
        const metaLis = $('.property-meta li, .facts li, ul.meta li').map((_i, li) => $(li).text().trim()).get();
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
            postal_code: null,
            listing_type,
            country: 'Nigeria',
            latitude: null,
            longitude: null,
            listed_at: listedAt,
            is_active: true,
            raw: { source: 'NigeriaPropertyCentre', url }
        };
    }
}
