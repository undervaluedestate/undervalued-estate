// Cloudflare Worker: NPC regions (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type RegionDef = { name: string; paths: string[] };

const NPC_REGIONS: RegionDef[] = [
  { name: 'Lagos-Lekki', paths: ['/for-sale/flats-apartments/lagos/lekki/'] },
  { name: 'Lagos-Ikoyi', paths: ['/for-sale/flats-apartments/lagos/ikoyi/'] },
  { name: 'Lagos-Victoria-Island', paths: ['/for-sale/flats-apartments/lagos/victoria-island/'] },
  { name: 'Lagos-Ajah', paths: ['/for-sale/flats-apartments/lagos/ajah/'] },
  { name: 'Lagos-Ikeja', paths: ['/for-sale/flats-apartments/lagos/ikeja/'] },
  { name: 'Lagos-Yaba', paths: ['/for-sale/flats-apartments/lagos/yaba/'] },
  { name: 'Lagos-Surulere', paths: ['/for-sale/flats-apartments/lagos/surulere/'] },
  { name: 'Lagos-Lekki-Phase-1', paths: ['/for-sale/flats-apartments/lagos/lekki/lekki-phase-1/'] },
  { name: 'Lagos-Osapa-London', paths: ['/for-sale/flats-apartments/lagos/osapa-london/'] },
  { name: 'Lagos-Agungi', paths: ['/for-sale/flats-apartments/lagos/agungi/'] },
  { name: 'Lagos-Chevron', paths: ['/for-sale/flats-apartments/lagos/chevron/'] },
  { name: 'Lagos-Sangotedo', paths: ['/for-sale/flats-apartments/lagos/sangotedo/'] },
  { name: 'Abuja-Maitama', paths: ['/for-sale/flats-apartments/abuja/maitama/'] },
  { name: 'Abuja-Asokoro', paths: ['/for-sale/flats-apartments/abuja/asokoro/'] },
  { name: 'Abuja-Wuse', paths: ['/for-sale/flats-apartments/abuja/wuse/'] },
  { name: 'Abuja-Wuse-2', paths: ['/for-sale/flats-apartments/abuja/wuse-2/'] },
  { name: 'Abuja-Gwarinpa', paths: ['/for-sale/flats-apartments/abuja/gwarinpa/'] },
  { name: 'Abuja-Lokogoma', paths: ['/for-sale/flats-apartments/abuja/lokogoma/'] },
  { name: 'Abuja-Guzape', paths: ['/for-sale/flats-apartments/abuja/guzape/'] },
  { name: 'Abuja-Dawaki', paths: ['/for-sale/flats-apartments/abuja/gwarinpa/dawaki/'] },
  // ... add more as desired (keep ~40+)
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}` } as const;

    const now = new Date();
    const minute = now.getUTCMinutes();
    const doRent = (minute % 30) >= 15; // toggle buy/rent

    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const npcRegionsEff = NPC_REGIONS.map(r => doRent ? ({ name: r.name, paths: r.paths.map(p => p.replace('/for-sale/', '/for-rent/')) }) : r);
    const groups = chunk(npcRegionsEff, 10);

    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'NigeriaPropertyCentre',
        regions: group,
        regionConcurrency: 6,
        concurrency: 2,
        maxPages: 1,
        maxUrls: 30,
        requestTimeoutMs: 18000,
        discoveryTimeoutMs: 12000,
        listingType: doRent ? 'rent' : 'buy',
        respondQuick: true
      };
      const res = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(body) });
      const txt = await res.text();
      console.log(`[npc-worker] ${doRent ? 'RENT' : 'BUY'} group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
    }

    // Kick benchmarks and alerts
    try {
      await fetch(`${API_URL}/api/scrape/benchmarks/refresh`, { method: 'POST', headers, body: JSON.stringify({}) });
      await fetch(`${API_URL}/api/alerts/dispatch`, { method: 'POST', headers, body: JSON.stringify({ maxPerAlert: 50 }) });
    } catch {}
  }
};
