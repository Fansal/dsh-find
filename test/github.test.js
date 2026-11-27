import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchRepositories, GithubError } from '../github.js'

test('searchRepositories maps github response', async () => {
  const fetchImpl = async (url, init) => ({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'd', stargazers_count: 5, language: 'js', topics: ['x'], updated_at: '2026-01-01T00:00:00Z', fork: true }] }),
  })
  const repos = await searchRepositories('markdown parser', { fetchImpl })
  assert.equal(repos.length, 1)
  assert.equal(repos[0].full_name, 'a/b')
  assert.equal(repos[0].stargazers_count, 5)
  assert.equal(repos[0].fork, true)
})

test('searchRepositories maps fork false when absent', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ full_name: 'a/b' }] }),
  })
  const repos = await searchRepositories('x', { fetchImpl })
  assert.equal(repos[0].fork, false)
})

test('searchRepositories throws GithubError with status on 403', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ message: 'rate limit' }) })
  await assert.rejects(() => searchRepositories('x', { fetchImpl }), (e) => e instanceof GithubError && e.status === 403)
})

test('searchRepositories maps archived flag', async () => {
  // "Moved to wharfkit/js" stub repos are archived:true — the archived flag is
  // the reliable signal to filter these moved/relocated shells out.
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ full_name: 'a/moved', archived: true }, { full_name: 'a/live' }] }),
  })
  const repos = await searchRepositories('x', { fetchImpl })
  assert.equal(repos[0].archived, true)
  assert.equal(repos[1].archived, false)
})

test('searchRepositories 401 sets status 401', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ message: 'bad token' }) })
  await assert.rejects(() => searchRepositories('x', { token: 'bad', fetchImpl }), (e) => e instanceof GithubError && e.status === 401)
})

// m03271: corporate MITM (firewall/AV HTTPS scan) re-signs traffic with a root
// that Windows trusts but node's bundled CA does not -> UNABLE_TO_VERIFY_LEAF_
// SIGNATURE. Surface it as a distinct tls status so the panel can explain it,
// and honor config.tlsAllowUnauthorized as an escape hatch.
test('tls verify failure gets status "tls"', async () => {
  const boom = new TypeError('fetch failed')
  boom.cause = new Error('UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  boom.cause.code = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  const fetchImpl = async () => {
    throw boom
  }
  await assert.rejects(
    () => searchRepositories('x', { fetchImpl }),
    (e) => e instanceof GithubError && e.status === 'tls' && /证书/.test(e.message),
  )
})

test('tlsAllowUnauthorized with injected fetchImpl behaves like plain call', async () => {
  // injected fetchImpl owns the transport entirely; the insecure retry path is
  // rawFetch-only (real E2E on this MITM'd machine covers it live).
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ items: [{ full_name: 'a/b' }] }) })
  const repos = await searchRepositories('x', { fetchImpl, tlsAllowUnauthorized: true })
  assert.equal(repos.length, 1)
})

test('tls error also recognized via cause chain (err.message form)', async () => {
  const boom = new Error('unable to verify the first certificate')
  const fetchImpl = async () => {
    throw boom
  }
  await assert.rejects(() => searchRepositories('x', { fetchImpl }), (e) => e instanceof GithubError && e.status === 'tls')
})

// ---- m05495: material fetchers for compare advice ----

import { fetchRepoReadme, fetchRepoIssues } from '../github.js'

test('fetchRepoReadme requests the raw Accept and returns text', async () => {
  let seenUrl = ''
  let seenAccept = ''
  const fetchImpl = async (url, init) => {
    seenUrl = url
    seenAccept = init.headers.Accept
    return { ok: true, status: 200, text: async () => '# hello readme' }
  }
  const readme = await fetchRepoReadme('a/b', { fetchImpl })
  assert.equal(readme, '# hello readme')
  assert.equal(seenUrl, 'https://api.github.com/repos/a/b/readme')
  assert.equal(seenAccept, 'application/vnd.github.raw')
})

test('fetchRepoReadme sends the bearer token when provided', async () => {
  let seenAuth = null
  const fetchImpl = async (url, init) => {
    seenAuth = init.headers.Authorization
    return { ok: true, status: 200, text: async () => 'x' }
  }
  await fetchRepoReadme('a/b', { fetchImpl, token: 'ghp_t' })
  assert.equal(seenAuth, 'Bearer ghp_t')
})

test('fetchRepoReadme rejects on 404 (no README) with GithubError', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 })
  await assert.rejects(() => fetchRepoReadme('a/b', { fetchImpl }), (e) => e instanceof GithubError && e.status === 404)
})

test('fetchRepoReadme rejects an invalid repo name', async () => {
  await assert.rejects(() => fetchRepoReadme('not-a-slash-name', {}), (e) => e instanceof GithubError && e.status === 400)
  await assert.rejects(() => fetchRepoReadme('a/b/c', {}), (e) => e instanceof GithubError && e.status === 400)
})

test('fetchRepoIssues sorts by comments, drops PRs, caps at 8, maps fields', async () => {
  let seenUrl = ''
  const fetchImpl = async (url) => {
    seenUrl = url
    const items = []
    for (let i = 0; i < 12; i++) {
      items.push({ title: `issue ${i}`, comments: 10 - i, state: i % 2 ? 'closed' : 'open', html_url: `u${i}`, pull_request: i % 3 === 0 ? {} : undefined })
    }
    return { ok: true, status: 200, json: async () => items }
  }
  const issues = await fetchRepoIssues('a/b', { fetchImpl })
  assert.equal(seenUrl, 'https://api.github.com/repos/a/b/issues?sort=comments&direction=desc&per_page=10&state=all')
  // 12 items - 4 PRs = 8 issues, then capped at 8 anyway
  assert.equal(issues.length, 8)
  assert.equal(issues[0].title, 'issue 1') // first non-PR
  assert.ok(!issues.some((i) => i.title === 'issue 0')) // PR dropped
  assert.equal(issues[0].comments, 9)
  assert.equal(issues[0].state, 'closed')
  assert.equal(issues[0].html_url, 'u1')
})

test('fetchRepoIssues tolerates a non-array response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ oops: true }) })
  const issues = await fetchRepoIssues('a/b', { fetchImpl })
  assert.deepEqual(issues, [])
})
