type CacheEntry<T> = { data: T; ts: number }

const store = new Map<string, CacheEntry<unknown>>()
const TTL = 60_000 // 60 seconds

export function getCache<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry || Date.now() - entry.ts > TTL) return null
  return entry.data
}

export function setCache<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() })
}

export function invalidateCache(...keys: string[]): void {
  for (const key of keys) store.delete(key)
}
