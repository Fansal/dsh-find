import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchQueries } from '../query.js'

const intent = {
  name: 'my-awesome-parser',
  description: 'a blazing fast markdown parser for node',
  keywords: ['markdown', 'parser'],
  language: 'javascript',
  deps: ['@fastify/static', 'lru-cache'],
  remote: null,
}

test('buildSearchQueries returns 1-4 queries, first includes name+description', () => {
  const qs = buildSearchQueries(intent)
  assert.ok(qs.length >= 1 && qs.length <= 4)
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
