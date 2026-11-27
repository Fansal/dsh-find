// In-memory result cache for analyzeProject calls. Keyed by project path with
// a JSON snapshot of the config that produced the result — any config change
// (token / filters / scoring / llm) invalidates the entry. TTL-bounded and
// size-bounded so a long-lived host process can't grow it unbounded.

function snapshot(config) {
  // key order must not matter: stable stringify via sorted walk
  const stable = (v) => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
    const keys = Object.keys(v).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  }
  return stable(config)
}

/**
 * @param {{ ttlMs?: number, now?: () => number, maxEntries?: number }} opts
 *   ttlMs      cache lifetime in ms (default 10 minutes)
 *   now        clock injectable for tests (default Date.now)
 *   maxEntries oldest entry is evicted beyond this (default 8)
 * @returns {{ get(key: string, config: object): any|null, set(key: string, config: object, result: any): void, size(): number }}
 */
export function createResultCache({ ttlMs = 10 * 60 * 1000, now = () => Date.now(), maxEntries = 8 } = {}) {
  const map = new Map() // key -> { at, cfgKey, result }
  const get = (key, config) => {
    const hit = map.get(key)
    if (!hit) return null
    if (now() - hit.at > ttlMs) {
      map.delete(key)
      return null
    }
    if (hit.cfgKey !== snapshot(config)) return null
    return hit.result
  }
  const set = (key, config, result) => {
    if (!map.has(key) && map.size >= maxEntries) {
      const oldest = map.keys().next().value
      map.delete(oldest)
    }
    map.set(key, { at: now(), cfgKey: snapshot(config), result })
  }
  return { get, set, size: () => map.size }
}
