import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_WEIGHTS } from './score.js'

const FILTERS_DEFAULTS = Object.freeze({ minStars: 0, excludeForks: false, excludeArchived: true, languages: Object.freeze([]) })

export function configPath(homeDir) {
  return join(homeDir, '.dsh', 'dsh-find.config.json')
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
    }
  } catch {
    return {
      token: null,
      proxy: null,
      tlsAllowUnauthorized: false,
      llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null },
      scoring: { weights: { ...DEFAULT_WEIGHTS } },
      filters: { minStars: 0, excludeForks: false, excludeArchived: true, languages: [] },
    }
  }
}

export async function saveConfig(config, overrides) {
  const homeDir = overrides?.homeDir ?? homedir()
  const file = configPath(homeDir)
  mkdirSync(join(homeDir, '.dsh'), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8')
}
