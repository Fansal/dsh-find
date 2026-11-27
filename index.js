import { registerAnalyzeRoute } from './route.js'
import { loadConfig, saveConfig } from './config.js'
import { analyzeProject } from './analyze.js'
import { sessionModelSummaries, sessionModelQueries } from './llm.js'
import { createResultCache } from './cache.js'

export const name = 'dsh-find'
export const inject = ['webServer']

/**
 * Shared plumbing for both session-model providers: resolve the host LLM and
 * the session's current model selection lazily (never in `inject`, so a
 * missing service can't break plugin load), log diagnostics to the DSH log
 * file, and swallow every failure into null so the pipeline falls back.
 */
function makeSessionRunner(ctx, label, work) {
  const log = (...args) => {
    try {
      // host.stderr output lands in the DSH log file
      console.warn(`[dsh-find:${label}]`, ...args)
    } catch { /* logging must never break the flow */ }
  }
  const probe = (name) => {
    try {
      return !!ctx.get(name)
    } catch (e) {
      return `err:${e?.message ?? e}`
    }
  }
  return async (input) => {
    const startedAt = Date.now()
    try {
      const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
      const adm = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      const selection = adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : null
      log('services llm=%s agentDefaultModel=%s (webServer=%s tools=%s) selection=%s',
        probe('llm'), probe('agentDefaultModel'), probe('webServer'), probe('tools'),
        JSON.stringify(selection ?? null))
      if (!llm || !selection) {
        log('unavailable -> fallback')
        return null
      }
      const out = await work(input, { llm, selection, log })
      log('result: %s (%dms)', out ? 'ok' : 'null (fallback)', Date.now() - startedAt)
      return out
    } catch (e) {
      log('failed: %s (%dms)', e?.stack ?? String(e), Date.now() - startedAt)
      return null
    }
  }
}

export function apply(ctx) {
  const sessionSummary = makeSessionRunner(ctx, 'sessionSummary', async (repos, { llm, selection, log }) => {
    try {
      const providers = llm.listProviders?.()
      if (Array.isArray(providers)) log('providers:', providers.map((p) => p?.id).join(','))
    } catch (e) {
      log('listProviders failed:', e?.message ?? String(e))
    }
    const map = await sessionModelSummaries(repos, { llm, selection, log })
    if (map) log('parse result: map size %d', map.size)
    return map
  })
  const sessionQueryRefine = makeSessionRunner(ctx, 'sessionQueries', async (intent, { llm, selection, log }) => {
    const queries = await sessionModelQueries(intent, { llm, selection, log })
    return queries
  })

  const analyze = (path, opts = {}) => analyzeProject(path, { ...opts, sessionSummary, sessionQueryRefine })
  const cache = createResultCache() // TTL 10min, max 8 entries, config-change invalidates
  ctx.effect(() => registerAnalyzeRoute({
    webServer: ctx.webServer,
    loadConfig,
    saveConfig,
    analyzeProject: analyze,
    cache,
    guards: { rejectForeignOrigin: null, readBody: null },
  }), 'dsh-find: routes')
}
