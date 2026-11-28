import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readProjectIntent, extractKeywords } from '../intent.js'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-project')

// Ruling (task3): git refuses to track any path containing a .git component
// (DotGitComponent protection; `git add` ignores, `git update-index --cacheinfo`
// errors "Invalid path"). The fixture's .git/config therefore cannot ship in the
// repo — the test materializes it at runtime (idempotent) before reading.
// Shape fidelity (review major): a real `git clone` config has the url line
// followed by fetch and a [branch] section — url is NEVER the last line, so
// the fixture must not end at url or the $ anchor hides regex bugs.
function ensureGitConfig() {
  const gitDir = join(FIXTURE, '.git')
  mkdirSync(gitDir, { recursive: true })
  writeFileSync(
    join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n'
      + '[remote "origin"]\n\turl = https://github.com/alice/my-awesome-parser.git\n'
      + '\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
      + '[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n',
    'utf-8',
  )
}

test('readProjectIntent reads package.json + readme + git remote', async () => {
  ensureGitConfig()
  const intent = await readProjectIntent(FIXTURE)
  assert.equal(intent.name, 'my-awesome-parser')
  assert.match(intent.description, /markdown parser/)
  assert.deepEqual(intent.keywords, ['markdown', 'parser', 'md'])
  assert.equal(intent.remote, 'https://github.com/alice/my-awesome-parser.git')
  assert.ok(intent.deps.length >= 0)
})

test('extractKeywords drops stop words', () => {
  const kw = extractKeywords({ name: 'fast parser', description: 'a markdown parser for node', keywords: [], language: 'js', deps: [], remote: null })
  assert.ok(kw.some((w) => w.includes('parser')))
  assert.ok(!kw.some((w) => ['the', 'a', 'for'].includes(w)))
})

// m06420-1: the old tokenizer was `split(/[^a-z0-9]+/)`, which silently threw
// away every Chinese description — a zh README produced zero keywords and the
// panel fell back to name-only queries.
test('extractKeywords keeps Chinese descriptions via bigrams', () => {
  const kw = extractKeywords({
    name: '会话工具',
    description: '识别当前项目并搜索同类开源项目',
    keywords: [],
    language: 'javascript',
    deps: [],
    remote: null,
  })
  assert.ok(kw.length > 0, 'a Chinese-only intent must still yield keywords')
  assert.ok(kw.includes('项目'), `expected the bigram 项目, got: ${JSON.stringify(kw)}`)
  // whole runs are not searchable terms
  assert.ok(!kw.some((w) => w.length > 4 && /[\u4e00-\u9fff]/.test(w)), JSON.stringify(kw))
})

test('extractKeywords weights the name above the description', () => {
  const kw = extractKeywords({
    name: 'markdown',
    description: 'a tool for parsing markdown files quickly',
    keywords: [],
    language: null,
    deps: [],
    remote: null,
  })
  assert.equal(kw[0], 'markdown', `name word must rank first, got: ${JSON.stringify(kw)}`)
  assert.equal(kw.filter((w) => w === 'markdown').length, 1, 'duplicates must collapse into one weighted term')
})

test('extractKeywords drops marketing filler and folds plurals', () => {
  const kw = extractKeywords({
    name: 'widgets',
    description: 'a simple fast plugin for awesome tools',
    keywords: [],
    language: null,
    deps: [],
    remote: null,
  })
  assert.ok(!kw.some((w) => ['simple', 'fast', 'plugin', 'awesome', 'tools', 'tool'].includes(w)), JSON.stringify(kw))
  assert.ok(kw.includes('widget'), `expected the folded form widget, got: ${JSON.stringify(kw)}`)
})

test('extractKeywords never spends a slot on the language', () => {
  const kw = extractKeywords({
    name: 'thing',
    description: 'thing thing thing',
    keywords: [],
    language: 'javascript',
    deps: [],
    remote: null,
  })
  assert.ok(!kw.includes('javascript'), `language is already a query qualifier: ${JSON.stringify(kw)}`)
})

