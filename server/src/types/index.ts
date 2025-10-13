export type UUID = string;

export type PropertyType =
  | 'house'
  | 'apartment'
  | 'condo'
  | 'townhouse'
  | 'land'
  | 'duplex'
  | 'studio'
  | 'other';

export type DealClass = 'none' | 'slightly_undervalued' | 'strongly_undervalued' | 'rare_deal';

export interface SourceRow {
  id: UUID;
  name: string;
  base_url: string;
  created_at: string;
}

export interface NormalizedProperty {
  source_id: UUID | undefined;
  external_id: string;
  url: string;
  url_canonical: string | null;
  title: string | null;
  description: string | null;
  price: number;
  currency: string;
  size_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: PropertyType;
  images: string[] | null;
  address_line1: string | null;
  address_line2: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  listed_at: string | null;
  listing_updated_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_active: boolean;
  raw: any;
}

export type ScrapeContext = {
  http: { getText: (url: string, timeoutMs?: number) => Promise<string> };
  cheerio: any;
  log: (...args: any[]) => void;
  adminClient: any;
  source: SourceRow;
  maxPages: number;
  requestTimeoutMs?: number;
  extra?: { startUrls?: string[]; listingType?: 'buy' | 'rent' };
};

export interface BaseAdapter {
  getMeta(): { name: string };
  discoverListingUrls(ctx: ScrapeContext): AsyncGenerator<string>;
  parseListing(ctx: ScrapeContext, html: string, url: string): Promise<Partial<NormalizedProperty> & { external_id: string; url: string }>;
}

// Supabase view/row shapes (minimal for routing layer)
export interface SearchResultRow {
  id: UUID;
  url: string;
  title: string | null;
  price: number;
  currency: string;
  size_sqm: number | null;
  price_per_sqm: number | null;
  property_type: PropertyType;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  listed_at: string | null;
  scraped_at: string;
  market_avg_price_per_sqm: number | null;
  pct_vs_market: number | null;
  deal_class: DealClass | 'none' | null;
}

export interface BenchmarkRow {
  id: UUID;
  country: string;
  state: string | null;
  city: string | null;
  neighborhood: string | null;
  property_type: PropertyType;
  currency: string;
  computed_on: string; // date
  avg_price_per_sqm: number;
  p25_price_per_sqm: number | null;
  p50_price_per_sqm: number | null;
  p75_price_per_sqm: number | null;
  sample_count: number;
  created_at: string;
}

export interface AlertRow {
  id: UUID;
  user_id: UUID;
  country: string;
  state: string | null;
  city: string | null;
  neighborhood: string | null;
  property_type: PropertyType | null;
  threshold_percent: number;
  min_price: number | null;
  max_price: number | null;
  min_size_sqm: number | null;
  max_size_sqm: number | null;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: UUID;
  alert_id: UUID;
  property_id: UUID;
  sent_at: string;
  status: 'sent' | 'failed';
  error: string | null;
}
