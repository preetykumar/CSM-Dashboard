// Simple in-memory TTL cache for expensive API calls (Salesforce, Amplitude)
// Eliminates redundant external API calls on page loads/refreshes.

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTTL: number;

  constructor(defaultTTLSeconds: number = 300) {
    this.defaultTTL = defaultTTLSeconds * 1000;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTTL / 1000) * 1000;
    this.store.set(key, { data, expiresAt: Date.now() + ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// Shared cache instances
// Renewals: 10 min TTL (data changes infrequently, refreshed on sync)
export const renewalsCache = new MemoryCache(600);

// Amplitude: 30 min TTL (usage metrics change slowly, expensive to fetch)
export const amplitudeCache = new MemoryCache(1800);

// Salesforce misc: 30 min TTL (subscriptions, health scores)
export const salesforceCache = new MemoryCache(1800);
