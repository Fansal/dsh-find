import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

// Two families: grammar (the/a/for…) and marketing filler that shows up in
// nearly every package.json (plugin, simple, fast, awesome…). Both are noise in
// a GitHub query — 'plugin' alone matches a hundred thousand repos.
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'for', 'and', 'or', 'to', 'of', 'with', 'in', 'on', 'is', 'it', 'this', 'that',
  'app', 'tool', 'library', 'project', 'client', 'server',
  'plugin', 'plugins', 'simple', 'fast', 'easy', 'modern', 'next', 'awesome', 'blazing',
  'lightweight', 'minimal', 'powered', 'based', 'using', 'use', 'via', 'your', 'our', 'my',
])

function readSafe(file) {
  try {
    return readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

function remoteFromGitConfig(configText) {
  // review major: real clone configs have url followed by fetch + [branch]
  // sections, so url is never the last line — $ must match line ends (m flag)
  const m = /url\s*=\s*(.+\.git)\s*$/m.exec(configText)
  return m ? m[1].trim() : null
}

function nameFromRemote(remote) {
  if (!remote) return ''
  const clean = remote.replace(/\.git$/, '').replace(/\/+$/, '')
  const seg = clean.split('/').filter(Boolean)
  return seg[seg.length - 1] ?? ''
}

// m02536: last-resort name — the directory's own basename. Lets a session
// opened in ANY folder (no package.json / README / .git remote) still search
// similar GitHub repos. Priority: pkg name > git remote > dir basename.
function nameFromDir(projectPath) {
  const base = basename(projectPath).trim()
  if (!base || base === '.' || base === '..' || /^[a-zA-Z]:$/.test(base)) return ''
  return base
}

// m03591: container dirs hold the real project one level DOWN (e.g.
// D:\01dsh\plugin\find holding find\dsh-find). Scan immediate children only;
// skip hidden and dependency dirs. A child that is a git repo wins over a
// plain package.json, so the repo (not a scratch package) is adopted.
const SKIP_CHILD_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'out', '.git'])

function findChildProject(root) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith('.') || SKIP_CHILD_DIRS.has(name)) continue
    const dir = join(root, name)
    const pkgRaw = readSafe(join(dir, 'package.json'))
    let pkg = null
    if (pkgRaw) {
      try {
        pkg = JSON.parse(pkgRaw)
      } catch {
        pkg = null
      }
    }
    const gitConfig = readSafe(join(dir, '.git', 'config'))
    if (!pkg && !gitConfig) continue
    candidates.push({ dir, pkg, gitConfig, isRepo: Boolean(gitConfig) })
  }
  if (candidates.length === 0) return null
  // git repos first, then dirs that actually carry a package name, then name order
  candidates.sort((a, b) => {
    if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1
    const an = typeof a.pkg?.name === 'string' ? a.pkg.name : ''
    const bn = typeof b.pkg?.name === 'string' ? b.pkg.name : ''
    if (Boolean(an) !== Boolean(bn)) return an ? -1 : 1
    return a.dir.localeCompare(b.dir)
  })
  return candidates[0]
}

export async function readProjectIntent(projectPath) {
  let pkg = {}
  const pkgRaw = readSafe(join(projectPath, 'package.json'))
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw)
    } catch {
      pkg = {}
    }
  }

  const name = typeof pkg.name === 'string' ? pkg.name : ''
  let description = typeof pkg.description === 'string' ? pkg.description : ''
  let keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((k) => typeof k === 'string') : []
  let language = typeof pkg.language === 'string' ? pkg.language : null
  let deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? Object.keys(pkg.dependencies) : []

  if (!description) {
    const readme = readSafe(join(projectPath, 'README.md')) ?? readSafe(join(projectPath, 'README'))
    if (readme) {
      const lines = readme.split(/\r?\n/).filter((l) => l.trim())
      const body = lines.filter((l) => !/^#/.test(l.trim())).slice(0, 2).join(' ').trim()
      if (body) description = body
    }
  }

  const gitConfig = readSafe(join(projectPath, '.git', 'config'))
  const remote = gitConfig ? remoteFromGitConfig(gitConfig) : null

  // m03591: this dir has no markers of its own, but it may be a container
  // holding the real project one level down (e.g. D:\01dsh\plugin\find with
  // find\dsh-find). Adopt that immediate child instead of searching a bare
  // container name. Ancestor adoption stays removed (m03531).
  let child = null
  if (!pkgRaw && !gitConfig) child = findChildProject(projectPath)

  const childPkg = child?.pkg ?? null
  if (childPkg) {
    if (!description && typeof childPkg.description === 'string') description = childPkg.description
    if (!keywords.length && Array.isArray(childPkg.keywords)) keywords = childPkg.keywords.filter((k) => typeof k === 'string')
    if (!language && typeof childPkg.language === 'string') language = childPkg.language
    if (!deps.length && childPkg.dependencies && typeof childPkg.dependencies === 'object') deps = Object.keys(childPkg.dependencies)
  }
  const childRemote = child?.gitConfig ? remoteFromGitConfig(child.gitConfig) : null
  const effectiveRemote = remote ?? childRemote

  // name priority: own package.json > own git remote > child package.json >
  // child git remote > dir basename
  let nameSource = 'pkg'
  let intentName = name
  if (!intentName) {
    const remoteName = nameFromRemote(remote)
    if (remoteName) {
      intentName = remoteName
      nameSource = 'remote'
    }
  }
  if (!intentName && childPkg && typeof childPkg.name === 'string' && childPkg.name) {
    intentName = childPkg.name
    nameSource = 'child-pkg'
  }
  if (!intentName && childRemote) {
    const childRemoteName = nameFromRemote(childRemote)
    if (childRemoteName) {
      intentName = childRemoteName
      nameSource = 'child-remote'
    }
  }
  if (!intentName) {
    const dirName = nameFromDir(projectPath)
    if (dirName) {
      intentName = dirName
      nameSource = 'dir'
    } else {
      intentName = ''
      nameSource = 'none'
    }
  }

  return {
    name: intentName,
    nameSource,
    description,
    keywords,
    language,
    deps,
    remote: effectiveRemote,
    detectedPath: child?.dir ?? null,
  }
}

