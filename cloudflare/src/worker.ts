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

// NigeriaPropertyCentre: 40+ region paths (flats/apartments for sale)
type RegionDef = { name: string; paths: string[] };
const NPC_REGIONS: RegionDef[] = [
  { name: 'Lagos-Lekki', paths: ['/for-sale/flats-apartments/lagos/lekki/'] },
  { name: 'Lagos-Ikoyi', paths: ['/for-sale/flats-apartments/lagos/ikoyi/'] },
  { name: 'Lagos-Victoria-Island', paths: ['/for-sale/flats-apartments/lagos/victoria-island/'] },
  { name: 'Lagos-Ajah', paths: ['/for-sale/flats-apartments/lagos/ajah/'] },
  { name: 'Lagos-Ikeja', paths: ['/for-sale/flats-apartments/lagos/ikeja/'] },
  { name: 'Lagos-Yaba', paths: ['/for-sale/flats-apartments/lagos/yaba/'] },
  { name: 'Lagos-Surulere', paths: ['/for-sale/flats-apartments/lagos/surulere/'] },
  { name: 'Lagos-Ilasan', paths: ['/for-sale/flats-apartments/lagos/ilasan/'] },
  { name: 'Lagos-Osapa-London', paths: ['/for-sale/flats-apartments/lagos/osapa-london/'] },
  { name: 'Lagos-Agungi', paths: ['/for-sale/flats-apartments/lagos/agungi/'] },
  { name: 'Lagos-Chevron', paths: ['/for-sale/flats-apartments/lagos/chevron/'] },
  { name: 'Lagos-Orchid', paths: ['/for-sale/flats-apartments/lagos/orchid/'] },
  { name: 'Lagos-Sangotedo', paths: ['/for-sale/flats-apartments/lagos/sangotedo/'] },
  { name: 'Lagos-Lekki-Phase-1', paths: ['/for-sale/flats-apartments/lagos/lekki/lekki-phase-1/'] },
  { name: 'Lagos-Ikota', paths: ['/for-sale/flats-apartments/lagos/ikota/'] },
  { name: 'Lagos-Ikate', paths: ['/for-sale/flats-apartments/lagos/ikate/'] },
  { name: 'Lagos-Ogba', paths: ['/for-sale/flats-apartments/lagos/ogba/'] },
  { name: 'Lagos-Gbagada', paths: ['/for-sale/flats-apartments/lagos/gbagada/'] },
  { name: 'Lagos-Magodo', paths: ['/for-sale/flats-apartments/lagos/magodo/'] },
  { name: 'Lagos-Festac', paths: ['/for-sale/flats-apartments/lagos/festac/'] },
  { name: 'Lagos-Isolo', paths: ['/for-sale/flats-apartments/lagos/isolo/'] },
  { name: 'Lagos-Maryland', paths: ['/for-sale/flats-apartments/lagos/maryland/'] },
  { name: 'Lagos-Ojo', paths: ['/for-sale/flats-apartments/lagos/ojo/'] },
  // Abuja
  { name: 'Abuja-Maitama', paths: ['/for-sale/flats-apartments/abuja/maitama/'] },
  { name: 'Abuja-Asokoro', paths: ['/for-sale/flats-apartments/abuja/asokoro/'] },
  { name: 'Abuja-Wuse', paths: ['/for-sale/flats-apartments/abuja/wuse/'] },
  { name: 'Abuja-Wuse-2', paths: ['/for-sale/flats-apartments/abuja/wuse-2/'] },
  { name: 'Abuja-Gwarinpa', paths: ['/for-sale/flats-apartments/abuja/gwarinpa/'] },
  { name: 'Abuja-Jabi', paths: ['/for-sale/flats-apartments/abuja/jabi/'] },
  { name: 'Abuja-Lokogoma', paths: ['/for-sale/flats-apartments/abuja/lokogoma/'] },
  { name: 'Abuja-Garki', paths: ['/for-sale/flats-apartments/abuja/garki/'] },
  { name: 'Abuja-Guzape', paths: ['/for-sale/flats-apartments/abuja/guzape/'] },
  { name: 'Abuja-Dawaki', paths: ['/for-sale/flats-apartments/abuja/gwarinpa/dawaki/'] },
  { name: 'Abuja-Jahi', paths: ['/for-sale/flats-apartments/abuja/jahi/'] },
  { name: 'Abuja-Katampe', paths: ['/for-sale/flats-apartments/abuja/katampe/'] },
  { name: 'Abuja-Kado', paths: ['/for-sale/flats-apartments/abuja/kado/'] },
  { name: 'Abuja-Utako', paths: ['/for-sale/flats-apartments/abuja/utako/'] },
  // Other major cities
  { name: 'Rivers-Port-Harcourt', paths: ['/for-sale/flats-apartments/rivers/port-harcourt/'] },
  { name: 'Oyo-Ibadan-Bodija', paths: ['/for-sale/flats-apartments/oyo/ibadan/bodija/'] },
  { name: 'Oyo-Ibadan-Oluyole', paths: ['/for-sale/flats-apartments/oyo/ibadan/oluyole/'] },
  { name: 'Edo-Benin-GRA', paths: ['/for-sale/flats-apartments/edo/benin-city/gra/'] },
  { name: 'Delta-Asaba', paths: ['/for-sale/flats-apartments/delta/asaba/'] },
  { name: 'Delta-Warri', paths: ['/for-sale/flats-apartments/delta/warri/'] },
  { name: 'Enugu-Independence-Layout', paths: ['/for-sale/flats-apartments/enugu/independence-layout/'] },
  { name: 'Kano-Kano', paths: ['/for-sale/flats-apartments/kano/kano/'] },
  { name: 'Kaduna-Kaduna', paths: ['/for-sale/flats-apartments/kaduna/kaduna/'] },
  { name: 'Anambra-Awka', paths: ['/for-sale/flats-apartments/anambra/awka/'] },
  { name: 'Imo-Owerri', paths: ['/for-sale/flats-apartments/imo/owerri/'] },
  { name: 'AkwaIbom-Uyo', paths: ['/for-sale/flats-apartments/akwa-ibom/uyo/'] },
  { name: 'CrossRiver-Calabar', paths: ['/for-sale/flats-apartments/cross-river/calabar/'] },
  { name: 'Ogun-Abeokuta', paths: ['/for-sale/flats-apartments/ogun/abeokuta/'] },
  { name: 'Osun-Osogbo', paths: ['/for-sale/flats-apartments/osun/osogbo/'] },
  { name: 'Ondo-Akure', paths: ['/for-sale/flats-apartments/ondo/akure/'] },
  { name: 'Kwara-Ilorin', paths: ['/for-sale/flats-apartments/kwara/ilorin/'] },
  { name: 'Plateau-Jos', paths: ['/for-sale/flats-apartments/plateau/jos/'] },
  { name: 'Bauchi-Bauchi', paths: ['/for-sale/flats-apartments/bauchi/bauchi/'] },
  { name: 'Sokoto-Sokoto', paths: ['/for-sale/flats-apartments/sokoto/sokoto/'] }
];

