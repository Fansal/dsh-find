import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankRepos } from '../score.js'

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
