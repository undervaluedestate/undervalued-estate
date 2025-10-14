import { ScrapeEngine } from './services/scraping/engine';
import { NigeriaPropertyCentreAdapter } from './services/scraping/sites/nigeriaPropertyCentre';
import { ProperstarAdapter } from './services/scraping/sites/properstar';
import { ZooplaAdapter } from './services/scraping/sites/zoopla';
import { PrimeLocationAdapter } from './services/scraping/sites/primeLocation';
function parseList(envVal) {
    if (!envVal)
        return [];
    return String(envVal)
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}
export async function runBootScrape() {
    try {
        const enabled = String(process.env.BOOT_SCRAPE || '1').trim() !== '0';
        if (!enabled)
            return;
        const adapterNames = parseList(process.env.BOOT_SCRAPE_ADAPTERS);
        const adaptersToRun = adapterNames.length ? adapterNames : ['PrimeLocation'];
        const concurrency = Number(process.env.BOOT_SCRAPE_CONCURRENCY || 2);
        const maxPages = Number(process.env.BOOT_SCRAPE_MAXPAGES || 1);
        const maxUrls = Number(process.env.BOOT_SCRAPE_MAXURLS || 8);
        const requestTimeoutMs = Number(process.env.BOOT_SCRAPE_REQ_MS || 12000);
        const discoveryTimeoutMs = Number(process.env.BOOT_SCRAPE_DISC_MS || 6000);
        const adapterMap = {
            NigeriaPropertyCentre: new NigeriaPropertyCentreAdapter(),
            Properstar: new ProperstarAdapter(),
            Zoopla: new ZooplaAdapter(),
            PrimeLocation: new PrimeLocationAdapter(),
        };
        const engine = new ScrapeEngine({
            adapters: adaptersToRun.map((n) => adapterMap[n]).filter(Boolean),
            concurrency,
        });
        // Run each adapter sequentially to reduce initial load
        for (const name of adaptersToRun) {
            if (!adapterMap[name])
                continue;
            const listingType = (name === 'PrimeLocation' && String(process.env.BOOT_SCRAPE_PRIME_RENT || '0') === '1') ? 'rent' : 'buy';
            // Optional explicit seeds via env: BOOT_SCRAPE_SEEDS_PrimeLocation="url1,url2"
            const seedsEnvKey = `BOOT_SCRAPE_SEEDS_${name}`.toUpperCase();
            const seeds = parseList(process.env[seedsEnvKey]);
            console.log(`[boot-scrape] Starting ${name} (${listingType}) maxPages=${maxPages} maxUrls=${maxUrls}`);
            try {
                const results = await engine.run({
                    adapterName: name,
                    maxPages,
                    maxUrls,
                    requestTimeoutMs,
                    discoveryTimeoutMs,
                    extraStartUrls: seeds,
                    extraListingType: listingType,
                    concurrency,
                });
                console.log(`[boot-scrape] ${name} done: inserted=${results.inserted} discovered=${results.discovered}`);
            }
            catch (e) {
                console.error(`[boot-scrape] ${name} failed`, e?.message || e);
            }
        }
    }
    catch (e) {
        console.error('[boot-scrape] unexpected error', e);
    }
}
