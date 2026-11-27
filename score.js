import { extractKeywords } from './intent.js'

const STAR_MAX_LOG2 = Math.log2(1000001)

// Default scoring weights. Config sanitizes + merges the same keys
// (config.js sanitizeWeights iterates DEFAULT_WEIGHTS), so the two stay in sync.
export const DEFAULT_WEIGHTS = Object.freeze({
  language: 25,
  keywordPerHit: 5,
  keywordCap: 45,
  stars: 20,
  recent: 10,
})

function isRecentTwoYears(updatedAt) {
  if (!updatedAt) return false
  const t = Date.parse(updatedAt)
  if (Number.isNaN(t)) return false
  const cutoff = Date.now() - 2 * 365 * 24 * 3600 * 1000
  return t >= cutoff
}

function similarity(intent, repo, keywords, weights = DEFAULT_WEIGHTS) {
  let score = 0

  if (intent.language && repo.language && intent.language.toLowerCase() === repo.language.toLowerCase()) {
    score += weights.language
  }

  const haystack = [repo.full_name ?? '', repo.description ?? '', (repo.topics ?? []).join(' ')]
    .join(' ')
    .toLowerCase()
  const words = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean))

  let hits = 0
  for (const kw of keywords) {
    if (words.has(kw)) hits += 1
  }
  score += Math.min(hits * weights.keywordPerHit, weights.keywordCap)

  score += (Math.log2((repo.stargazers_count ?? 0) + 1) / STAR_MAX_LOG2) * weights.stars

  if (isRecentTwoYears(repo.updated_at)) score += weights.recent

  return score
}

export function rankRepos(intent, repos, limit = 10, weights = DEFAULT_WEIGHTS) {
  const keywords = extractKeywords(intent)
  // theoretical max score under the active weights — relevance is the raw
  // score normalized to 0-100 so the panel can display it (相关性按钮)
  const maxScore = weights.language + weights.keywordCap + weights.stars + weights.recent
  return repos
    .map((repo) => ({ repo, score: similarity(intent, repo, keywords, weights) }))
    .sort((a, b) => b.score - a.score || (b.repo.stargazers_count ?? 0) - (a.repo.stargazers_count ?? 0))
    .slice(0, limit)
    .map((x) => {
      x.repo.relevance = maxScore > 0 ? Math.round((x.score / maxScore) * 100) : 0
      return x.repo
    })
}

// m04619: panel sort switcher. 'relevance' keeps the scorer's order (the
// historical behaviour); the other two re-sort the candidate pool by a single
// objective key so users can look past the relevance heuristic.
export const SORTS = Object.freeze(['relevance', 'stars', 'updated'])

export function normalizeSort(v) {
  return SORTS.includes(v) ? v : 'relevance'
}

/** Re-sort already-scored repos. Never mutates the input array. */
export function sortRepos(repos, sort) {
  const key = normalizeSort(sort)
  if (key === 'relevance') return repos
  const list = [...(repos ?? [])]
  if (key === 'stars') {
    list.sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
  } else {
    const at = (r) => {
      const t = Date.parse(r.updated_at ?? '')
      return Number.isNaN(t) ? 0 : t
    }
    list.sort((a, b) => at(b) - at(a))
  }
  return list
}
