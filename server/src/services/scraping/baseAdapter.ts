import type { BaseAdapter as IBaseAdapter, ScrapeContext } from '../../types/index.js';

export abstract class BaseAdapter implements IBaseAdapter {
  abstract getMeta(): { name: string };
  abstract discoverListingUrls(ctx: ScrapeContext): AsyncGenerator<string>;
  abstract parseListing(ctx: ScrapeContext, html: string, url: string): Promise<{ external_id: string; url: string } & Record<string, any>>;
}
