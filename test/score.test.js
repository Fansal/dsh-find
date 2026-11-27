import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankRepos, sortRepos, normalizeSort, SORTS } from '../score.js'

const intent = { name: 'markdown parser', description: 'parse markdown fast', keywords: ['markdown', 'parser'], language: 'javascript', deps: [], remote: null }
const mkRepo = (over) => ({ full_name: 'a/' + over.id, html_url: '', description: '', stargazers_count: 0, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z', ...over })

test('rankRepos sorts by similarity and clips to limit', () => {
  const repos = [
    mkRepo({ id: 'low', description: 'unrelated thing about cats', stargazers_count: 900 }),
    mkRepo({ id: 'high', description: 'a markdown parser for js', stargazers_count: 10 }),
  ]
  const ranked = rankRepos(intent, repos, 10)
  assert.equal(ranked[0].full_name, 'a/high')
})

test('rankRepos defaults limit to 10', () => {
  const repos = Array.from({ length: 15 }, (_, i) => mkRepo({ id: String(i), description: 'markdown parser ' + i }))
  assert.equal(rankRepos(intent, repos).length, 10)
})

test('language match outranks keyword hits alone', () => {
  const repos = [
    mkRepo({ id: 'rusty', language: 'rust', description: 'a markdown parser written in rust', stargazers_count: 5000 }),
    mkRepo({ id: 'jsy', language: 'javascript', description: 'cli to list files', stargazers_count: 2 }),
  ]
  const ranked = rankRepos(intent, repos, 10)
  assert.equal(ranked[0].full_name, 'a/jsy')
})

test('rankRepos honors custom weights (language weight zeroed)', () => {
  const weights = { language: 0, keywordPerHit: 5, keywordCap: 45, stars: 1, recent: 0 }
  const repos = [
    mkRepo({ id: 'rusty', language: 'rust', description: 'a markdown parser written in rust', stargazers_count: 5000 }),
    mkRepo({ id: 'jsy', language: 'javascript', description: 'cli to list files', stargazers_count: 2 }),
  ]
  // language +25 removed -> rust repo (2 keyword hits + many stars) outranks jsy
  const ranked = rankRepos(intent, repos, 10, weights)
  assert.equal(ranked[0].full_name, 'a/rusty')
})

test('rankRepos custom keywordCap clamps keyword score', () => {
  const weights = { language: 25, keywordPerHit: 100, keywordCap: 50, stars: 1, recent: 0 }
  const repos = [
    mkRepo({ id: 'two', language: 'javascript', description: 'markdown parser', stargazers_count: 0 }),
    mkRepo({ id: 'one', language: 'javascript', description: 'a markdown library', stargazers_count: 1000 }),
  ]
  // 'two' has 2 keyword hits (200 -> clamped 50), 'one' has 1 hit (100 -> clamped 50).
  // Tie at 50 -> stars desc picks 'one'. Without the cap 'two' (200) would win.
  const ranked = rankRepos(intent, repos, 10, weights)
  assert.equal(ranked[0].full_name, 'a/one')
})

// m02613: 相关性按钮 — rankRepos must expose a 0-100 relevance per repo so
// the panel can show how well each result matches the intent (raw score is
// internal; relevance = score / theoretical max under the active weights).
test('rankRepos attaches integer 0-100 relevance to each repo', () => {
  const repos = [
    mkRepo({ id: 'low', description: 'unrelated thing about cats', stargazers_count: 0, language: 'rust' }),
    mkRepo({ id: 'high', description: 'a markdown parser for js', stargazers_count: 10 }),
  ]
  const ranked = rankRepos(intent, repos, 10)
  for (const r of ranked) {
    assert.ok(Number.isInteger(r.relevance), `relevance must be an integer, got ${r.relevance}`)
    assert.ok(r.relevance >= 0 && r.relevance <= 100, `relevance must be within [0,100], got ${r.relevance}`)
  }
  assert.ok(ranked[0].relevance > ranked[1].relevance, 'the better match must have higher relevance')
  // custom weights must also produce a 0-100 relevance
  const custom = rankRepos(intent, repos, 10, { language: 0, keywordPerHit: 5, keywordCap: 45, stars: 1, recent: 0 })
  for (const r of custom) {
    assert.ok(Number.isInteger(r.relevance) && r.relevance >= 0 && r.relevance <= 100)
  }
})

// m04619: panel sort switcher
test('normalizeSort falls back to relevance for unknown values', () => {
  assert.deepEqual([...SORTS], ['relevance', 'stars', 'updated'])
  assert.equal(normalizeSort('stars'), 'stars')
  assert.equal(normalizeSort('updated'), 'updated')
  assert.equal(normalizeSort('relevance'), 'relevance')
  assert.equal(normalizeSort('nope'), 'relevance')
  assert.equal(normalizeSort(undefined), 'relevance')
})

test('sortRepos keeps scorer order for relevance and does not mutate input', () => {
  const repos = [mkRepo({ id: 'x', stargazers_count: 5 }), mkRepo({ id: 'y', stargazers_count: 500 })]
  const out = sortRepos(repos, 'relevance')
  assert.equal(out, repos) // same array reference: no needless copy
  assert.equal(repos[0].full_name, 'a/x')
})

test('sortRepos sorts by stars desc', () => {
  const repos = [
    mkRepo({ id: 'low', stargazers_count: 5 }),
    mkRepo({ id: 'high', stargazers_count: 900 }),
    mkRepo({ id: 'mid', stargazers_count: 100 }),
  ]
  const out = sortRepos(repos, 'stars')
  assert.deepEqual(out.map((r) => r.full_name), ['a/high', 'a/mid', 'a/low'])
  // input untouched
  assert.equal(repos[0].full_name, 'a/low')
})

test('sortRepos sorts by updated desc and tolerates missing/invalid dates', () => {
  const repos = [
    mkRepo({ id: 'old', updated_at: '2020-01-01T00:00:00Z' }),
    mkRepo({ id: 'new', updated_at: '2026-06-01T00:00:00Z' }),
    mkRepo({ id: 'bad', updated_at: 'not-a-date' }),
    mkRepo({ id: 'none', updated_at: null }),
  ]
  const out = sortRepos(repos, 'updated')
  assert.deepEqual(out.map((r) => r.full_name), ['a/new', 'a/old', 'a/bad', 'a/none'])
})

test('sortRepos handles empty/undefined lists', () => {
  assert.deepEqual(sortRepos([], 'stars'), [])
  assert.deepEqual(sortRepos(undefined, 'updated'), [])
})
