import type { NormalizedProperty, PropertyType } from '../../types/index.js';
import { canonicalizeUrl } from './url';

function toNumberSafe(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSizeSqm(value: any): number | null {
  if (value == null) return null;
  const s = String(value).toLowerCase();
  const sqmMatch = s.match(/([0-9,.]+)\s*(sqm|m2|square\s*meters?)/);
  if (sqmMatch) {
    const n = toNumberSafe(sqmMatch[1]);
    return n == null ? null : n;
  }
  const justNum = toNumberSafe(s);
  return justNum;
}

function mapPropertyType(t: any): PropertyType {
  if (!t) return 'other';
  const s = String(t).toLowerCase();
  if (s.includes('duplex')) return 'duplex';
  if (s.includes('maisonette')) return 'apartment';
  if (s.includes('apartment') || s.includes('flat')) return 'apartment';
  if (s.includes('house') || s.includes('bungalow') || s.includes('villa')) return 'house';
  if (s.includes('terrace') || s.includes('terraced')) return 'house';
  if (s.includes('townhouse')) return 'townhouse';
  if (s.includes('land') || s.includes('plot')) return 'land';
  if (s.includes('studio') || s.includes('bedsitter')) return 'studio';
  if (s.includes('condo')) return 'condo';
  return 'other';
}

export function normalizeToProperty(input: Partial<NormalizedProperty> & { external_id: string; url: string; source?: any }): NormalizedProperty {
  const {
    source,
    external_id,
    url,
    title,
    description,
    price,
    currency,
    size_sqm,
    size,
    bedrooms,
    bathrooms,
    property_type,
    images,
    address_line1,
    address_line2,
    neighborhood,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    listed_at,
    listing_updated_at,
    first_seen_at,
    last_seen_at,
    is_active = true,
    raw,
  } = input as any;

  // Compose a fallback address when a scraper doesn't provide a street/estate.
  // This favors completeness: address_line1 may include neighborhood/city/state/postal_code/country.
  const composedAddress: string | null = address_line1 ?? ((): string | null => {
    const parts = [neighborhood, city, state, postal_code, country].filter(Boolean).map((s: any) => String(s).trim());
    return parts.length ? parts.join(', ') : null;
  })();

  // Normalize images to a small, unique absolute URL list
  const normImages: string[] | null = (() => {
    try {
      const arr = Array.isArray(images) ? images : (images ? [images as any] : []);
      const cleaned = arr
        .map((s) => {
          try { return new URL(String(s), url).toString(); } catch { return null; }
        })
        .filter((s): s is string => !!s)
        .map((s) => s.trim());
      const uniq = Array.from(new Set(cleaned));
      // keep a reasonable max (e.g., first 20)
      return uniq.slice(0, 20);
    } catch { return null; }
  })();

  return {
    source_id: source?.id,
    external_id,
    url,
    url_canonical: canonicalizeUrl(url),
    title: title ?? null,
    description: description ?? null,
    price: toNumberSafe(price) ?? 0,
    currency: currency || 'NGN',
    size_sqm: size_sqm != null ? toNumberSafe(size_sqm) : parseSizeSqm(size),
    bedrooms: toNumberSafe(bedrooms),
    bathrooms: toNumberSafe(bathrooms),
    property_type: mapPropertyType(property_type),
    images: normImages && normImages.length ? normImages : null,
    address_line1: composedAddress,
    address_line2: address_line2 ?? null,
    neighborhood: neighborhood ?? null,
    city: city ?? null,
    state: state ?? null,
    postal_code: postal_code ?? null,
    country: country ?? 'Nigeria',
    latitude: latitude != null ? Number(latitude) : null,
    longitude: longitude != null ? Number(longitude) : null,
    listed_at: listed_at ?? null,
    listing_updated_at: listing_updated_at ?? null,
    first_seen_at: first_seen_at ?? null,
    last_seen_at: last_seen_at ?? null,
    is_active: !!is_active,
    raw: raw ?? null,
  };
}
