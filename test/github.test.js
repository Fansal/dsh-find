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
