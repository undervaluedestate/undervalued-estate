// Cloudflare Worker: Properstar Nigeria (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type PRegion = { name: string; startUrls: string[] };

const PROPERSTAR_NG: PRegion[] = [
  { name: 'Lagos', startUrls: ['https://www.properstar.co.uk/nigeria/lagos/buy/flat'] },
  { name: 'Abuja', startUrls: ['https://www.properstar.co.uk/nigeria/abuja/buy/flat'] },
  { name: 'Port-Harcourt', startUrls: ['https://www.properstar.co.uk/nigeria/port-harcourt/buy/flat'] },
  { name: 'Ibadan', startUrls: ['https://www.properstar.co.uk/nigeria/ibadan/buy/flat'] },
  { name: 'Enugu', startUrls: ['https://www.properstar.co.uk/nigeria/enugu/buy/flat'] },
  { name: 'Benin-City', startUrls: ['https://www.properstar.co.uk/nigeria/benin-city/buy/flat'] },
  { name: 'Kano', startUrls: ['https://www.properstar.co.uk/nigeria/kano/buy/flat'] },
  { name: 'Kaduna', startUrls: ['https://www.properstar.co.uk/nigeria/kaduna/buy/flat'] },
  { name: 'Asaba', startUrls: ['https://www.properstar.co.uk/nigeria/asaba/buy/flat'] },
  { name: 'Warri', startUrls: ['https://www.properstar.co.uk/nigeria/warri/buy/flat'] },
  { name: 'Uyo', startUrls: ['https://www.properstar.co.uk/nigeria/uyo/buy/flat'] },
  { name: 'Calabar', startUrls: ['https://www.properstar.co.uk/nigeria/calabar/buy/flat'] },
  { name: 'Owerri', startUrls: ['https://www.properstar.co.uk/nigeria/owerri/buy/flat'] },
  { name: 'Onitsha', startUrls: ['https://www.properstar.co.uk/nigeria/onitsha/buy/flat'] },
  { name: 'Akure', startUrls: ['https://www.properstar.co.uk/nigeria/akure/buy/flat'] },
  { name: 'Ilorin', startUrls: ['https://www.properstar.co.uk/nigeria/ilorin/buy/flat'] },
  { name: 'Jos', startUrls: ['https://www.properstar.co.uk/nigeria/jos/buy/flat'] },
  { name: 'Osogbo', startUrls: ['https://www.properstar.co.uk/nigeria/osogbo/buy/flat'] },
  { name: 'Abeokuta', startUrls: ['https://www.properstar.co.uk/nigeria/abeokuta/buy/flat'] },
  { name: 'Sokoto', startUrls: ['https://www.properstar.co.uk/nigeria/sokoto/buy/flat'] }
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}` } as const;

    const now = new Date();
    const minute = now.getUTCMinutes();
    const doRent = (minute % 30) >= 15; // toggle buy/rent windows

    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const regionsEff = PROPERSTAR_NG.map(r => doRent ? ({ name: r.name, startUrls: r.startUrls.map(u => u.replace('/buy/', '/rent/')) }) : r);
    const groups = chunk(regionsEff, 10);

    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'Properstar',
        regions: group,
        regionConcurrency: 6,
        concurrency: 2,
        maxPages: 1,
        maxUrls: 30,
        requestTimeoutMs: 18000,
        discoveryTimeoutMs: 12000,
        listingType: doRent ? 'rent' : 'buy'
      };
      const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(`[properstar-ng-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
    }

    try {
      await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
    } catch {}
  }
};
