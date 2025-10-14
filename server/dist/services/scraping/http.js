import axios from 'axios';
export const http = axios.create({
    timeout: 30000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        // Client Hints / Fetch metadata often checked by WAFs
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-CH-UA': '"Not.A/Brand";v="8", "Chromium";v="127", "Google Chrome";v="127"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"macOS"',
    },
    validateStatus: (s) => !!s && s >= 200 && s < 400,
});
export async function getText(url, timeoutMs) {
    let referer;
    try {
        referer = new URL(url).origin;
    }
    catch { /* ignore */ }
    try {
        const resp = await http.get(url, {
            timeout: timeoutMs ?? http.defaults.timeout,
            headers: referer ? { Referer: referer } : undefined,
        });
        return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    }
    catch (err) {
        const status = err?.response?.status;
        if (status) {
            // eslint-disable-next-line no-console
            console.warn('[http.getText] direct fetch failed', { url, status });
        }
        else {
            // eslint-disable-next-line no-console
            console.warn('[http.getText] direct fetch error (no status)', { url, error: err?.message || String(err) });
        }
        try {
            const u = new URL(url);
            const isPrimeLocation = /(^|\.)primelocation\.com$/i.test(u.hostname);
            const proxy = process.env.PRIMELOCATION_PROXY_URL;
            const apiSecret = process.env.API_SECRET;
            const shouldProxy = isPrimeLocation && proxy && apiSecret && (!status || status === 403 || status === 401 || status === 429);
            if (shouldProxy) {
                const proxied = new URL(proxy);
                proxied.searchParams.set('url', url);
                // eslint-disable-next-line no-console
                console.log('[http.getText] proxy fallback engaged for PrimeLocation', { target: url, proxy: proxied.toString() });
                const resp2 = await http.get(proxied.toString(), {
                    timeout: timeoutMs ?? http.defaults.timeout,
                    headers: {
                        ...(referer ? { Referer: referer } : {}),
                        Authorization: `Bearer ${apiSecret}`,
                    },
                });
                // eslint-disable-next-line no-console
                console.log('[http.getText] proxy response', { status: resp2?.status });
                return typeof resp2.data === 'string' ? resp2.data : JSON.stringify(resp2.data);
            }
        }
        catch { /* fall through */ }
        throw err;
    }
}
// Simple in-memory FX cache (per process invocation)
const fxCache = new Map();
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export async function getFxRate(from, to) {
    const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
    const now = Date.now();
    const cached = fxCache.get(key);
    if (cached && now - cached.ts < FX_TTL_MS)
        return cached.rate;
    // Use exchangerate.host (no key required)
    const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
    const resp = await axios.get(url, { timeout: 10000, validateStatus: (s) => !!s && s >= 200 && s < 400 });
    const rate = resp?.data?.rates?.[to.toUpperCase()];
    if (typeof rate === 'number' && isFinite(rate)) {
        fxCache.set(key, { rate, ts: now });
        return rate;
    }
    throw new Error(`FX rate not available for ${from}->${to}`);
}
