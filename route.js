// Route registration for dsh-find. Kept separate from index.js so the
// routing logic is unit-testable with a fake webServer (see test/route.test.js).

import { sanitizeLimit } from './config.js'
import { normalizeSort } from './score.js'

/** Send a JSON HTTP response. */
function jsonRes(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** Read the raw body string from a Node.js IncomingMessage. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== 'function') {
      resolve('')
      return
    }
    // review minor: chunk-concatenating raw Buffers can split multi-byte UTF-8
    // (Chinese paths in {path}) into U+FFFD — decode the stream first.
    if (typeof req.setEncoding === 'function') req.setEncoding('utf8')
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * CSRF guard (copied from the sessionkit root plugin): host routes registered
 * via webServer.register bypass the browser-auth fence, so reject a foreign
 * Origin header. Same-origin/no Origin is allowed.
 */
function rejectForeignOrigin(req, res) {
  const origin = req.headers?.origin
  if (!origin) return false
  try {
    const port = new URL(req.headers.host ? `http://${req.headers.host}` : 'http://127.0.0.1:43120').port || '80'
    const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
    if (allowed.has(new URL(origin).origin)) return false
  } catch { /* malformed Origin — reject below */ }
  jsonRes(res, 403, { error: 'Cross-origin request rejected' })
  return true
}

/**
 * Register the dsh-find host routes:
 *   POST /api/dsh-find/analyze  { path }  -> { repos, source } | { error: {...} }
 *   POST /api/dsh-find/config   { token?, proxy?, llm?, scoring?, filters? } -> { ok: true }
 * The config route is only registered when saveConfig is provided.
 * `cache` is optional ({ get(path, config), set(path, config, result) }); when
 * provided, identical analyze calls (same path + unchanged config, TTL-bound)
 * are served from cache without re-running the search or the LLM summary.
 * Guards default to the built-in implementations above; pass null to use them
 * explicitly or omit for the same effect.
 */
