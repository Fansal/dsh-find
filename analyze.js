import { stat } from 'node:fs/promises'
import { readProjectIntent } from './intent.js'
import { buildSearchQueries } from './query.js'
import { searchRepositories, GithubError } from './github.js'
import { rankRepos, sortRepos } from './score.js'
import { llmRefineQueries, llmRerank } from './llm.js'
import { summarizeRepo } from './summarize.js'
import { sanitizeLimit } from './config.js'
import { sanitizeText } from './query.js'

export class ProjectError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProjectError'
    this.code = code
  }
}

const defaultDeps = {
  readProjectIntent,
  buildSearchQueries,
  searchRepositories,
  rankRepos,
  llmRefineQueries,
  llmRerank,
}

function isEmpty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

// Result-quality filters (config.filters): minStars floor, fork exclusion and
// an optional case-insensitive language whitelist. No filters = no-op.
function applyFilters(repos, filters) {
  if (!filters || typeof filters !== 'object') return repos
  const minStars = typeof filters.minStars === 'number' && filters.minStars > 0 ? filters.minStars : 0
  const excludeForks = filters.excludeForks === true
  const excludeArchived = filters.excludeArchived === true
  const langs = Array.isArray(filters.languages) && filters.languages.length
    ? new Set(filters.languages.map((l) => String(l).toLowerCase()))
    : null
  return repos.filter((r) => {
    if ((r.stargazers_count ?? 0) < minStars) return false
    if (excludeForks && r.fork === true) return false
    // m02773: relocated stubs ("Moved to wharfkit/js") are archived:true noise
    if (excludeArchived && r.archived === true) return false
    if (langs && !(r.language ? langs.has(String(r.language).toLowerCase()) : false)) return false
    return true
  })
}

// Run every query; 403 propagates immediately, 401 propagates for the caller's
// anonymous-fallback decision. Other failures are skipped (失败不中断) BUT if
// every query fails (e.g. bad proxy / no network -> GithubError(0)), an empty
// result would mislead the panel into "没找到相似项目" — surface it as the
// last error instead so callers can show a network hint (review major).
async function searchAll(deps, queries, searchOpts) {
  const out = []
  let lastError = null
  let failures = 0
  for (const q of queries) {
    try {
      out.push(...(await deps.searchRepositories(q, searchOpts)))
    } catch (e) {
      if (e instanceof GithubError && (e.status === 403 || e.status === 401)) throw e
      failures += 1
      lastError = e
    }
  }
  if (out.length === 0 && failures === queries.length && queries.length > 0 && lastError) {
    throw lastError
  }
  return out
}

