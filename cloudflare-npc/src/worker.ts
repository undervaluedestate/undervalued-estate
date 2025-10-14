// Cloudflare Worker: NPC regions (buy/rent alternating), staggered cron
export interface Env { API_URL: string; API_SECRET: string; }

type RegionDef = { name: string; paths?: string[]; startUrls?: string[] };

const NPC_REGIONS: RegionDef[] = [
  { name: 'Lagos', paths: ['/for-sale/flats-apartments/lagos/'] },
  { name: 'Abuja', paths: ['/for-sale/flats-apartments/abuja/'] },
];

export default {
  async scheduled(_event: any, env: Env, _ctx: any) {
    const { API_URL, API_SECRET } = env;
    if (!API_URL || !API_SECRET) return;
    const runId = `cf-npc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_SECRET}`, 'X-Run-Id': runId } as const;

    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? now.getUTCMinutes());
    const doRent = false; // Force BUY-only runs

    const chunk = <T,>(arr: T[], size: number) => arr.reduce((acc: T[][], _, i) => (i % size ? acc : [...acc, arr.slice(i, i + size)]), [] as T[][]);
    const npcRegionsEff = NPC_REGIONS; // keep /for-sale/ only
    const groups = chunk(npcRegionsEff, 10);

    // Quick health: ensure API responds 202 with respondQuick
    try {
      const healthBody = {
        adapterName: 'NigeriaPropertyCentre',
        respondQuick: true,
        maxPages: 1,
        maxUrls: 0,
        concurrency: 1,
        requestTimeoutMs: 2000,
        discoveryTimeoutMs: 2000,
      };
      const healthRes = await fetch(`${API_URL}/api/scrape/run`, { method: 'POST', headers, body: JSON.stringify(healthBody) });
      const healthTxt = await healthRes.text();
      console.log(`[npc-worker] health:`, healthRes.status, healthTxt.slice(0, 120));
    } catch (e: any) {
      console.log('[npc-worker] health failed', e?.message || e);
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (const [i, group] of groups.entries()) {
      const body = {
        adapterName: 'NigeriaPropertyCentre',
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
      console.log(`[npc-worker] BUY group ${i+1}/${groups.length}:`, res.status, txt.slice(0, 200));
      // jitter 100–400ms to reduce lock contention at cron edges
      await sleep(100 + Math.floor(Math.random()*300));
    }

    // Kick benchmarks and alerts with pre-flight health and jitter
    try {
      try {
        const h = await fetch(`${API_URL}/api/health`, { method: 'GET', headers });
        const ht = await h.text();
        console.log('[npc-worker] post-run health:', h.status, ht.slice(0, 120));
      } catch (e: any) {
        console.log('[npc-worker] post-run health failed', e?.message || e);
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
