import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_WEIGHTS, normalizeSort } from './score.js'

const FILTERS_DEFAULTS = Object.freeze({ minStars: 0, excludeForks: false, excludeArchived: true, languages: Object.freeze([]) })

// m04619: result cap is user-tunable (settings page + panel「加载更多」).
// 10 is the historical default; 50 keeps the panel usable and the GitHub
// search budget sane (4 queries x per_page 20 = 80 raw hits at most).
export const LIMIT_DEFAULT = 10
export const LIMIT_MAX = 50

export function configPath(homeDir) {
  return join(homeDir, '.dsh', 'dsh-find.config.json')
}

/** Clamp a requested result cap into [1, LIMIT_MAX]; anything unusable = default. */
export function sanitizeLimit(v) {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v)
  if (!Number.isFinite(n)) return LIMIT_DEFAULT
  return Math.min(LIMIT_MAX, Math.max(1, Math.round(n)))
}

// Keep only explicit finite non-negative numbers for the known weight keys;
// null/undefined/absent or anything else falls back to the default so a
// hand-edited config can't break scoring (Number(null) is 0 — not "unset").
function sanitizeWeights(v) {
  const w = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  const out = {}
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const raw = w[key]
    const n = raw === null || raw === undefined ? NaN : Number(raw)
    out[key] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEIGHTS[key]
  }
  return out
}

// Filters: minStars (finite >=0 number), excludeForks (boolean), languages
// (array of strings). Anything invalid falls back to the no-op default.
function sanitizeFilters(v) {
  const f = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  const minStars = f.minStars === null || f.minStars === undefined ? NaN : Number(f.minStars)
  const languages = Array.isArray(f.languages) ? f.languages.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim()) : []
  return {
    minStars: Number.isFinite(minStars) && minStars >= 0 ? minStars : FILTERS_DEFAULTS.minStars,
    excludeForks: f.excludeForks === true,
    // m02773: "Moved to wharfkit/js"-style relocated stubs are archived:true and
    // pure search noise — exclude archived by DEFAULT (opt-out via explicit false)
    excludeArchived: f.excludeArchived === false ? false : true,
    languages,
  }
}

// m05495: compare advice (「对比咨询」) — settings-gated (default OFF). When
// enabled the panel offers per-repo / top-N comparison reports built from the
// repo's README + top issues through the session model. Thresholds keep noise
// out: tiny repos carry no lessons to borrow, stale repos carry outdated ones.
export const COMPARE_DEFAULTS = Object.freeze({
  enabled: false,
  minStars: 100,
  minRelevance: 50,
  maxCount: 3,
  months: 24,
})

/** Clamp one compare threshold; anything unusable = its default. */
function cmpNum(raw, def, lo, hi) {
  const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def
}

function sanitizeCompare(v) {
  const c = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  return {
    enabled: c.enabled === true,
    minStars: cmpNum(c.minStars, COMPARE_DEFAULTS.minStars, 0, 100000),
    minRelevance: cmpNum(c.minRelevance, COMPARE_DEFAULTS.minRelevance, 0, 100),
    maxCount: cmpNum(c.maxCount, COMPARE_DEFAULTS.maxCount, 1, 5),
    months: cmpNum(c.months, COMPARE_DEFAULTS.months, 1, 120),
  }
}

export async function loadConfig(overrides) {
  const homeDir = overrides?.homeDir ?? homedir()
  const file = configPath(homeDir)
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('unexpected config shape')
    }
    const llm = parsed.llm && typeof parsed.llm === 'object' && !Array.isArray(parsed.llm) ? parsed.llm : {}
    return {
      token: typeof parsed.token === 'string' ? parsed.token : null,
      proxy: typeof parsed.proxy === 'string' ? parsed.proxy : null,
      // m03271: corporate MITM re-signs HTTPS; opt-in escape hatch only
      tlsAllowUnauthorized: parsed.tlsAllowUnauthorized === true,
      llm: {
        mode: llm.mode === 'openai' ? 'openai' : 'dsh',
        baseUrl: typeof llm.baseUrl === 'string' ? llm.baseUrl : null,
        apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : null,
        model: typeof llm.model === 'string' ? llm.model : null,
      },
      scoring: { weights: sanitizeWeights(parsed.scoring?.weights) },
      filters: sanitizeFilters(parsed.filters),
      limit: sanitizeLimit(parsed.limit),
      // m04619: default panel sort persisted across sessions
      sort: normalizeSort(parsed.sort),
      // m05495: compare-advice switch + thresholds (settings-gated, default off)
      compare: sanitizeCompare(parsed.compare),
    }
  } catch {
    return {
      token: null,
      proxy: null,
      tlsAllowUnauthorized: false,
      llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null },
      scoring: { weights: { ...DEFAULT_WEIGHTS } },
      filters: { minStars: 0, excludeForks: false, excludeArchived: true, languages: [] },
      limit: LIMIT_DEFAULT,
      sort: 'relevance',
      compare: { ...COMPARE_DEFAULTS },
    }
  }
}

export async function saveConfig(config, overrides) {
  const homeDir = overrides?.homeDir ?? homedir()
  const file = configPath(homeDir)
  mkdirSync(join(homeDir, '.dsh'), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8')
}