export async function analyzeProject(path, opts = {}) {
  const deps = { ...defaultDeps, ...(opts.deps ?? {}) }
  const config = opts.config ?? { token: null, proxy: null, llm: {} }
  const llm = config.llm ?? {}
  const llmOn = llm.mode === 'openai'

  // Real callers (no injected deps) get the filesystem precheck; injected deps
  // own path reality, so tests can use fake paths.
  if (!opts.deps) {
    try {
      await stat(path)
    } catch {
      throw new ProjectError('no-project', '目录不存在或不可读')
    }
  }

  const intent = await deps.readProjectIntent(path)
  if (isEmpty(intent.name) && isEmpty(intent.description) && isEmpty(intent.keywords)) {
    throw new ProjectError('no-metadata', '未找到项目元数据（package.json / README / .git）')
  }

  let queries = null
  let llmUsed = false
  if (llmOn) {
    const q1 = await deps.llmRefineQueries(intent, llm)
    if (Array.isArray(q1) && q1.length) {
      queries = q1.slice(0, 3)
      llmUsed = true
    }
  }
  // m04619: mode 'dsh' now also refines queries through the session model
  // (previously it only produced the Chinese summaries). The provider is
  // injected by index.js; when the session model is unavailable it returns
  // null and we keep the heuristic queries.
  if (!queries && llm.mode === 'dsh' && typeof opts.sessionQueryRefine === 'function') {
    try {
      const q2 = await opts.sessionQueryRefine(intent)
      const cleaned = Array.isArray(q2)
        ? q2.map((q) => sanitizeText(q)).filter(Boolean).slice(0, 3)
        : []
      if (cleaned.length) {
        queries = cleaned
        llmUsed = true
      }
    } catch {
      // fall through to heuristic queries
    }
  }
  if (!queries) queries = deps.buildSearchQueries(intent)
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new ProjectError('no-metadata', '未提炼出有效搜索词')
  }

  const searchOpts = { token: config.token ?? null, proxy: config.proxy ?? null, tlsAllowUnauthorized: config.tlsAllowUnauthorized === true }
  let raw
  try {
    raw = await searchAll(deps, queries, searchOpts)
  } catch (e) {
    if (e instanceof GithubError && e.status === 401 && searchOpts.token) {
      // bad token → one full anonymous retry round
      raw = await searchAll(deps, queries, { ...searchOpts, token: null })
    } else {
      throw e
    }
  }

  const seen = new Set()
  const merged = []
  for (const r of raw) {
    const key = r.full_name
    if (key && !seen.has(key)) {
      seen.add(key)
      merged.push(r)
    }
  }

  const filtered = applyFilters(merged, config.filters)
  // m04619: result cap is config-driven (settings page), clamped in config.js.
  const limit = sanitizeLimit(config.limit)
  let repos = deps.rankRepos(intent, filtered, limit, config.scoring?.weights)
  if (llmOn && Array.isArray(repos) && repos.length) {
    const rer = await deps.llmRerank(intent, repos, llm)
    if (Array.isArray(rer) && rer.length) {
      repos = rer
      llmUsed = true
    }
  }

  // m04619: panel sort switcher — re-sort the ranked pool by the requested
  // objective (config default or per-call override via route). 'relevance'
  // keeps the scorer's order (same array, historical behaviour).
  const sorted = sortRepos(repos, config.sort)

  const trimmed = (sorted ?? []).slice(0, limit)
  for (const r of trimmed) {
    r.summary = summarizeRepo(r)
    r.summarySource = 'heuristic'
  }

  // m05495: compare-advice candidates (「对比咨询」) — settings-gated. The
  // candidate list is computed from the trimmed results (what the user sees),
  // filtered by the configured thresholds: relevance ("真同类"), stars (a repo
  // with no community carries no lessons), recency (stale repos carry
  // outdated ones). Client renders compare buttons only when enabled.
  const MONTH_MS = 30.5 * 24 * 3600 * 1000
  const cmp = config.compare?.enabled === true ? config.compare : null
  const compareCandidates = []
  if (cmp) {
    const cutoff = Date.now() - (cmp.months || 24) * MONTH_MS
    for (const r of trimmed) {
      if (compareCandidates.length >= (cmp.maxCount || 3)) break
      if ((r.relevance ?? 0) < (cmp.minRelevance ?? 50)) continue
      if ((r.stargazers_count ?? 0) < (cmp.minStars ?? 100)) continue
      if (r.fork || r.archived) continue
      if (r.updated_at && Date.parse(r.updated_at) < cutoff) continue
      compareCandidates.push({ full_name: r.full_name, html_url: r.html_url })
    }
  }

  // Optional host-session-model layer: if a sessionSummary provider is wired
  // (index.js injects one that talks to ctx.get("llm")), let its Chinese
  // one-liners override the heuristic summary. Any failure keeps heuristics.
  if (typeof opts.sessionSummary === 'function' && trimmed.length) {
    try {
      const zhMap = await opts.sessionSummary(trimmed)
      if (zhMap instanceof Map && zhMap.size) {
        for (const r of trimmed) {
          const zh = zhMap.get(r.full_name)
          if (typeof zh === 'string' && zh.trim()) {
            r.summary = zh.trim()
            r.summarySource = 'model'
          }
        }
      }
    } catch {
      // keep heuristic summaries
    }
  }

  return {
    repos: trimmed,
    source: llmUsed ? 'llm' : 'heuristic',
    nameSource: intent.nameSource ?? 'pkg',
    // m04619: echo the effective cap so the panel can show/hide「加载更多」
    limit,
    // m03591: when the container dir had no markers and we adopted a child
    // project, the panel shows which child the search was based on.
    detectedPath: intent.detectedPath ?? null,
    // m05495: which repos qualify for compare advice (empty when disabled)
    compareCandidates,
  }
}
