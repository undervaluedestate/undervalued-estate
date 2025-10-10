// URL utilities for scraping: canonicalization for deduplication

const TRACKING_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
  'gclid','fbclid','igshid','mc_cid','mc_eid','ref','refid','affid','aff','cmp','campaign'
]);

export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    // Lowercase host
    u.hostname = u.hostname.toLowerCase();
    // Normalize pathname: collapse multiple slashes, strip trailing slash (except root)
    u.pathname = u.pathname.replace(/\/+/, '/');
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Drop fragment
    u.hash = '';
    // Remove tracking params and sort remaining params for stability
    const kept: [string, string][] = [];
    u.searchParams.forEach((value, key) => {
      if (!TRACKING_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    // If invalid URL, return the original trimmed
    return String(input || '').trim();
  }
}

export function sameCanonical(a: string, b: string): boolean {
  return canonicalizeUrl(a) === canonicalizeUrl(b);
}