// m06420-1: keywords drive BOTH the GitHub queries (query.js) and the local
// relevance score (score.js), so tokenizing lives here and is exported — a
// keyword that the scorer cannot match (or vice versa) is a silent dead weight.
//
// Two behaviours the old ASCII-only split got wrong:
//   1. Chinese descriptions were dropped wholesale (`/[^a-z0-9]+/`), so a zh
//      README produced zero keywords and query.js fell back to name-only.
//   2. Keywords were unweighted and cut by appearance order, so a name word
//      could be displaced by filler from the description.
const CJK_RE = /[\u4e00-\u9fff]/

export function isCjkToken(word) {
  return CJK_RE.test(String(word ?? ''))
}

// Deliberately tiny morphological folding — plural only, because the scorer
// and the query builder must fold identically or a keyword matches on one side
// and not the other. 'repositories' -> 'repository' (real word) rather than
// 'repositorie' (matches nothing).
function foldToken(word) {
  if (word.length >= 6 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length >= 5 && word.endsWith('s') && !/(?:ss|us|is|os)$/.test(word)) return word.slice(0, -1)
  return word
}

// CJK has no spaces, so a run like '识别当前项目并搜索同类' is one token and
// matches nothing (neither GitHub nor the local scorer indexes whole runs).
// Cheap fix that works on both sides: split runs into overlapping bigrams, so
// '项目' becomes a term that a repo description can actually contain.
function cjkBigrams(run) {
  if (run.length <= 2) return [run]
  const out = []
  for (let i = 0; i + 2 <= run.length; i += 1) out.push(run.slice(i, i + 2))
  return out
}

// cjk modes:
//   'bigram' (default) — overlapping bigrams; used for scoring against repo
//              descriptions and for prose in general.
//   'run'    — keep the whole run; used for the project NAME, which is a short
//              proper noun and a better search term intact than sliced into
//              junk bigrams like 话工 out of 会话工具.
//   'none'   — drop CJK entirely; used when building AND queries from a prose
//              description, where a Chinese sentence can never match.
export function tokenize(text, { cjk = 'bigram' } = {}) {
  const raw = String(text ?? '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []
  const out = []
  for (const word of raw) {
    if (isCjkToken(word)) {
      if (cjk === 'none') continue
      if (STOP_WORDS.has(word)) continue
      if (cjk === 'run') {
        if (word.length >= 2) out.push(word)
        continue
      }
      out.push(...cjkBigrams(word))
      continue
    }
    // fold first, then drop stop words: 'tools' -> 'tool' must still be caught
    const folded = foldToken(word)
    if (STOP_WORDS.has(word) || STOP_WORDS.has(folded)) continue
    out.push(folded)
  }
  return out
}

// name > package.json keywords > description: the name is what the author
// chose deliberately, the description is usually boilerplate prose.
const SOURCE_WEIGHTS = Object.freeze({ name: 3, keywords: 2, description: 1 })
export const KEYWORD_LIMIT = 8

export function extractKeywords(intent) {
  const score = new Map()
  const add = (text, weight, opts) => {
    for (const word of tokenize(text, opts)) score.set(word, (score.get(word) ?? 0) + weight)
  }

  // The name is a short proper noun: keep a Chinese name intact ('会话工具')
  // instead of slicing it into bigrams ('话工'), which is a search term that
  // matches nothing.
  add(intent.name, SOURCE_WEIGHTS.name, { cjk: 'run' })
  add((intent.keywords ?? []).join(' '), SOURCE_WEIGHTS.keywords)
  add(intent.description, SOURCE_WEIGHTS.description)
  // intent.language is intentionally absent: it is already sent as the
  // `language:` qualifier, so repeating it here burns a keyword slot.

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, KEYWORD_LIMIT)
    .map(([word]) => word)
}
