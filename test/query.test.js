import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchQueries, MAX_QUERIES } from '../query.js'

const intent = {
  name: 'my-awesome-parser',
  description: 'a blazing fast markdown parser for node',
  keywords: ['markdown', 'parser'],
  language: 'javascript',
  deps: ['@fastify/static', 'lru-cache'],
  remote: null,
}

test('buildSearchQueries returns 1-MAX_QUERIES queries, first includes name+description', () => {
  const qs = buildSearchQueries(intent)
  assert.ok(qs.length >= 1 && qs.length <= MAX_QUERIES)
  assert.match(qs[0], /my-awesome-parser/)
  assert.match(qs[0], /markdown parser/)
  assert.match(qs[0], /language:javascript/)
})

test('buildSearchQueries emits a name-only workhorse query', () => {
  const qs = buildSearchQueries(intent)
  const nameQ = qs.find((q) => q === 'my-awesome-parser in:name,description,readme language:javascript')
  assert.ok(nameQ, `expected name-only query, got: ${JSON.stringify(qs)}`)
})

test('buildSearchQueries strips npm scope from name', () => {
  const scoped = {
    name: '@dsh-local/sessionkit',
    description: 'session tools plugin',
    keywords: [],
    language: null,
    deps: [],
    remote: null,
  }
  const qs = buildSearchQueries(scoped)
  assert.ok(qs.length >= 1)
  for (const q of qs) {
    assert.ok(!q.includes('@'), `query must not contain @: ${q}`)
    assert.ok(!q.includes('/'), `query must not contain /: ${q}`)
  }
  assert.ok(qs.some((q) => q.startsWith('sessionkit in:name,description,readme')), JSON.stringify(qs))
})

test('dependency query strips npm scope', () => {
  const qs = buildSearchQueries(intent)
  const depQ = qs.find((q) => q.includes('lru'))
  assert.ok(depQ)
  assert.ok(!depQ.includes('@fastify'))
  assert.ok(depQ.includes('fastify'))
})

test('buildSearchQueries sanitizes quotes and pipes (GitHub 422 guard)', () => {
  const tricky = {
    name: 'sessionkit',
    description: '识别"项目—子项目"层级 | 功能 | 入口',
    keywords: [],
    language: null,
    deps: [],
    remote: null,
  }
  const qs = buildSearchQueries(tricky)
  assert.ok(qs.length >= 1)
  for (const q of qs) {
    assert.ok(!q.includes('"'), `query must not contain raw quote: ${q}`)
    assert.ok(!q.includes('|'), `query must not contain pipe: ${q}`)
  }
})

test('buildSearchQueries falls back to extracted keywords when intent.keywords empty', () => {
  const noKw = {
    name: 'md-parser',
    description: 'a blazing fast markdown parser for node',
    keywords: [],
    language: 'javascript',
    deps: [],
    remote: null,
  }
  const qs = buildSearchQueries(noKw)
  const kwQ = qs.find((q) => q.endsWith('in:description,topics language:javascript'))
  assert.ok(kwQ, `expected a keywords query, got: ${JSON.stringify(qs)}`)
  assert.match(kwQ, /markdown/)
})

// m06420-2: GitHub queries are AND, so one query carrying every keyword is a
// guaranteed zero. Keywords must be split into short groups instead.
test('buildSearchQueries splits keywords into short AND-safe groups', () => {
  const qs = buildSearchQueries(intent)
  for (const q of qs) {
    const words = q.replace(/\s+in:[^ ]+/, '').replace(/\s+language:[^ ]+/, '').trim().split(/\s+/)
    assert.ok(words.length <= 6, `query too long for AND semantics: ${q}`)
  }
  const kwQs = qs.filter((q) => q.includes('in:description,topics'))
  assert.ok(kwQs.length >= 1)
  for (const q of kwQs) {
    const words = q.replace(/\s+in:[^ ]+/, '').replace(/\s+language:[^ ]+/, '').trim().split(/\s+/)
    assert.ok(words.length <= 3, `keyword group must stay at 3 words: ${q}`)
  }
})

test('buildSearchQueries adds a language-free wide fallback after the precise ones', () => {
  const qs = buildSearchQueries(intent)
  const wide = qs.filter((q) => !q.includes('language:') && q.includes('in:name,description,readme'))
  assert.equal(wide.length, 1, `expected exactly one wide fallback, got: ${JSON.stringify(qs)}`)
  const idx = qs.indexOf(wide[0])
  assert.ok(idx >= 2, 'the wide query must come after the precise ones')
})

test('buildSearchQueries never exceeds the search-call budget', () => {
  const fat = {
    name: 'big',
    description: 'alpha beta gamma delta epsilon zeta eta theta iota kappa',
    keywords: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
    language: 'javascript',
    deps: ['a-dep', 'b-dep', 'c-dep'],
    remote: null,
  }
  assert.equal(buildSearchQueries(fat).length, MAX_QUERIES)
})

// The real failure mode was that a Chinese name produced NO usable query at all
// (the old ASCII-only split dropped it). A Chinese description, on the other
// hand, must not leak into an AND query as junk bigrams.
test('buildSearchQueries keeps a Chinese project name as a search term', () => {
  const zh = {
    name: '会话工具',
    description: '识别当前项目并搜索同类开源项目',
    keywords: [],
    language: null,
    deps: [],
    remote: null,
  }
  const qs = buildSearchQueries(zh)
  assert.ok(qs.length >= 1)
  const kwQ = qs.find((q) => q.includes('in:description,topics'))
  assert.ok(kwQ, JSON.stringify(qs))
  assert.match(kwQ, /会话工具/)
  // description-only bigrams would be unmatchable junk
  assert.ok(!/别当|前项|并搜/.test(kwQ), `description CJK must not reach a query: ${kwQ}`)
})
