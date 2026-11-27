import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResultCache } from '../cache.js'

const cfgA = { token: 't', proxy: null, llm: { mode: 'dsh' }, scoring: { weights: { language: 25 } }, filters: { minStars: 0 } }
const resultA = { repos: [{ full_name: 'a/b' }], source: 'heuristic' }

test('set then get returns the cached result for the same config', () => {
  const cache = createResultCache()
  cache.set('D:/proj', cfgA, resultA)
  assert.deepEqual(cache.get('D:/proj', cfgA), resultA)
})

test('get returns null after ttl expiry', () => {
  let t = 1_000_000
  const cache = createResultCache({ ttlMs: 60_000, now: () => t })
  cache.set('D:/proj', cfgA, resultA)
  t += 61_000
  assert.equal(cache.get('D:/proj', cfgA), null)
})

test('get returns null when config changed (token / filters / scoring)', () => {
  const cache = createResultCache()
  cache.set('D:/proj', cfgA, resultA)
  assert.equal(cache.get('D:/proj', { ...cfgA, token: 'other' }), null)
  assert.equal(cache.get('D:/proj', { ...cfgA, filters: { minStars: 5 } }), null)
  assert.equal(cache.get('D:/proj', { ...cfgA, scoring: { weights: { language: 40 } } }), null)
  // key order inside nested objects must not matter
  assert.deepEqual(cache.get('D:/proj', { token: 't', proxy: null, scoring: { weights: { language: 25 } }, llm: { mode: 'dsh' }, filters: { minStars: 0 } }), resultA)
})

test('get returns null for unknown key', () => {
  const cache = createResultCache()
  assert.equal(cache.get('D:/nope', cfgA), null)
})

test('evicts the oldest entry beyond maxEntries', () => {
  let t = 0
  const cache = createResultCache({ maxEntries: 2, now: () => t })
  cache.set('a', cfgA, { id: 'a' })
  t += 10
  cache.set('b', cfgA, { id: 'b' })
  t += 10
  cache.set('c', cfgA, { id: 'c' })
  assert.equal(cache.get('a', cfgA), null)
  assert.deepEqual(cache.get('b', cfgA), { id: 'b' })
  assert.deepEqual(cache.get('c', cfgA), { id: 'c' })
})

test('set over the same key refreshes without eviction', () => {
  let t = 0
  const cache = createResultCache({ maxEntries: 2, now: () => t })
  cache.set('a', cfgA, { id: 'a1' })
  t += 10
  cache.set('b', cfgA, { id: 'b' })
  t += 10
  cache.set('a', cfgA, { id: 'a2' }) // refresh existing key: size stays 2
  assert.deepEqual(cache.get('a', cfgA), { id: 'a2' })
  assert.deepEqual(cache.get('b', cfgA), { id: 'b' })
})