test('readProjectIntent on dir without package.json/readme returns minimal intent', async () => {
  // isolated tmp dir OUTSIDE the dsh-find tree, so the bounded upward walk
  // (m03403) cannot adopt any ancestor's package.json
  const tmp = join(tmpdir(), 'dsh-find-intent-test-' + process.pid)
  mkdirSync(join(tmp, 'empty'), { recursive: true })
  try {
    const intent = await readProjectIntent(join(tmp, 'empty'))
    assert.ok(intent.name === '' || intent.description === '')
    assert.doesNotThrow(() => JSON.stringify(intent))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// m02536: other sessions spinned in arbitrary dirs (no package.json / README /
// .git) used to hard-fail with no-metadata — make the directory basename the
// last-resort name so ANY directory can be searched; nameSource tells the
// panel when this happened. pkg name & git remote keep priority.
// m03403: the upward walk (max 3 hops) must stay inside an isolated tmp tree —
// fixtures/ sits inside the dsh-find repo, so a real walk would adopt the
// plugin's own package.json.
test('readProjectIntent falls back to directory basename as last resort', async () => {
  const tmp = join(tmpdir(), 'dsh-find-intent-test-' + process.pid)
  const empty = join(tmp, 'empty-sub')
  mkdirSync(empty, { recursive: true })
  try {
    const intent = await readProjectIntent(empty)
    assert.equal(intent.name, 'empty-sub')
    assert.equal(intent.nameSource, 'dir')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('readProjectIntent marks pkg name as source (priority over dir)', async () => {
  ensureGitConfig()
  const intent = await readProjectIntent(FIXTURE)
  assert.equal(intent.name, 'my-awesome-parser')
  assert.equal(intent.nameSource, 'pkg')
})

// m03531: ancestor-project adoption was REMOVED by user request. A session dir
// with no markers of its own must be searched by its own basename — never by
// an enclosing project's identity. This test pins that a sub-dir of a real
// project does NOT inherit the parent's package.json.
test('readProjectIntent does not adopt an enclosing project (m03531)', async () => {
  const sub = join(FIXTURE, 'packages', 'sub-lib')
  mkdirSync(sub, { recursive: true })
  const intent = await readProjectIntent(sub)
  assert.equal(intent.name, 'sub-lib')
  assert.equal(intent.nameSource, 'dir')
  assert.equal(intent.description, '')
})

// m03591: the opposite direction — a container dir that holds the real project
// one level DOWN (e.g. D:\\01dsh\\plugin\\find holding find\\dsh-find) should be
// recognised from that child. Only immediate children; hidden / dependency
// dirs are skipped; a child that is a git repo wins over a plain package.json.
function writeChildPkg(root, childName, pkg, opts = {}) {
  const dir = join(root, childName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8')
  if (opts.git) {
    mkdirSync(join(dir, '.git'), { recursive: true })
    writeFileSync(
      join(dir, '.git', 'config'),
      `[remote "origin"]\n\turl = https://github.com/bob/${opts.git}.git\n`
        + '\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      'utf-8',
    )
  }
  return dir
}

test('readProjectIntent adopts a child project when the dir has no markers', async () => {
  const tmp = join(tmpdir(), 'dsh-find-child-' + process.pid)
  const root = join(tmp, 'container')
  mkdirSync(root, { recursive: true })
  const child = writeChildPkg(root, 'kid-lib', {
    name: 'kid-lib',
    description: 'a small kid library for node',
    keywords: ['kid', 'lib'],
  })
  try {
    const intent = await readProjectIntent(root)
    assert.equal(intent.name, 'kid-lib')
    assert.equal(intent.nameSource, 'child-pkg')
    assert.match(intent.description, /kid library/)
    assert.equal(intent.detectedPath, child)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('readProjectIntent prefers the child that is a git repo', async () => {
  const tmp = join(tmpdir(), 'dsh-find-child-' + process.pid)
  const root = join(tmp, 'container')
  mkdirSync(root, { recursive: true })
  writeChildPkg(root, 'a-plain', { name: 'a-plain', description: 'plain package' })
  const repo = writeChildPkg(root, 'b-repo', { name: 'b-repo', description: 'real repo' }, { git: 'b-repo' })
  try {
    const intent = await readProjectIntent(root)
    assert.equal(intent.name, 'b-repo')
    assert.equal(intent.nameSource, 'child-pkg')
    assert.equal(intent.detectedPath, repo)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('readProjectIntent skips hidden and dependency child dirs', async () => {
  const tmp = join(tmpdir(), 'dsh-find-child-' + process.pid)
  const root = join(tmp, 'container')
  mkdirSync(root, { recursive: true })
  writeChildPkg(root, '.hidden-proj', { name: 'hidden-proj' })
  writeChildPkg(join(root, 'node_modules'), 'dep', { name: 'dep-lib' })
  try {
    const intent = await readProjectIntent(root)
    assert.equal(intent.name, 'container')
    assert.equal(intent.nameSource, 'dir')
    assert.equal(intent.detectedPath, null)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
