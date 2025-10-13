// Cloudflare Worker: PrimeLocation UK (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type Region = { name: string; startUrls: string[] };

// Start small: top UK cities including the user-provided Aberdeen seed
const PRIMELOCATION_UK: Region[] = [
  { name: 'Aberdeen', startUrls: ['https://www.primelocation.com/for-sale/property/aberdeen/?q=Aberdeen&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Glasgow', startUrls: ['https://www.primelocation.com/for-sale/property/glasgow/?q=Glasgow&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Edinburgh', startUrls: ['https://www.primelocation.com/for-sale/property/edinburgh/?q=Edinburgh&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'London', startUrls: ['https://www.primelocation.com/for-sale/property/london/?q=London&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Manchester', startUrls: ['https://www.primelocation.com/for-sale/property/manchester/?q=Manchester&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Birmingham', startUrls: ['https://www.primelocation.com/for-sale/property/birmingham/?q=Birmingham&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Leeds', startUrls: ['https://www.primelocation.com/for-sale/property/leeds/?q=Leeds&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Liverpool', startUrls: ['https://www.primelocation.com/for-sale/property/liverpool/?q=Liverpool&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Bristol', startUrls: ['https://www.primelocation.com/for-sale/property/bristol/?q=Bristol&results_sort=newest_listings&search_source=for-sale&pn=1'] },
  { name: 'Sheffield', startUrls: ['https://www.primelocation.com/for-sale/property/sheffield/?q=Sheffield&results_sort=newest_listings&search_source=for-sale&pn=1'] }
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/proxy') return new Response('Not Found', { status: 404 });
      const authHeader = request.headers.get('authorization') || '';
      const token = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : (url.searchParams.get('token') || '');
      if (!env.API_SECRET || token !== env.API_SECRET) {
        return new Response('Unauthorized', { status: 401 });
      }
      const target = url.searchParams.get('url');
      if (!target) return new Response('Missing url', { status: 400 });
      let t: URL;
      try { t = new URL(target); } catch { return new Response('Bad url', { status: 400 }); }
      if (t.hostname !== 'www.primelocation.com') return new Response('Forbidden', { status: 403 });
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      };
      const resp = await fetch(t.toString(), { method: 'GET', headers });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: { 'content-type': resp.headers.get('content-type') || 'text/html; charset=UTF-8' },
      });
    } catch (e: any) {
      return new Response(`Proxy error: ${e?.message || 'unknown'}`, { status: 500 });
    }
  },
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const runId = `cf-primelocation-uk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}`, 'X-Run-Id': runId } as const;

    // Alternate buy/rent every 15 minutes (Europe/London, DST-aware)
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? now.getUTCMinutes());
    const doRent = (minute % 30) >= 15;

    // Helper: chunk list
    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);

    // For rent windows, flip the path and search_source param
    const regionsEff: Region[] = PRIMELOCATION_UK.map(r => {
      if (!doRent) return r;
      return {
        name: r.name,
        startUrls: r.startUrls.map(u => {
          try {
            const url = new URL(u);
            url.pathname = url.pathname.replace('/for-sale/', '/to-rent/');
            if (url.searchParams.get('search_source')) url.searchParams.set('search_source', 'to-rent');
            return url.toString();
          } catch { return u; }
        })
      };
    });

    const groups = chunk(regionsEff, 10);

    // Quick health: ensure API responds 202 with respondQuick
    try {
      const healthBody = {
        adapterName: 'PrimeLocation',
        respondQuick: true,
        maxPages: 1,
        maxUrls: 0,
        concurrency: 1,
        requestTimeoutMs: 2000,
        discoveryTimeoutMs: 2000,
      };
      const healthRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(healthBody) });
      const healthTxt = await healthRes.text();
      console.log(`[primelocation-uk-worker] health:`, healthRes.status, healthTxt.slice(0, 120));
    } catch (e: any) {
      console.log('[primelocation-uk-worker] health failed', e?.message || e);
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'PrimeLocation',
        regions: group,
        regionConcurrency: 6,
        concurrency: 2,
        maxPages: 4,
        maxUrls: 30,
        requestTimeoutMs: 18000,
        discoveryTimeoutMs: 12000,
        listingType: doRent ? 'rent' : 'buy',
        respondQuick: true
      } as const;
      const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(`[primelocation-uk-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
      // jitter 100–400ms to reduce lock contention at cron edges
      await sleep(100 + Math.floor(Math.random()*300));
    }

    try {
      // Post-run health
      try {
        const h = await fetch(`${API_URL}/api/health`, { method: 'GET', headers });
        const ht = await h.text();
        console.log('[primelocation-uk-worker] post-run health:', h.status, ht.slice(0, 120));
      } catch (e: any) {
        console.log('[primelocation-uk-worker] post-run health failed', e?.message || e);
      }
      // jitter before benchmarks
      await sleep(100 + Math.floor(Math.random()*300));
      await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      // jitter before alerts
      await sleep(100 + Math.floor(Math.random()*300));
      await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
    } catch {}
  }
};
