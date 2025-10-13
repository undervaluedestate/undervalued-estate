import dotenv from 'dotenv';
import { app } from './app';
import { runBootScrape } from './bootstrap';

dotenv.config();

const port = process.env.PORT || 4000;
app.listen(port as number, () => {
  console.log(`Undervalued Estate API listening on http://localhost:${port}`);
  // Fire-and-forget boot scrape (NPC already does; include PrimeLocation too)
  runBootScrape().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[boot-scrape] failed', e?.message || e);
  });
});
