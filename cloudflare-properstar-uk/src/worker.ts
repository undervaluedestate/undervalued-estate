// Cloudflare Worker: Properstar UK (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type Region = { name: string; startUrls: string[] };

const PROPERSTAR_UK: Region[] = [
  { name: 'London', startUrls: ['https://www.properstar.co.uk/united-kingdom/london/buy/flat'] },
  { name: 'Manchester', startUrls: ['https://www.properstar.co.uk/united-kingdom/manchester/buy/flat'] },
  { name: 'Birmingham', startUrls: ['https://www.properstar.co.uk/united-kingdom/birmingham/buy/flat'] },
  { name: 'Leeds', startUrls: ['https://www.properstar.co.uk/united-kingdom/leeds/buy/flat'] },
  { name: 'Liverpool', startUrls: ['https://www.properstar.co.uk/united-kingdom/liverpool/buy/flat'] },
  { name: 'Bristol', startUrls: ['https://www.properstar.co.uk/united-kingdom/bristol/buy/flat'] },
  { name: 'Sheffield', startUrls: ['https://www.properstar.co.uk/united-kingdom/sheffield/buy/flat'] },
  { name: 'Newcastle', startUrls: ['https://www.properstar.co.uk/united-kingdom/newcastle-upon-tyne/buy/flat'] },
  { name: 'Nottingham', startUrls: ['https://www.properstar.co.uk/united-kingdom/nottingham/buy/flat'] },
  { name: 'Leicester', startUrls: ['https://www.properstar.co.uk/united-kingdom/leicester/buy/flat'] },
  { name: 'Cambridge', startUrls: ['https://www.properstar.co.uk/united-kingdom/cambridge/buy/flat'] },
  { name: 'Oxford', startUrls: ['https://www.properstar.co.uk/united-kingdom/oxford/buy/flat'] },
  { name: 'Brighton', startUrls: ['https://www.properstar.co.uk/united-kingdom/brighton/buy/flat'] },
  { name: 'Southampton', startUrls: ['https://www.properstar.co.uk/united-kingdom/southampton/buy/flat'] },
  { name: 'Portsmouth', startUrls: ['https://www.properstar.co.uk/united-kingdom/portsmouth/buy/flat'] },
  { name: 'Cardiff', startUrls: ['https://www.properstar.co.uk/united-kingdom/cardiff/buy/flat'] },
  { name: 'Belfast', startUrls: ['https://www.properstar.co.uk/united-kingdom/belfast/buy/flat'] },
  { name: 'Aberdeen', startUrls: ['https://www.properstar.co.uk/united-kingdom/aberdeen/buy/flat'] },
  { name: 'Glasgow', startUrls: ['https://www.properstar.co.uk/united-kingdom/glasgow/buy/flat'] },
  { name: 'Edinburgh', startUrls: ['https://www.properstar.co.uk/united-kingdom/edinburgh/buy/flat'] }
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}` } as const;

    // Alternate buy/rent every 15 minutes
    const now = new Date();
    const doRent = (now.getUTCMinutes() % 30) >= 15;

    // Helper: chunk list
    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const regionsEff = PROPERSTAR_UK.map(r => doRent ? ({ name: r.name, startUrls: r.startUrls.map(u => u.replace('/buy/', '/rent/')) }) : r);
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
      console.log(`[properstar-uk-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
    }

    try {
      await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
    } catch {}
  }
};
