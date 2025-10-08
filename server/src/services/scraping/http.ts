import axios, { AxiosInstance } from 'axios';

export const http: AxiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  },
  validateStatus: (s) => !!s && s >= 200 && s < 400,
});

export async function getText(url: string, timeoutMs?: number): Promise<string> {
  let referer: string | undefined;
  try { referer = new URL(url).origin; } catch { /* ignore */ }
  const resp = await http.get(url, {
    timeout: timeoutMs ?? http.defaults.timeout,
    headers: referer ? { Referer: referer } : undefined,
  });
  return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
}

// Simple in-memory FX cache (per process invocation)
const fxCache = new Map<string, { rate: number; ts: number }>();
const FX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function getFxRate(from: string, to: string): Promise<number> {
  const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
  const now = Date.now();
  const cached = fxCache.get(key);
  if (cached && now - cached.ts < FX_TTL_MS) return cached.rate;
  // Use exchangerate.host (no key required)
  const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const resp = await axios.get(url, { timeout: 10000, validateStatus: (s) => !!s && s >= 200 && s < 400 });
  const rate = resp?.data?.rates?.[to.toUpperCase()];
  if (typeof rate === 'number' && isFinite(rate)) {
    fxCache.set(key, { rate, ts: now });
    return rate;
  }
  throw new Error(`FX rate not available for ${from}->${to}`);
}
