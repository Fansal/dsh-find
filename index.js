import { registerAnalyzeRoute } from './route.js'
import { loadConfig, saveConfig } from './config.js'
import { analyzeProject } from './analyze.js'
import { sessionModelSummaries } from './llm.js'
import { createResultCache } from './cache.js'

export const name = 'dsh-find'
export const inject = ['webServer']

/**
 * Build the analyzeProject wrapper that wires a sessionSummary provider using
 * the host LLM (the session's model). Mirrors dsh-experimental-translator:
 * resolve ctx.get("llm") + ctx.get("agentDefaultModel") dynamically instead of
 * declaring them in `inject` (a missing service must not break plugin load).
 * Any failure returns null so analyzeProject keeps the heuristic summary.
 */
function makeSessionSummary(ctx) {
  const log = (...args) => {
    try {
      // host.stderr output lands in the DSH log file
      console.warn('[dsh-find:sessionSummary]', ...args)
    } catch { /* logging must never break the flow */ }
  }
  const probe = (name) => {
    try {
      return !!ctx.get(name)
    } catch (e) {
      return `err:${e?.message ?? e}`
    }
  }
  return async (repos) => {
    const startedAt = Date.now()
    try {
      const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
      const adm = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
      const selection = adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : null
      log('services llm=%s agentDefaultModel=%s (webServer=%s tools=%s) selection=%s',
        probe('llm'), probe('agentDefaultModel'), probe('webServer'), probe('tools'),
        JSON.stringify(selection ?? null))
      if (!llm || !selection) {
        log('unavailable -> keep heuristic summary')
        return null
      }
      try {
        const providers = llm.listProviders?.()
        if (Array.isArray(providers)) log('providers:', providers.map((p) => p?.id).join(','))
      } catch (e) {
        log('listProviders failed:', e?.message ?? String(e))
      }
      const map = await sessionModelSummaries(repos, { llm, selection, log })
      log('result: %s (%dms)', map ? `map size ${map.size}` : 'null (kept heuristic)', Date.now() - startedAt)
      return map
    } catch (e) {
      log('failed: %s (%dms)', e?.stack ?? String(e), Date.now() - startedAt)
      return null
    }
  }
}

export function apply(ctx) {
  const analyze = (path, opts = {}) => analyzeProject(path, { ...opts, sessionSummary: makeSessionSummary(ctx) })
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
