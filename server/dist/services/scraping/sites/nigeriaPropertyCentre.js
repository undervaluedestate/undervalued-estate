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
        // Load the HTML with Cheerio
        const $ = cheerio.load(html);
        // Debug: Log the URL being processed
        console.log(`\n===== NPC Scraper Debug =====`);
        console.log(`[1/4] Starting parse for URL: ${url}`);
        console.log(`[2/4] Page title: ${$('title').text().trim() || 'No title found'}`);
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
        let postal_code = null;
        let latitude = null;
        let longitude = null;
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
        addressElements.each((index, element) => {
            const text = $(element).text().trim();
            console.log(`  - Element ${index + 1} (${element.tagName}${element.attribs?.class ? '.' + element.attribs.class.split(' ').join('.') : ''}): ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
            // If this looks like a good address, use it as a fallback
            if (text.length > 10 && !address_line1 && /\d/.test(text) && /[a-z]/i.test(text)) {
                console.log(`  - Using as potential address: ${text}`);
                address_line1 = text;
            }
        });
        // Try multiple strategies to get the most complete address
        const addressSources = [
            // 1. Check for <address> element first (common pattern)
            () => {
                const el = $('address').first();
                if (el.length) {
                    // Get all text content including nested elements
                    return el.text()
                        .replace(/\s+/g, ' ')
                        .replace(/[\n\t]/g, ' ')
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
                    if (text && text.length > 5)
                        return text;
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
                }
                catch { }
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
                        if (q)
                            return q;
                        // Try to extract from path segments
                        const pathSegs = url.pathname.split('/').filter(Boolean);
                        const placeIdx = pathSegs.indexOf('place');
                        if (placeIdx >= 0 && pathSegs[placeIdx + 1]) {
                            return decodeURIComponent(pathSegs[placeIdx + 1].replace(/\+/g, ' '));
                        }
                    }
                    catch { }
                }
                return null;
            },
            // 6. Look for any element with address-like text
            () => {
                const candidates = $('*:contains("road"), *:contains("street"), *:contains("avenue"), *:contains("close"), *:contains("drive"), *:contains("way"), *:contains("estate"), *:contains("villa"), *:contains("house"), *:contains("apartment"), *:contains("flat")');
                for (let i = 0; i < Math.min(candidates.length, 20); i++) {
                    const text = $(candidates[i]).text().trim();
                    if (text.length > 10 && /\d/.test(text) && /[a-z]/i.test(text)) {
                        return text.replace(/[\s\n]+/g, ' ').trim();
                    }
                }
                return null;
            }
        ];
        // Try each source until we find a good address
        const sourceNames = [
            'address element',
            'common address containers',
            'meta tags',
            'JSON-LD data',
            'Google Maps links',
            'address-like text'
        ];
        for (let i = 0; i < addressSources.length; i++) {
            try {
                const result = addressSources[i]();
                console.log(`[NPC Scraper] Trying source '${sourceNames[i]}':`, result || 'No result');
                if (result && result.length > 10) {
                    address_line1 = result;
                    console.log('[NPC Scraper] Selected address:', address_line1);
                    break;
                }
            }
            catch (e) {
                console.error(`[NPC Scraper] Error in source '${sourceNames[i]}':`, e);
                // Continue to next source
            }
        }
        if (!address_line1) {
            console.warn('[NPC Scraper] No valid address found using any method');
        }
        // Then try common selectors as fallback
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
            if (t && t.length >= 3) {
                address_line1 = t;
                break;
            }
        }
        // Try to read Address from common detail rows: name/value list items
        if (!address_line1) {
            const detailRows = $('.property-details li, .details li, .key-details li, .facts li').toArray();
            for (const li of detailRows) {
                const name = $(li).find('.name, .label, .title').text().trim().toLowerCase();
                const val = $(li).find('.value, .text').text().trim();
                if (!val || val.length < 3)
                    continue;
                if (name.includes('address') || name.includes('location') || name.includes('street') || name.includes('estate')) {
                    address_line1 = val;
                    break;
                }
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
        // Location from breadcrumb (do this before JSON-LD so composed address can include these)
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
        // JSON-LD PostalAddress + geo (after we have city/state/neighborhood)
        try {
            $('script[type="application/ld+json"]').each((_idx, el) => {
                const txt = $(el).contents().text();
                if (!txt || txt.length < 2)
                    return;
                try {
                    const data = JSON.parse(txt);
                    const walk = (node) => {
                        if (!node)
                            return;
                        if (typeof node === 'object') {
                            const maybeAddr = (node.address && typeof node.address === 'object') ? node.address : (node['@type'] === 'PostalAddress' ? node : null);
                            if (maybeAddr) {
                                const street = maybeAddr.streetAddress || maybeAddr.address1 || maybeAddr.addressLine1 || null;
                                const locality = maybeAddr.addressLocality || maybeAddr.locality || maybeAddr.city || city || null;
                                const region = maybeAddr.addressRegion || maybeAddr.region || maybeAddr.state || state || null;
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
                    }
                    else {
                        // Try to parse /place/<name>/ or path segments
                        const segs = u.pathname.split('/').filter(Boolean);
                        const placeIdx = segs.indexOf('place');
                        if (placeIdx >= 0 && segs[placeIdx + 1]) {
                            address_line1 = decodeURIComponent(segs[placeIdx + 1].replace(/\+/g, ' ')).trim();
                        }
                    }
                }
                catch { /* ignore */ }
            }
        }
        // Fallback: if we still lack a street/estate, compose a full address from available parts
        if (!address_line1) {
            const parts = [neighborhood, city, state, 'Nigeria'].filter(Boolean).map((s) => String(s).trim());
            if (parts.length)
                address_line1 = parts.join(', ');
        }
        // Fallback: if we still lack a street/estate, compose a full address from available parts
        if (!address_line1) {
            const parts = [neighborhood, city, state, 'Nigeria'].filter(Boolean).map((s) => String(s).trim());
            if (parts.length)
                address_line1 = parts.join(', ');
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
