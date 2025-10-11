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
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}` } as const;

    // Alternate buy/rent every 15 minutes
    const now = new Date();
    const doRent = (now.getUTCMinutes() % 30) >= 15;

    // Helper: chunk list to keep each API call short
    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const regionsEff = ZOOPLA_UK.map(r => doRent ? ({ name: r.name, startUrls: r.startUrls.map(u => u.replace('/for-sale/', '/to-rent/')) }) : r);
    const groups = chunk(regionsEff, 10);

    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'Zoopla',
        regions: group,
        regionConcurrency: 6,
        concurrency: 2,
        maxPages: 2,
        maxUrls: 50,
        requestTimeoutMs: 20000,
        discoveryTimeoutMs: 15000,
        listingType: doRent ? 'rent' : 'buy'
      };
      const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(`[zoopla-uk-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
    }

    try {
      await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
    } catch {}
  }
};
