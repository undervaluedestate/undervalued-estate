// Cloudflare Worker scheduled cron to trigger backend scraping + maintenance
// Schedule is configured in wrangler.toml (*/15 * * * *).
// Secrets required:
// - API_URL: https://<your-render-api-service>.onrender.com
// - API_SECRET: shared secret for protected routes

export interface Env {
  API_URL: string;
  API_SECRET: string;
}

const UK_SEEDS: string[] = [
  'https://www.properstar.co.uk/united-kingdom/london/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/manchester/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/birmingham/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/leeds/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/glasgow/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/liverpool/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/edinburgh/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/bristol/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/sheffield/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/newcastle-upon-tyne/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/nottingham/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/leicester/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/coventry/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/cardiff/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/belfast/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/brighton/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/southampton/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/portsmouth/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/cambridge/buy/apartment-house',
  'https://www.properstar.co.uk/united-kingdom/oxford/buy/apartment-house',
];

const NIGERIA_SEEDS: string[] = [
  'https://www.properstar.co.uk/nigeria/eti-osa/buy/flat',
  'https://www.properstar.co.uk/nigeria/eti-osa/rent/flat',
  'https://www.properstar.co.uk/nigeria/lagos/buy/flat',
  'https://www.properstar.co.uk/nigeria/lagos/rent/flat',
  'https://www.properstar.co.uk/nigeria/ikoyi/buy/flat',
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) {
      console.log('Missing API_URL or API_SECRET');
      return;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_SECRET}`,
    } as const;

    const hour = new Date().getUTCHours();
    const regionSeeds = hour % 2 === 0 ? UK_SEEDS : NIGERIA_SEEDS;

    try {
      // 1) Small NPC run
      const npcBody = { adapterName: 'NigeriaPropertyCentre', maxPages: 1, maxUrls: 10, requestTimeoutMs: 8000, discoveryTimeoutMs: 6000 };
      const npcRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(npcBody) });
      const npcTxt = await npcRes.text();
      console.log('[scheduled] NPC:', npcRes.status, npcTxt.slice(0, 200));

      // 2) Properstar run (buy)
      const properBody = {
        adapterName: 'Properstar',
        startUrls: regionSeeds,
        maxPages: 1,
        maxUrls: 12,
        requestTimeoutMs: 18000,
        discoveryTimeoutMs: 12000,
        concurrency: 2,
        listingType: 'buy',
      };
      const properRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(properBody) });
      const properTxt = await properRes.text();
      console.log('[scheduled] Properstar:', properRes.status, properTxt.slice(0, 200));

      // 3) Benchmarks refresh
      const benchRes = await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      const benchTxt = await benchRes.text();
      console.log('[scheduled] Bench:', benchRes.status, benchTxt.slice(0, 200));

      // 4) Alerts dispatch
      const alertsRes = await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
      const alertsTxt = await alertsRes.text();
      console.log('[scheduled] Alerts:', alertsRes.status, alertsTxt.slice(0, 200));
    } catch (e: any) {
      console.error('[scheduled] Error', e?.message || e);
    }
  }
};
