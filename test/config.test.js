import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig } from '../config.js'

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
