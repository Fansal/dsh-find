import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeProject } from '../analyze.js'
import { GithubError } from '../github.js'

const noopDeps = {
  readProjectIntent: async () => ({ name: 'md', description: 'parse markdown', keywords: ['markdown'], language: 'javascript', deps: [], remote: null }),
  buildSearchQueries: () => ['markdown parser'],
  searchRepositories: async () => [{ full_name: 'a/md', html_url: '', description: 'markdown parser', stargazers_count: 10, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z' }],
  rankRepos: (i, r, l) => r.slice(0, l),
  llmRefineQueries: async () => null,
  llmRerank: async () => null,
}

test('analyzeProject heuristic path when llm returns null', async () => {
  const out = await analyzeProject('/fake/path', { config: { token: null, proxy: null, llm: { mode: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' } }, deps: noopDeps })
  assert.equal(out.source, 'heuristic')
  assert.equal(out.repos.length, 1)
})

test('analyzeProject 401 falls back to anonymous once', async () => {
  let calls = 0
  const search = async (q, opts) => {
    calls += 1
    if (calls === 1) throw new GithubError(401, 'bad token')
    return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }]
  }
  const deps = { ...noopDeps, searchRepositories: search, llmRefineQueries: async () => null }
  const out = await analyzeProject('/p', { config: { token: 'bad', proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }, deps })
  assert.equal(calls, 2)
  assert.equal(out.repos.length, 1)
})

test('analyzeProject 403 propagates', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => { throw new GithubError(403, 'rate limit') } }
  await assert.rejects(() => analyzeProject('/p', { config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }, deps }), (e) => e instanceof GithubError && e.status === 403)
})

test('analyzeProject backfills summary on each repo', async () => {
  const out = await analyzeProject('/fake/path', { config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }, deps: noopDeps })
  assert.equal(out.repos.length, 1)
  assert.equal(out.repos[0].summary, 'markdown parser')
})

test('analyzeProject overrides summary from sessionSummary provider', async () => {
  const sessionSummary = async (repos) => new Map(repos.map((r) => [r.full_name, `中文：${r.full_name}`]))
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/md', html_url: '', description: 'markdown parser', stargazers_count: 10, language: 'javascript', topics: ['md'], updated_at: '2026-01-01T00:00:00Z' },
  ] }
  const out = await analyzeProject('/fake/path', { config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }, deps, sessionSummary })
  assert.equal(out.repos[0].summary, '中文：a/md')
  assert.equal(out.repos[0].summarySource, 'model')
})

test('analyzeProject keeps heuristic summary when sessionSummary returns null', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/md', html_url: '', description: 'markdown parser', stargazers_count: 10, language: 'javascript', topics: ['md'], updated_at: '2026-01-01T00:00:00Z' },
  ] }
  const out = await analyzeProject('/fake/path', { config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }, deps, sessionSummary: async () => null })
  assert.equal(out.repos[0].summary, 'markdown parser')
  assert.equal(out.repos[0].summarySource, 'heuristic')
})

test('analyzeProject passes scoring weights to rankRepos', async () => {
  let received = null
  const deps = { ...noopDeps, rankRepos: (i, r, l, w) => { received = w; return r.slice(0, l) } }
  await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, scoring: { weights: { language: 40, stars: 5 } } },
    deps,
  })
  assert.deepEqual(received, { language: 40, stars: 5 })
})

test('analyzeProject passes undefined scoring when absent', async () => {
  let received = 'sentinel'
  const deps = { ...noopDeps, rankRepos: (i, r, l, w) => { received = w; return r.slice(0, l) } }
  await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } },
    deps,
  })
  assert.equal(received, undefined)
})

test('analyzeProject filters out low-star and fork repos before ranking', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/big', html_url: '', description: 'markdown parser', stargazers_count: 500, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z', fork: false },
    { full_name: 'a/tiny', html_url: '', description: 'markdown parser', stargazers_count: 2, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z', fork: false },
    { full_name: 'a/fork', html_url: '', description: 'markdown parser', stargazers_count: 900, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z', fork: true },
  ] }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, filters: { minStars: 10, excludeForks: true, languages: [] } },
    deps,
  })
  const names = out.repos.map((r) => r.full_name)
  assert.deepEqual(names, ['a/big'])
})