// Properstar (Nigeria) regions as full URLs (buy flats)
type PRegion = { name: string; startUrls: string[] };
const PROPERSTAR_REGIONS: PRegion[] = [];

// Properstar UK regions (buy flats) including Aberdeen, Glasgow, Edinburgh
const PROPERSTAR_UK_REGIONS: PRegion[] = [
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
    if (!API_URL || !API_SECRET) {
      console.log('Missing API_URL or API_SECRET');
      return;
    }

    const runId = `cf-base-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_SECRET}`,
      'X-Run-Id': runId,
    } as const;

    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? now.getUTCHours());
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? now.getUTCMinutes());
    const doRent = (minute % 30) >= 15; // keep for other schedulers, but NPC will be BUY-only
    const regionSeeds = hour % 2 === 0 ? UK_SEEDS : NIGERIA_SEEDS;

    try {
      // Helper: chunk an array
      const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);

      // 1) NPC multi-region fan-out (BUY-only)
      const npcRegionsEff = NPC_REGIONS;
      const npcChunks = chunk(npcRegionsEff, 10); // 4–5 backend calls instead of 1 huge call
      for (const [i, group] of npcChunks.entries()) {
        const npcBody = {
          adapterName: 'NigeriaPropertyCentre',
          regions: group,
          regionConcurrency: 6,
          concurrency: 3,
          maxPages: 2,
          maxUrls: 50,
          requestTimeoutMs: 20000,
          discoveryTimeoutMs: 15000,
          listingType: 'buy'
        };
        const npcRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(npcBody) });
        const npcTxt = await npcRes.text();
        console.log(`[scheduled] NPC BUY group ${i+1}/${npcChunks.length}:`, npcRes.status, npcTxt.slice(0, 200));
      }

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
