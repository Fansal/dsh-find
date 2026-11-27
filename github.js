export class GithubError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'GithubError'
    this.status = status
  }
}

// review minor: a fresh ProxyAgent per call would leak unclosed connection
// pools on repeated analyzes — cache one agent per proxy URL and reuse it.
const proxyAgents = new Map()

// m03271: corporate MITM (firewall/AV HTTPS scan) re-signs traffic with roots
// Windows trusts but node's bundled CA does not. TLS verification failures get
// status "tls" (distinct panel copy) instead of the generic network error.
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

function isTlsError(err) {
  const codes = [err?.cause?.code, err?.code]
  const texts = [err?.cause?.message, err?.cause?.code, err?.message]
  if (codes.some((c) => typeof c === 'string' && TLS_CODES.has(c))) return true
  return texts.some((t) => typeof t === 'string' && /unable to verify|self.signed|first certificate|certificate has expired/i.test(t))
}

async function insecureDispatcher(proxy) {
  const { Agent, ProxyAgent } = await import('undici')
  const connect = { rejectUnauthorized: false }
  if (proxy) {
    let d = proxyAgents.get('insecure:' + proxy)
    if (!d) {
      d = new ProxyAgent({ uri: proxy, connect })
      proxyAgents.set('insecure:' + proxy, d)
    }
    return d
  }
  let d = proxyAgents.get('insecure:__direct__')
  if (!d) {
    d = new Agent({ connect })
    proxyAgents.set('insecure:__direct__', d)
  }
  return d
}

async function rawFetch(url, init, proxy, tlsAllowUnauthorized) {
  if (proxy) {
    const { fetch: undiciFetch, ProxyAgent } = await import('undici')
    let dispatcher = proxyAgents.get(proxy)
    if (!dispatcher) {
      dispatcher = new ProxyAgent(proxy)
      proxyAgents.set(proxy, dispatcher)
    }
    if (tlsAllowUnauthorized) dispatcher = await insecureDispatcher(proxy)
    return undiciFetch(url, { ...init, dispatcher })
  }
  if (tlsAllowUnauthorized) {
    const { fetch: undiciFetch } = await import('undici')
    const dispatcher = await insecureDispatcher(null)
    return undiciFetch(url, { ...init, dispatcher })
  }
  return globalThis.fetch(url, init)
}

export async function searchRepositories(query, opts = {}) {
  const { token, proxy, fetchImpl, tlsAllowUnauthorized } = opts
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(query) + '&per_page=20&sort=stars'
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    const init = { method: 'GET', headers }
    if (fetchImpl) {
      res = await fetchImpl(url, init)
    } else {
      res = await rawFetch(url, init, proxy, tlsAllowUnauthorized)
    }
  } catch (err) {
    if (isTlsError(err)) {
      throw new GithubError('tls', `network-tls: ${err?.cause?.code ?? err?.message ?? String(err)}（HTTPS 证书校验失败）`)
    }
    throw new GithubError(0, `network: ${err?.message ?? String(err)}`)
  }

  if (!res.ok) {
    let message = `GitHub API error ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body.message === 'string') message = body.message
    } catch {
      /* keep default message */
    }
    throw new GithubError(res.status, message)
  }

  const data = await res.json()
  const items = Array.isArray(data.items) ? data.items : []
  return items.map((r) => ({
    full_name: r.full_name ?? '',
    html_url: r.html_url ?? '',
    description: r.description ?? null,
    stargazers_count: r.stargazers_count ?? 0,
    language: r.language ?? null,
    topics: Array.isArray(r.topics) ? r.topics : [],
    updated_at: r.updated_at ?? null,
    fork: r.fork === true,
    archived: r.archived === true,
  }))
}

// ---- m05495: per-repo material fetchers for compare advice (「对比咨询」) ----

/** Validate an "owner/repo" full name into an API path segment pair. */
function repoPath(fullName) {
  const parts = String(fullName || '').split('/')
  // exactly two non-empty segments — 'a/b/c' must not slip through as 'a/b'
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GithubError(400, `invalid repo name: ${String(fullName)}`)
  }
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`
}

/** Shared GET plumbing for the material fetchers (same error surface as search). */
async function ghGet(url, opts, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`
  let res
  try {
    const init = { method: 'GET', headers }
    if (opts?.fetchImpl) res = await opts.fetchImpl(url, init)
    else res = await rawFetch(url, init, opts?.proxy, opts?.tlsAllowUnauthorized)
  } catch (err) {
    if (isTlsError(err)) {
      throw new GithubError('tls', `network-tls: ${err?.cause?.code ?? err?.message ?? String(err)}（HTTPS 证书校验失败）`)
    }
    throw new GithubError(0, `network: ${err?.message ?? String(err)}`)
  }
  if (!res.ok) throw new GithubError(res.status, `GitHub API error ${res.status}`)
  return res
}

/**
 * Fetch a repo's README as raw text (Accept: vnd.github.raw). 404 (no README)
 * surfaces as GithubError status 404 — compare.js treats any failure as
 * "no material" and keeps going with metadata only.
 */
export async function fetchRepoReadme(fullName, opts = {}) {
  // vnd.github.raw makes the README endpoint return the decoded file body
  // instead of the blob-metadata JSON the default Accept would yield.
  const res = await ghGet(`https://api.github.com/repos/${repoPath(fullName)}/readme`, opts, 'application/vnd.github.raw')
  return await res.text()
}

/**
 * Fetch the repo's most-commented issues (its loudest pain points). The
 * issues API also lists PRs — filtered out. Capped at 8: enough signal for
 * a comparison report, bounded prompt size.
 */
export async function fetchRepoIssues(fullName, opts = {}) {
  const res = await ghGet(`https://api.github.com/repos/${repoPath(fullName)}/issues?sort=comments&direction=desc&per_page=10&state=all`, opts)
  const data = await res.json()
  const items = Array.isArray(data) ? data : []
  return items
    .filter((i) => i && typeof i === 'object' && typeof i.title === 'string' && !i.pull_request)
    .slice(0, 8)
    .map((i) => ({
      title: i.title,
      comments: i.comments ?? 0,
      state: i.state ?? null,
      html_url: i.html_url ?? '',
    }))
}
