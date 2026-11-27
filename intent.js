import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export const STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'to', 'of', 'with', 'in', 'on', 'app', 'tool', 'library', 'project', 'client', 'server'])

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

export function extractKeywords(intent) {
  const raw = [intent.name, intent.description, ...(intent.keywords ?? []), intent.language ?? ''].join(' ').toLowerCase()
  const words = raw.split(/[^a-z0-9]+/).filter((w) => w.length > 0 && !STOP_WORDS.has(w))
  return [...new Set(words)].slice(0, 12)
}
