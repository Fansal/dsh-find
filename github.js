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