test('analyzeProject filters by language whitelist (case-insensitive)', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/js', html_url: '', description: 'markdown parser', stargazers_count: 10, language: 'JavaScript', topics: [], updated_at: '2026-01-01T00:00:00Z' },
    { full_name: 'a/py', html_url: '', description: 'markdown parser', stargazers_count: 99, language: 'Python', topics: [], updated_at: '2026-01-01T00:00:00Z' },
  ] }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, filters: { minStars: 0, excludeForks: false, languages: ['javascript'] } },
    deps,
  })
  const names = out.repos.map((r) => r.full_name)
  assert.deepEqual(names, ['a/js'])
})

test('analyzeProject keeps everything when filters absent', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/tiny', html_url: '', description: 'markdown parser', stargazers_count: 0, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z', fork: true },
  ] }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } },
    deps,
  })
  assert.equal(out.repos.length, 1)
})

// m02773: "Moved to wharfkit/js" — moved/relocated stub repos are archived:true
// search noise; excludeArchived defaults to true (config.js) and drops them.
test('analyzeProject excludes archived repos when excludeArchived is on', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'a/live', html_url: '', description: 'markdown parser', stargazers_count: 10, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z' },
    { full_name: 'wharfkit/antelope', html_url: '', description: 'Moved to wharfkit/js', stargazers_count: 49, language: 'TypeScript', topics: [], updated_at: '2026-09-25T16:26:12Z', archived: true },
  ] }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, filters: { minStars: 0, excludeForks: false, excludeArchived: true, languages: [] } },
    deps,
  })
  assert.deepEqual(out.repos.map((r) => r.full_name), ['a/live'])
})

test('analyzeProject keeps archived repos when excludeArchived is false', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => [
    { full_name: 'wharfkit/antelope', html_url: '', description: 'Moved to wharfkit/js', stargazers_count: 49, language: 'TypeScript', topics: [], updated_at: '2026-09-25T16:26:12Z', archived: true },
  ] }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, filters: { minStars: 0, excludeForks: false, excludeArchived: false, languages: [] } },
    deps,
  })
  assert.deepEqual(out.repos.map((r) => r.full_name), ['wharfkit/antelope'])
})

// m02536: directory-basename fallback — intent may carry nameSource 'dir'
// (no package.json / README / git remote); analyze must surface it so the
// panel can tell the user the search was based on the folder name.
test('analyzeProject surfaces dir-name fallback source', async () => {
  const deps = {
    ...noopDeps,
    readProjectIntent: async () => ({ name: '随便哪个文件夹', nameSource: 'dir', description: '', keywords: [], language: null, deps: [], remote: null }),
  }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } },
    deps,
  })
  assert.equal(out.nameSource, 'dir')
  assert.equal(out.repos.length, 1)
})

// m03591: container dir with a real project one level down — analyze must pass
// detectedPath through so the panel can name the child the search was based on.
test('analyzeProject surfaces the adopted child project path', async () => {
  const deps = {
    ...noopDeps,
    readProjectIntent: async () => ({
      name: 'kid-lib',
      nameSource: 'child-pkg',
      description: 'a kid library',
      keywords: ['kid'],
      language: 'JavaScript',
      deps: [],
      remote: null,
      detectedPath: 'D:\\container\\kid-lib',
    }),
  }
  const out = await analyzeProject('/fake/container', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } },
    deps,
  })
  assert.equal(out.nameSource, 'child-pkg')
  assert.equal(out.detectedPath, 'D:\\container\\kid-lib')
  assert.equal(out.repos.length, 1)
})

// a normal project must not report a detected child path
test('analyzeProject reports no detected path for a self-contained project', async () => {
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } },
    deps: noopDeps,
  })
  assert.equal(out.detectedPath, null)
})

// ---- m04619: configurable result cap ----

const manyRepos = (n) => Array.from({ length: n }, (_, i) => ({
  full_name: `o/r${i}`, html_url: '', description: 'markdown parser', stargazers_count: 100 - i, language: 'javascript', topics: [], updated_at: '2026-01-01T00:00:00Z',
}))

test('analyzeProject honors config.limit for rank and trim', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(30) }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null }, limit: 25 },
    deps,
  })
  assert.equal(out.repos.length, 25)
})

