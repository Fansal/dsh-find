import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCompare } from '../compare.js'

// ---- 对比咨询 runCompare (m05495) ----

const cfgOn = { token: 'ghp_t', proxy: 'http://p:8080', tlsAllowUnauthorized: true, compare: { enabled: true, minStars: 100, minRelevance: 50, maxCount: 3, months: 24 } }
const intent = { name: 'sessionkit', description: '会话管理', keywords: ['session'], deps: [], language: 'javascript', remote: null }

function fakeDeps() {
  const calls = []
  const deps = {
    readProjectIntent: async (p) => {
      calls.push(['intent', p])
      return { ...intent }
    },
    fetchRepoReadme: async (name, opts) => {
      calls.push(['readme', name, opts.token, opts.proxy, opts.tlsAllowUnauthorized])
      return `# ${name} readme`
    },
    fetchRepoIssues: async (name, opts) => {
      calls.push(['issues', name, opts.token])
      return [{ title: `${name} issue`, comments: 2, state: 'open', html_url: 'u' }]
    },
  }
  return { deps, calls }
}

const repos = [
  { full_name: 'a/big', html_url: 'https://github.com/a/big', description: 'd', language: 'js', topics: ['md'], stargazers_count: 500, updated_at: '2026-01-01' },
  { full_name: 'g/ok', html_url: 'https://github.com/g/ok', stargazers_count: 200 },
]

test('runCompare gates on config.compare.enabled', async () => {
  await assert.rejects(
    () => runCompare('/p', repos, { config: { compare: { enabled: false } } }),
    (e) => e.code === 'compare-disabled'
  )
  await assert.rejects(
    () => runCompare('/p', repos, { config: {} }),
    (e) => e.code === 'compare-disabled'
  )
  await assert.rejects(
    () => runCompare('/p', repos, {}),
    (e) => e.code === 'compare-disabled'
  )
})

test('runCompare rejects empty/invalid repo lists', async () => {
  const sessionCompare = async () => 'R'
  await assert.rejects(() => runCompare('/p', [], { config: cfgOn, sessionCompare }), (e) => e.code === 'compare-empty')
  await assert.rejects(() => runCompare('/p', null, { config: cfgOn, sessionCompare }), (e) => e.code === 'compare-empty')
  await assert.rejects(() => runCompare('/p', [{ html_url: 'u' }, 5], { config: cfgOn, sessionCompare }), (e) => e.code === 'compare-empty')
})

test('runCompare returns the report and wires intent + materials', async () => {
  const { deps, calls } = fakeDeps()
  const seen = []
  const sessionCompare = async (input) => {
    seen.push(input)
    return '# 对比报告'
  }
  const out = await runCompare('/proj', repos, { config: cfgOn, sessionCompare, deps })
  assert.equal(out.report, '# 对比报告')
  assert.deepEqual(out.repos, [
    { full_name: 'a/big', html_url: 'https://github.com/a/big' },
    { full_name: 'g/ok', html_url: 'https://github.com/g/ok' },
  ])
  // intent read from the requested path
  assert.deepEqual(calls[0], ['intent', '/proj'])
  // session model got intent + picked repos + materials
  assert.equal(seen[0].intent.name, 'sessionkit')
  assert.equal(seen[0].repos.length, 2)
  assert.equal(seen[0].materials[0].readme, '# a/big readme')
  assert.deepEqual(seen[0].materials[0].issues, [{ title: 'a/big issue', comments: 2, state: 'open', html_url: 'u' }])
  // fetchers ran for both repos with the config token/proxy
  assert.deepEqual(calls[1], ['readme', 'a/big', 'ghp_t', 'http://p:8080', true])
  assert.ok(calls.some((c) => c[0] === 'issues' && c[1] === 'g/ok'))
})

test('runCompare caps the repo list at compare.maxCount', async () => {
  const { deps } = fakeDeps()
  const seen = []
  const five = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'].map((n) => ({ full_name: n }))
  const out = await runCompare('/p', five, { config: { ...cfgOn, compare: { ...cfgOn.compare, maxCount: 2 } }, sessionCompare: async (i) => { seen.push(i); return 'R' }, deps })
  assert.equal(seen[0].repos.length, 2)
  assert.equal(out.repos.length, 2)
})

test('runCompare tolerates per-repo material failures', async () => {
  const deps = {
    readProjectIntent: async () => ({ ...intent }),
    fetchRepoReadme: async () => { throw new Error('404') },
    fetchRepoIssues: async () => { throw new Error('net') },
  }
  const seen = []
  const out = await runCompare('/p', repos, { config: cfgOn, sessionCompare: async (i) => { seen.push(i); return 'R' }, deps })
  assert.equal(out.report, 'R')
  assert.equal(seen[0].materials[0].readme, null)
  assert.equal(seen[0].materials[1].issues, null)
})

test('runCompare maps a missing or null session model to compare-model', async () => {
  const { deps } = fakeDeps()
  await assert.rejects(
    () => runCompare('/p', repos, { config: cfgOn, deps }),
    (e) => e.code === 'compare-model'
  )
  await assert.rejects(
    () => runCompare('/p', repos, { config: cfgOn, deps, sessionCompare: async () => null }),
    (e) => e.code === 'compare-model'
  )
})
