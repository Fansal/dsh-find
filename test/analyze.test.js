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