test('analyzeProject clamps an out-of-range limit', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(60) }
  const high = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, limit: 9999 },
    deps,
  })
  assert.equal(high.repos.length, 50) // LIMIT_MAX
  const low = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, limit: 0 },
    deps,
  })
  assert.equal(low.repos.length, 1)
})

test('analyzeProject defaults to 10 results without config.limit', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(30) }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps,
  })
  assert.equal(out.repos.length, 10)
})

// m05875: the panel needs the pre-trim pool size to know when load-more has
// drained the pool (真同类总共就这么多) — totalPool echoes filtered.length.
test('analyzeProject echoes totalPool: the pool size before the trim', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(15) }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, limit: 10 },
    deps,
  })
  assert.equal(out.repos.length, 10)
  assert.equal(out.totalPool, 15)

  const exhausted = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, limit: 50 },
    deps,
  })
  assert.equal(exhausted.repos.length, 15)
  assert.equal(exhausted.totalPool, 15)
})

// m05875: filters shrink the pool before the trim, and totalPool must
// reflect the post-filter size, not the raw hit count.
test('analyzeProject totalPool reflects filters, not raw hits', async () => {
  const deps = {
    ...noopDeps,
    searchRepositories: async () => [
      ...manyRepos(6),
      { full_name: 'o/tiny', html_url: '', description: '', stargazers_count: 0, language: null, topics: [], updated_at: '2026-01-01T00:00:00Z' },
      { full_name: 'o/forked', html_url: '', description: '', stargazers_count: 400, fork: true, language: null, topics: [], updated_at: '2026-01-01T00:00:00Z' },
    ],
  }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, limit: 10, filters: { minStars: 50, excludeForks: true } },
    deps,
  })
  assert.equal(out.repos.length, 6)
  assert.equal(out.totalPool, 6)
})

// m04619: config.sort re-orders the ranked pool (panel sort switcher)
test('analyzeProject re-sorts by config.sort=stars and echoes limit', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(15) }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, sort: 'stars', limit: 10 },
    deps,
  })
  // manyRepos gives descending stars 100-i, so stars order == index order
  assert.deepEqual(out.repos.map((r) => r.full_name), Array.from({ length: 10 }, (_, i) => `o/r${i}`))
  assert.equal(out.limit, 10)
})

test('analyzeProject re-sorts by config.sort=updated with unparseable dates last', async () => {
  const deps = {
    ...noopDeps,
    searchRepositories: async () => [
      { full_name: 'o/new', html_url: '', description: '', stargazers_count: 1, language: null, topics: [], updated_at: '2026-06-01T00:00:00Z' },
      { full_name: 'o/none', html_url: '', description: '', stargazers_count: 5000, language: null, topics: [], updated_at: null },
      { full_name: 'o/old', html_url: '', description: '', stargazers_count: 2, language: null, topics: [], updated_at: '2020-01-01T00:00:00Z' },
    ],
  }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, sort: 'updated' },
    deps,
  })
  assert.deepEqual(out.repos.map((r) => r.full_name), ['o/new', 'o/old', 'o/none'])
})

test('analyzeProject keeps scorer order for relevance sort', async () => {
  const deps = { ...noopDeps, searchRepositories: async () => manyRepos(12) }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, sort: 'relevance' },
    deps,
  })
  assert.deepEqual(out.repos.map((r) => r.full_name), Array.from({ length: 10 }, (_, i) => `o/r${i}`))
})

// ---- m04619: mode 'dsh' refines queries through the session model ----

test('analyzeProject uses sessionQueryRefine in dsh mode', async () => {
  const seen = []
  const deps = {
    ...noopDeps,
    searchRepositories: async (q) => { seen.push(q); return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }] },
  }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps,
    sessionQueryRefine: async () => ['session manager plugin', 'conversation rewind'],
  })
  assert.deepEqual(seen, ['session manager plugin', 'conversation rewind'])
  assert.equal(out.source, 'llm')
})

test('analyzeProject sanitizes and caps session queries at 3', async () => {
  const seen = []
  const deps = {
    ...noopDeps,
    searchRepositories: async (q) => { seen.push(q); return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }] },
  }
  await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps,
    sessionQueryRefine: async () => ['"quoted:thing"', '', 'two', 'three', 'four'],
  })
  assert.deepEqual(seen, ['quoted thing', 'two', 'three'])
})

