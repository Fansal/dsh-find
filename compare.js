// compare.js — 对比咨询 orchestration (m05495): given the user's project and
// a list of repo objects picked in the panel, pull each repo's README + top
// issues, hand everything to the DSH session model, and return a four-part
// Chinese advice report (功能差距/踩坑预警/架构借鉴/优先级建议).
//
// Gated by config.compare.enabled — the panel doesn't render the button when
// off, but the route stays reachable so the gate is re-checked here.

import { readProjectIntent } from './intent.js'
import { fetchRepoReadme, fetchRepoIssues } from './github.js'

export class CompareError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CompareError'
    this.code = code
  }
}

const defaultDeps = { readProjectIntent, fetchRepoReadme, fetchRepoIssues }

// Keep only the fields the prompt needs, from client-supplied objects.
// Never trust the whole shape: the client posts these over localhost HTTP.
function pickRepo(r) {
  if (!r || typeof r.full_name !== 'string' || !r.full_name) return null
  return {
    full_name: r.full_name,
    html_url: typeof r.html_url === 'string' ? r.html_url : '',
    description: typeof r.description === 'string' ? r.description : '',
    language: typeof r.language === 'string' ? r.language : '',
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 10).map(String) : [],
    stargazers_count: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
  }
}

export async function runCompare(path, repos, opts = {}) {
  const deps = { ...defaultDeps, ...(opts.deps ?? {}) }
  const config = opts.config ?? {}
  const cmp = config.compare && typeof config.compare === 'object' ? config.compare : null
  if (!cmp || cmp.enabled !== true) {
    throw new CompareError('compare-disabled', '对比咨询未开启，可在设置页打开')
  }
  if (!path || typeof path !== 'string') {
    throw new CompareError('bad-path', 'path required')
  }
  if (!Array.isArray(repos) || repos.length === 0) {
    throw new CompareError('compare-empty', '没有可对比的仓库')
  }
  const maxCount = typeof cmp.maxCount === 'number' && cmp.maxCount > 0 ? Math.min(10, Math.round(cmp.maxCount)) : 3
  const picked = []
  for (const r of repos) {
    if (picked.length >= maxCount) break
    const p = pickRepo(r)
    if (p) picked.push(p)
  }
  if (picked.length === 0) {
    throw new CompareError('compare-empty', '没有可对比的仓库')
  }

  // The report is anchored on the CURRENT project intent — analyze results
  // may be cached/stale, so read fresh (same helper analyze.js uses).
  const intent = await deps.readProjectIntent(path)

  // Per-repo materials in parallel; a single repo's README/issues failing must
  // not sink the whole report — degrade that repo to metadata-only.
  const fetchOpts = {
    token: typeof config.token === 'string' ? config.token : undefined,
    proxy: typeof config.proxy === 'string' ? config.proxy : undefined,
    tlsAllowUnauthorized: config.tlsAllowUnauthorized === true,
  }
  const materials = await Promise.all(picked.map(async (r) => {
    const [readme, issues] = await Promise.all([
      deps.fetchRepoReadme(r.full_name, fetchOpts).catch(() => null),
      deps.fetchRepoIssues(r.full_name, fetchOpts).catch(() => null),
    ])
    return { readme, issues }
  }))

  const sessionCompare = typeof opts.sessionCompare === 'function' ? opts.sessionCompare : null
  const modelError = new CompareError('compare-model', '会话模型不可用，无法生成对比报告（可稍后重试）')
  if (!sessionCompare) throw modelError
  const report = await sessionCompare({ intent, repos: picked, materials })
  if (!report || typeof report !== 'string') throw modelError
  return {
    report,
    repos: picked.map((r) => ({ full_name: r.full_name, html_url: r.html_url })),
  }
}
