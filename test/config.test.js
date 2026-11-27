import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIMIT_DEFAULT, LIMIT_MAX, loadConfig, saveConfig, sanitizeLimit } from '../config.js'

test('loadConfig missing file returns defaults', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.token, null)
  assert.equal(cfg.llm.mode, 'dsh')
})

test('saveConfig then loadConfig round-trips', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  await saveConfig({ token: 'ghp_x', proxy: null, llm: { mode: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-y', model: 'deepseek-chat' } }, { homeDir })
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.token, 'ghp_x')
  assert.equal(cfg.llm.baseUrl, 'https://api.deepseek.com')
})

test('loadConfig corrupt json returns defaults', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), '{ not json', 'utf-8')
  return loadConfig({ homeDir }).then((cfg) => assert.equal(cfg.token, null))
})

test('loadConfig reads scoring weights with defaults', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ scoring: { weights: { language: 40, stars: 5 } } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.scoring.weights.language, 40)
  assert.equal(cfg.scoring.weights.stars, 5)
  assert.equal(cfg.scoring.weights.recent, 10) // unspecified keeps default
})

test('loadConfig clamps invalid scoring weights', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ scoring: { weights: { language: 'x', keywordCap: -3, keywordPerHit: NaN } } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.scoring.weights.language, 25)
  assert.equal(cfg.scoring.weights.keywordCap, 45)
  assert.equal(cfg.scoring.weights.keywordPerHit, 5)
})

test('saveConfig then loadConfig round-trips scoring weights', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  await saveConfig({ scoring: { weights: { language: 40, stars: 5 } } }, { homeDir })
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.scoring.weights.language, 40)
  assert.equal(cfg.scoring.weights.stars, 5)
})

test('loadConfig reads filters with defaults', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ filters: { minStars: 50, excludeForks: true, languages: ['JavaScript', 'TypeScript'] } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.filters.minStars, 50)
  assert.equal(cfg.filters.excludeForks, true)
  assert.deepEqual(cfg.filters.languages, ['JavaScript', 'TypeScript'])
})

test('loadConfig clamps invalid filters', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ filters: { minStars: 'lots', excludeForks: 'yes', languages: 'javascript' } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.filters.minStars, 0)
  assert.equal(cfg.filters.excludeForks, false)
  assert.deepEqual(cfg.filters.languages, [])
})

test('loadConfig defaults excludeArchived to true (moved-to stubs are noise)', async () => {
  // absent config / absent filters key -> archived repos filtered by default
  const emptyHome = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const cfgEmpty = await loadConfig({ homeDir: emptyHome })
  assert.equal(cfgEmpty.filters.excludeArchived, true)

  // filters present but excludeArchived absent -> still default true
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ filters: { minStars: 5 } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.filters.excludeArchived, true)

  // explicit false is respected (opt-out)
  const homeDir2 = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir2 = join(homeDir2, '.dsh')
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'dsh-find.config.json'), JSON.stringify({ filters: { excludeArchived: false } }), 'utf-8')
  const cfg2 = await loadConfig({ homeDir: homeDir2 })
  assert.equal(cfg2.filters.excludeArchived, false)
})

test('sanitizeLimit clamps into [1, LIMIT_MAX] and defaults when unusable', () => {
  assert.equal(sanitizeLimit(20), 20)
  assert.equal(sanitizeLimit('30'), 30)
  assert.equal(sanitizeLimit(0), 1)
  assert.equal(sanitizeLimit(-5), 1)
  assert.equal(sanitizeLimit(999), LIMIT_MAX)
  assert.equal(sanitizeLimit(12.6), 13)
  assert.equal(sanitizeLimit(null), LIMIT_DEFAULT)
  assert.equal(sanitizeLimit(undefined), LIMIT_DEFAULT)
  assert.equal(sanitizeLimit(''), LIMIT_DEFAULT)
  assert.equal(sanitizeLimit('many'), LIMIT_DEFAULT)
  assert.equal(sanitizeLimit(NaN), LIMIT_DEFAULT)
})

test('loadConfig reads limit with default and clamp', async () => {
  const emptyHome = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const cfgEmpty = await loadConfig({ homeDir: emptyHome })
  assert.equal(cfgEmpty.limit, LIMIT_DEFAULT)

  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ limit: 25 }), 'utf-8')
  assert.equal((await loadConfig({ homeDir })).limit, 25)

  const homeDir2 = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir2 = join(homeDir2, '.dsh')
  mkdirSync(dir2, { recursive: true })
  writeFileSync(join(dir2, 'dsh-find.config.json'), JSON.stringify({ limit: 500 }), 'utf-8')
  assert.equal((await loadConfig({ homeDir: homeDir2 })).limit, LIMIT_MAX)
})

test('saveConfig then loadConfig round-trips limit', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  await saveConfig({ limit: 30 }, { homeDir })
  assert.equal((await loadConfig({ homeDir })).limit, 30)
})

test('loadConfig compare defaults to disabled with threshold defaults', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.compare.enabled, false)
  assert.equal(cfg.compare.minStars, 100)
  assert.equal(cfg.compare.minRelevance, 50)
  assert.equal(cfg.compare.maxCount, 3)
  assert.equal(cfg.compare.months, 24)
})

test('loadConfig reads compare and clamps thresholds', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  const dir = join(homeDir, '.dsh')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'dsh-find.config.json'), JSON.stringify({ compare: { enabled: true, minStars: '5', minRelevance: 999, maxCount: 0, months: 'many' } }), 'utf-8')
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.compare.enabled, true)
  assert.equal(cfg.compare.minStars, 5)
  assert.equal(cfg.compare.minRelevance, 100) // clamped
  assert.equal(cfg.compare.maxCount, 1) // clamped, not default 3
  assert.equal(cfg.compare.months, 24) // unusable -> default
})

test('saveConfig then loadConfig round-trips compare', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'dsh-find-'))
  await saveConfig({ compare: { enabled: true, minStars: 10, minRelevance: 30, maxCount: 2, months: 12 } }, { homeDir })
  const cfg = await loadConfig({ homeDir })
  assert.equal(cfg.compare.enabled, true)
  assert.equal(cfg.compare.minStars, 10)
  assert.equal(cfg.compare.minRelevance, 30)
  assert.equal(cfg.compare.maxCount, 2)
  assert.equal(cfg.compare.months, 12)
})