export function registerAnalyzeRoute({ webServer, loadConfig, saveConfig, analyzeProject, cache, guards = {} }) {
  const rejectOrigin = guards.rejectForeignOrigin ?? rejectForeignOrigin
  const readBodyFn = guards.readBody ?? readBody

  const analyzeHandler = async (req, res) => {
    if (rejectOrigin(req, res)) return
    try {
      let body = {}
      try {
        body = JSON.parse(await readBodyFn(req))
      } catch {
        body = {}
      }
      if (!body || typeof body.path !== 'string' || !body.path) {
        jsonRes(res, 400, { error: 'path required' })
        return
      }
      const cfg = await loadConfig()
      // m04619: per-call cap override (panel「加载更多」asks for more without
      // rewriting the user's saved setting). Clamped the same way as config.
      if (body.limit !== undefined) cfg.limit = sanitizeLimit(body.limit)
      // m04619: panel sort switcher — per-call override like limit. Mutating the
      // local cfg (not the file) means the cache snapshot naturally separates
      // entries per sort, and the saved config stays untouched.
      if (body.sort !== undefined) cfg.sort = normalizeSort(body.sort)
      // Cache hit: same path + unchanged config within TTL -> skip search + LLM.
      // Duck-typed so tests can pass a plain { get, set } object.
      const cached = typeof cache?.get === 'function' ? cache.get(body.path, cfg) : null
      if (cached) {
        jsonRes(res, 200, cached)
        return
      }
      const out = await analyzeProject(body.path, { config: cfg })
      if (typeof cache?.set === 'function') cache.set(body.path, cfg, out)
      jsonRes(res, 200, out)
    } catch (e) {
      // Duck-typed error mapping: callers/tests may throw structurally
      // compatible errors (status: number / code: string) without sharing classes.
      if (e && typeof e.status === 'number') {
        if (e.status === 403) {
          jsonRes(res, 200, { error: { code: 'rate-limit', message: '已限流，请等待或配置 token' } })
          return
        }
        if (e.status === 401) {
          jsonRes(res, 200, { error: { code: 'auth', message: 'token 无效' } })
          return
        }
        if (e.status === 0) {
          // review major: all queries failed at network/proxy layer — show a
          // real hint instead of the misleading "没找到相似项目" empty-state
          jsonRes(res, 200, { error: { code: 'network', message: '网络错误，请检查网络或代理设置' } })
          return
        }
      }
      // m03271: TLS verify failure (MITM re-signs HTTPS) — status may be the
      // string 'tls' from github.js, so check it before the number check above
      // can't catch it (typeof 'tls' !== 'number').
      if (e && e.status === 'tls') {
        jsonRes(res, 200, { error: { code: 'tls', message: 'HTTPS 证书校验失败（网络有 HTTPS 拦截）。可在配置里开启「跳过证书校验」' } })
        return
      }
      if (e && typeof e.code === 'string') {
        jsonRes(res, 200, { error: { code: e.code, message: e.message } })
        return
      }
      jsonRes(res, 500, { error: e?.message ?? 'internal error' })
    }
  }

  webServer.register({ kind: 'exact', path: '/api/dsh-find/analyze', handler: analyzeHandler })

  // POST /api/dsh-find/config  { token?, proxy?, llm?, scoring?, filters? } -> { ok: true }
  // GET  /api/dsh-find/config  -> { config } : return the current config so the
  // DSH settings page (settings.section slot) can prefill its form.
  // Both live under one exact route (webServer.register would overwrite a
  // second registration of the same path), dispatched by method.
  // The config route is only registered when loadConfig is provided.
  if (loadConfig) {
    const configHandler = async (req, res) => {
      if (rejectOrigin(req, res)) return
      // GET: read-only return of the current config (settings-page prefill).
      if (req.method === 'GET') {
        try {
          const cfg = (await loadConfig()) ?? {}
          jsonRes(res, 200, { config: cfg })
        } catch (err) {
          jsonRes(res, 500, { error: err?.message ?? 'failed to load config' })
        }
        return
      }
      let body
      try {
        body = JSON.parse(await readBodyFn(req))
      } catch (err) {
        jsonRes(res, 400, { error: `invalid json: ${err.message}` })
        return
      }
      // review minor: loadConfig/saveConfig can fail (disk full, permissions) —
      // return a JSON error instead of an unhandled rejection / hung fetch
      try {
        const current = (await loadConfig()) ?? {}
        const merged = { ...current }
        if (body && typeof body === 'object') {
          if (body.token !== undefined) merged.token = body.token
          if (body.proxy !== undefined) merged.proxy = body.proxy
          if (body.tlsAllowUnauthorized !== undefined) merged.tlsAllowUnauthorized = body.tlsAllowUnauthorized === true
          // m04619: result cap (settings page「结果数量」), clamped on load anyway
          if (body.limit !== undefined && body.limit !== '') merged.limit = sanitizeLimit(body.limit)
          // m04619: default sort persisted for the panel's initial order
          if (body.sort !== undefined && body.sort !== '') merged.sort = normalizeSort(body.sort)
          if (body.llm && typeof body.llm === 'object') merged.llm = { ...(merged.llm ?? {}), ...body.llm }
          if (body.scoring && typeof body.scoring === 'object') {
            const cur = merged.scoring ?? {}
            merged.scoring = {
              ...cur,
              ...(body.scoring ?? {}),
              weights: { ...(cur.weights ?? {}), ...(body.scoring.weights ?? {}) },
            }
          }
          if (body.filters && typeof body.filters === 'object') {
            const cur = merged.filters ?? {}
            merged.filters = {
              ...cur,
              ...body.filters,
              languages: Array.isArray(body.filters.languages) ? body.filters.languages : (cur.languages ?? []),
            }
          }
        }
        await saveConfig?.(merged)
        jsonRes(res, 200, { ok: true })
      } catch (err) {
        jsonRes(res, 500, { error: err?.message ?? 'failed to save config' })
      }
    }

    webServer.register({ kind: 'exact', path: '/api/dsh-find/config', handler: configHandler })
  }
}
