// Cloudflare Worker: Zoopla UK (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type Region = { name: string; startUrls: string[] };

// Prefilled key cities; add more as needed
const ZOOPLA_UK: Region[] = [
  { name: 'Aberdeen', startUrls: ['https://www.zoopla.co.uk/for-sale/property/aberdeen/?q=aberdeen&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Glasgow', startUrls: ['https://www.zoopla.co.uk/for-sale/property/glasgow/?q=glasgow&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Edinburgh', startUrls: ['https://www.zoopla.co.uk/for-sale/property/edinburgh/?q=edinburgh&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'London', startUrls: ['https://www.zoopla.co.uk/for-sale/property/london/?q=london&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Manchester', startUrls: ['https://www.zoopla.co.uk/for-sale/property/manchester/?q=manchester&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Birmingham', startUrls: ['https://www.zoopla.co.uk/for-sale/property/birmingham/?q=birmingham&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Leeds', startUrls: ['https://www.zoopla.co.uk/for-sale/property/leeds/?q=leeds&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Liverpool', startUrls: ['https://www.zoopla.co.uk/for-sale/property/liverpool/?q=liverpool&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Bristol', startUrls: ['https://www.zoopla.co.uk/for-sale/property/bristol/?q=bristol&search_source=home&results_sort=newest_listings&pn=1'] },
  { name: 'Sheffield', startUrls: ['https://www.zoopla.co.uk/for-sale/property/sheffield/?q=sheffield&search_source=home&results_sort=newest_listings&pn=1'] }
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const runId = `cf-zoopla-uk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}`, 'X-Run-Id': runId } as const;

    // Alternate buy/rent every 15 minutes
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? now.getUTCMinutes());
    const doRent = (minute % 30) >= 15;

    // Helper: chunk list to keep each API call short
    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const regionsEff = ZOOPLA_UK.map(r => doRent ? ({ name: r.name, startUrls: r.startUrls.map(u => u.replace('/for-sale/', '/to-rent/')) }) : r);
    const groups = chunk(regionsEff, 10);

    // Quick health: ensure API responds 202 with respondQuick
    try {
      const healthBody = {
        adapterName: 'Zoopla',
        respondQuick: true,
        maxPages: 1,
        maxUrls: 0,
        concurrency: 1,
        requestTimeoutMs: 2000,
        discoveryTimeoutMs: 2000,
      };
      const healthRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(healthBody) });
      const healthTxt = await healthRes.text();
      console.log(`[zoopla-uk-worker] health:`, healthRes.status, healthTxt.slice(0, 120));
    } catch (e: any) {
      console.log('[zoopla-uk-worker] health failed', e?.message || e);
    }

    // Orchestrate PrimeLocation BUY runs during buy windows (no separate cron)
    if (!doRent) {
      try {
        const nap = (ms: number) => new Promise(r => setTimeout(r, ms));
        const PRIME_REGIONS: Region[] = [
          { name: 'Aberdeen', startUrls: ['https://www.primelocation.com/for-sale/property/aberdeen/?q=Aberdeen&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Glasgow', startUrls: ['https://www.primelocation.com/for-sale/property/glasgow/?q=Glasgow&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Edinburgh', startUrls: ['https://www.primelocation.com/for-sale/property/edinburgh/?q=Edinburgh&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'London', startUrls: ['https://www.primelocation.com/for-sale/property/london/?q=London&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Manchester', startUrls: ['https://www.primelocation.com/for-sale/property/manchester/?q=Manchester&results_sort=newest_listings&search_source=for-sale&pn=1'] }
        ];
        const primeGroups = chunk(PRIME_REGIONS, 10);
        for (const [pi, group] of primeGroups.entries()) {
          const body = {
            adapterName: 'PrimeLocation',
            regions: group,
            regionConcurrency: 6,
            concurrency: 2,
            maxPages: 4,
            maxUrls: 30,
            requestTimeoutMs: 18000,
            discoveryTimeoutMs: 12000,
            listingType: 'buy',
            respondQuick: true
          } as const;
          const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
          const txt = await res.text();
          console.log(`[zoopla-uk-worker][orchestrate] PrimeLocation BUY group ${pi+1}/${primeGroups.length}:`, res.status, txt.slice(0, 200));
          await nap(100 + Math.floor(Math.random()*300));
        }
      } catch (e: any) {
        console.log('[zoopla-uk-worker][orchestrate] PrimeLocation buy failed', e?.message || e);
      }
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'Zoopla',
        regions: group,
        regionConcurrency: 6,
        concurrency: 2,
        maxPages: 4,
        maxUrls: 30,
        requestTimeoutMs: 18000,
        discoveryTimeoutMs: 12000,
        listingType: doRent ? 'rent' : 'buy',
        respondQuick: true
      };
      const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(`[zoopla-uk-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
      // jitter 100–400ms to reduce lock contention at cron edges
      await sleep(100 + Math.floor(Math.random()*300));
    }

    // If this invocation is a rent window, orchestrate daily rent sweeps for other adapters centrally
    if (doRent) {
      try {
        // PrimeLocation daily rent sweep using a small region set
        const PRIME_REGIONS: Region[] = [
          { name: 'Aberdeen', startUrls: ['https://www.primelocation.com/for-sale/property/aberdeen/?q=Aberdeen&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Glasgow', startUrls: ['https://www.primelocation.com/for-sale/property/glasgow/?q=Glasgow&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Edinburgh', startUrls: ['https://www.primelocation.com/for-sale/property/edinburgh/?q=Edinburgh&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'London', startUrls: ['https://www.primelocation.com/for-sale/property/london/?q=London&results_sort=newest_listings&search_source=for-sale&pn=1'] },
          { name: 'Manchester', startUrls: ['https://www.primelocation.com/for-sale/property/manchester/?q=Manchester&results_sort=newest_listings&search_source=for-sale&pn=1'] }
        ];
        const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
        const primeGroups = chunk(PRIME_REGIONS, 10);
        for (const [pi, group] of primeGroups.entries()) {
          const body = {
            adapterName: 'PrimeLocation',
            regions: group,
            regionConcurrency: 6,
            concurrency: 2,
            maxPages: 4,
            maxUrls: 30,
            requestTimeoutMs: 18000,
            discoveryTimeoutMs: 12000,
            listingType: 'rent',
            respondQuick: true
          } as const;
          const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
          const txt = await res.text();
          console.log(`[zoopla-uk-worker][orchestrate] PrimeLocation RENT group ${pi+1}/${primeGroups.length}:`, res.status, txt.slice(0, 200));
          await sleep(100 + Math.floor(Math.random()*300));
        }
      } catch (e: any) {
        console.log('[zoopla-uk-worker][orchestrate] PrimeLocation rent failed', e?.message || e);
      }

      try {
        // NigeriaPropertyCentre daily rent sweep (reduced to Lagos & Abuja)
        const NPC_REGIONS = [
          { name: 'Lagos', paths: ['/for-sale/flats-apartments/lagos/'] },
          { name: 'Abuja', paths: ['/for-sale/flats-apartments/abuja/'] },
        ];
        const body = {
          adapterName: 'NigeriaPropertyCentre',
          regions: NPC_REGIONS,
          regionConcurrency: 2,
          concurrency: 1,
          maxPages: 4,
          maxUrls: 30,
          requestTimeoutMs: 18000,
          discoveryTimeoutMs: 12000,
          listingType: 'rent',
          respondQuick: true
        } as const;
        const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
        const txt = await res.text();
        console.log(`[zoopla-uk-worker][orchestrate] NPC RENT:`, res.status, txt.slice(0, 200));
      } catch (e: any) {
        console.log('[zoopla-uk-worker][orchestrate] NPC rent failed', e?.message || e);
      }
    }

    try {
      // Post-run health
      try {
        const h = await fetch(`${API_URL}/api/health`, { method: 'GET', headers });
        const ht = await h.text();
        console.log('[zoopla-uk-worker] post-run health:', h.status, ht.slice(0, 120));
      } catch (e: any) {
        console.log('[zoopla-uk-worker] post-run health failed', e?.message || e);
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