test('analyzeProject falls back to heuristic queries when session refine yields nothing', async () => {
  const seen = []
  const deps = {
    ...noopDeps,
    searchRepositories: async (q) => { seen.push(q); return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }] },
  }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps,
    sessionQueryRefine: async () => null,
  })
  assert.deepEqual(seen, ['markdown parser'])
  assert.equal(out.source, 'heuristic')
})

test('analyzeProject ignores sessionQueryRefine in openai mode and on throw', async () => {
  const seen = []
  const deps = {
    ...noopDeps,
    searchRepositories: async (q) => { seen.push(q); return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }] },
    llmRefineQueries: async () => ['openai query'],
  }
  const openai = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'openai', baseUrl: 'https://x', apiKey: 'k', model: 'm' } },
    deps,
    sessionQueryRefine: async () => { throw new Error('should not be called') },
  })
  assert.deepEqual(seen, ['openai query'])
  assert.equal(openai.source, 'llm')

  const seen2 = []
  const deps2 = {
    ...noopDeps,
    searchRepositories: async (q) => { seen2.push(q); return [{ full_name: 'a/md', html_url: '', description: '', stargazers_count: 1, language: 'javascript', topics: [], updated_at: '' }] },
  }
  await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps: deps2,
    sessionQueryRefine: async () => { throw new Error('boom') },
  })
  assert.deepEqual(seen2, ['markdown parser'])
})

test('analyzeProject computes compareCandidates when compare is enabled', async () => {
  const recent = new Date().toISOString()
  const repos = [
    { full_name: 'a/big', html_url: 'u/a', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 80 },
    { full_name: 'b/tiny', html_url: 'u/b', description: 'd', stargazers_count: 5, language: 'javascript', topics: [], updated_at: recent, relevance: 80 },
    { full_name: 'c/stale', html_url: 'u/c', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: '2020-01-01T00:00:00Z', relevance: 80 },
    { full_name: 'd/forked', html_url: 'u/d', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 80, fork: true },
    { full_name: 'e/archived', html_url: 'u/e', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 80, archived: true },
    { full_name: 'f/lowrel', html_url: 'u/f', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 20 },
    { full_name: 'g/ok', html_url: 'u/g', description: 'd', stargazers_count: 200, language: 'javascript', topics: [], updated_at: recent, relevance: 55 },
  ]
  const deps = { ...noopDeps, searchRepositories: async () => repos }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, compare: { enabled: true, minStars: 100, minRelevance: 50, maxCount: 3, months: 24 } },
    deps,
  })
  assert.deepEqual(out.compareCandidates, [
    { full_name: 'a/big', html_url: 'u/a' },
    { full_name: 'g/ok', html_url: 'u/g' },
  ])
})

test('analyzeProject caps compareCandidates at maxCount', async () => {
  const recent = new Date().toISOString()
  const repos = [1, 2, 3, 4, 5].map((n) => ({ full_name: `a/r${n}`, html_url: `u${n}`, description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 90 }))
  const deps = { ...noopDeps, searchRepositories: async () => repos }
  const out = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, compare: { enabled: true, minStars: 100, minRelevance: 50, maxCount: 2, months: 24 } },
    deps,
  })
  assert.equal(out.compareCandidates.length, 2)
  assert.equal(out.compareCandidates[0].full_name, 'a/r1')
  assert.equal(out.compareCandidates[1].full_name, 'a/r2')
})

test('analyzeProject omits compareCandidates when compare is disabled', async () => {
  const recent = new Date().toISOString()
  const repos = [{ full_name: 'a/big', html_url: 'u/a', description: 'd', stargazers_count: 500, language: 'javascript', topics: [], updated_at: recent, relevance: 80 }]
  const deps = { ...noopDeps, searchRepositories: async () => repos }
  const off = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' }, compare: { enabled: false, minStars: 100, minRelevance: 50, maxCount: 3, months: 24 } },
    deps,
  })
  assert.deepEqual(off.compareCandidates, [])
  const absent = await analyzeProject('/fake/path', {
    config: { token: null, proxy: null, llm: { mode: 'dsh' } },
    deps,
  })
  assert.deepEqual(absent.compareCandidates, [])
})
