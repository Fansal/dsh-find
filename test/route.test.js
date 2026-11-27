import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerAnalyzeRoute } from '../route.js'

test('registerAnalyzeRoute registers exact POST /api/dsh-find/analyze', async () => {
  const registrations = []
  const webServer = { register: (r) => registrations.push(r) }
  await registerAnalyzeRoute({ webServer, loadConfig: async () => ({}), analyzeProject: async () => ({ repos: [], source: 'heuristic' }) })
  const r = registrations.find((x) => x.path === '/api/dsh-find/analyze')
  assert.ok(r)
  assert.equal(r.kind, 'exact')
})

test('handler rejects missing path with 400', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await registerAnalyzeRoute({ webServer, loadConfig: async () => ({}), analyzeProject: async () => ({ repos: [], source: 'heuristic' }) })
  await handlers['/api/dsh-find/analyze']({ url: '', method: 'POST' }, res)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.error, 'path required')
})

test('config path registers config save route', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let saved = null
  await registerAnalyzeRoute({ webServer, loadConfig: async () => ({ token: null, proxy: null, llm: {} }), analyzeProject: async () => ({ repos: [], source: 'heuristic' }), saveConfig: async (c) => { saved = c } })
  assert.ok(handlers['/api/dsh-find/config'])
})

test('analyze handler maps GithubError 403 to rate-limit error', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  const GithubError = class extends Error { constructor(s, m) { super(m); this.status = s } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({}),
    analyzeProject: async () => { throw new GithubError(403, 'rate limit') },
    guards: { readBody: async () => JSON.stringify({ path: 'C:/x' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.error.code, 'rate-limit')
  assert.equal(res.statusCode, 200)
})

test('analyze handler maps GithubError 0 (network) to network error', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  const GithubError = class extends Error { constructor(s, m) { super(m); this.status = s } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({}),
    analyzeProject: async () => { throw new GithubError(0, 'network: ECONNREFUSED') },
    guards: { readBody: async () => JSON.stringify({ path: 'C:/x' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.error.code, 'network')
  assert.equal(res.statusCode, 200)
})

test('config handler returns 500 when saveConfig throws', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null, llm: {} }),
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
    saveConfig: async () => { throw new Error('disk full') },
    guards: { readBody: async () => JSON.stringify({ token: 'ghp_new' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'POST' }, res)
  const parsed = JSON.parse(res.body)
  assert.equal(res.statusCode, 500)
  assert.match(parsed.error, /disk full/)
})

test('config handler saves merged config', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let saved = null
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null, llm: {} }),
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
    saveConfig: async (c) => { saved = c },
    guards: { readBody: async () => JSON.stringify({ token: 'ghp_new' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'POST' }, res)
  assert.ok(saved)
  assert.ok(JSON.parse(res.body).ok)
})

test('config handler merges scoring weights partially', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let saved = null
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null, llm: {}, scoring: { weights: { language: 40, stars: 5 } } }),
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
    saveConfig: async (c) => { saved = c },
    guards: { readBody: async () => JSON.stringify({ scoring: { weights: { keywordPerHit: 3 } } }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'POST' }, res)
  assert.ok(saved)
  assert.deepEqual(saved.scoring.weights, { language: 40, stars: 5, keywordPerHit: 3 })
  assert.ok(JSON.parse(res.body).ok)
})

test('config handler merges filters partially', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let saved = null
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null, llm: {}, filters: { minStars: 50, excludeForks: false, languages: ['JavaScript'] } }),
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
    saveConfig: async (c) => { saved = c },
    guards: { readBody: async () => JSON.stringify({ filters: { excludeForks: true } }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'POST' }, res)
  assert.ok(saved)
  assert.deepEqual(saved.filters, { minStars: 50, excludeForks: true, languages: ['JavaScript'] })
  assert.ok(JSON.parse(res.body).ok)
})

test('GET config route returns current config for settings prefill', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: 'ghp_x', proxy: null, llm: { mode: 'dsh' }, scoring: { weights: { language: 40 } }, filters: { minStars: 10, excludeForks: false, excludeArchived: true, languages: [] } }),
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
  })
  assert.ok(handlers['/api/dsh-find/config'])
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'GET' }, res)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.config.token, 'ghp_x')
  assert.equal(parsed.config.scoring.weights.language, 40)
})

test('GET config route returns 500 when loadConfig throws', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => { throw new Error('corrupt') },
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'GET' }, res)
  assert.equal(res.statusCode, 500)
  assert.match(JSON.parse(res.body).error, /corrupt/)
})

// m03271: TLS verify failures (MITM re-signs HTTPS) map to a dedicated code
test('analyze maps tls status error to tls code', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null }),
    analyzeProject: async () => {
      const e = new Error('network-tls: UNABLE_TO_VERIFY_LEAF_SIGNATURE')
      e.status = 'tls'
      throw e
    },
    guards: { readBody: async () => JSON.stringify({ path: 'D:/proj' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.error.code, 'tls')
  assert.match(parsed.error.message, /证书/)
})

test('config POST merges tlsAllowUnauthorized boolean', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let saved = null
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null, tlsAllowUnauthorized: false, llm: {} }),
    saveConfig: async (cfg) => { saved = cfg },
    analyzeProject: async () => ({ repos: [], source: 'heuristic' }),
    guards: { readBody: async () => JSON.stringify({ tlsAllowUnauthorized: true }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/config']({ method: 'POST' }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(saved.tlsAllowUnauthorized, true)
})

test('analyze handler serves from cache on second identical call', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let calls = 0
  const cache = new Map()
  const cacheApi = {
    get: (key, cfg) => cache.get(key)?.cfg === JSON.stringify(cfg) ? cache.get(key).result : null,
    set: (key, cfg, result) => cache.set(key, { cfg: JSON.stringify(cfg), result }),
  }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => ({ token: null, proxy: null }),
    analyzeProject: async () => { calls += 1; return { repos: [{ full_name: 'x/y' }], source: 'heuristic' } },
    cache: cacheApi,
    guards: { readBody: async () => JSON.stringify({ path: 'D:/proj' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  const first = JSON.parse(res.body)
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  const second = JSON.parse(res.body)
  assert.equal(calls, 1) // second call served from cache
  assert.deepEqual(first, second)
  assert.equal(first.repos[0].full_name, 'x/y')
})

test('analyze handler bypasses cache when config changed', async () => {
  const handlers = {}
  const webServer = { register: (r) => { handlers[r.path] = r.handler } }
  let calls = 0
  let currentCfg = { token: 'one' }
  const cache = new Map()
  const cacheApi = {
    get: (key, cfg) => cache.get(key)?.cfg === JSON.stringify(cfg) ? cache.get(key).result : null,
    set: (key, cfg, result) => cache.set(key, { cfg: JSON.stringify(cfg), result }),
  }
  await registerAnalyzeRoute({
    webServer,
    loadConfig: async () => currentCfg,
    analyzeProject: async () => { calls += 1; return { repos: [], source: 'heuristic' } },
    cache: cacheApi,
    guards: { readBody: async () => JSON.stringify({ path: 'D:/proj' }) },
  })
  const res = { setHeader() {}, statusCode: 0, end(body) { this.body = body } }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  currentCfg = { token: 'two' }
  await handlers['/api/dsh-find/analyze']({ method: 'POST' }, res)
  assert.equal(calls, 2) // config change invalidates the cached entry
})
