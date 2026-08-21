// Tiny in-memory TTL cache. Resets on every cold start (serverless) or dev
// server reload — that's fine, its only job is to avoid re-scraping op.gg on
// every request within the same warm instance.

const store = new Map<string, { data: unknown; expiresAt: number }>();

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Fetch-or-compute with caching, so callers don't have to repeat the
 * get/set dance around every scrape. */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  const value = await compute();
  setCached(key, value, ttlMs);
  return value;
}
