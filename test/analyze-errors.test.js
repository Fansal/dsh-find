import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeProject, ProjectError } from '../analyze.js'
import { GithubError } from '../github.js'

const baseConfig = { token: null, proxy: null, llm: { mode: 'dsh', baseUrl: null, apiKey: null, model: null } }

test('analyzeProject throws ProjectError no-metadata', async () => {
  const deps = {
    readProjectIntent: async () => ({ name: '', description: '', keywords: [], language: null, deps: [], remote: null }),
    buildSearchQueries: () => [],
    searchRepositories: async () => [],
    rankRepos: (i, r) => r,
    llmRefineQueries: async () => null,
    llmRerank: async () => null,
  }
  await assert.rejects(() => analyzeProject('/p', { config: baseConfig, deps }), (e) => e instanceof ProjectError && e.code === 'no-metadata')
})

test('analyzeProject propagates GithubError(0) when EVERY query fails (network/proxy)', async () => {
  const deps = {
    readProjectIntent: async () => ({ name: 'x', description: 'desc', keywords: ['k'], language: null, deps: [], remote: null }),
    buildSearchQueries: () => ['q1', 'q2'],
    searchRepositories: async () => { throw new GithubError(0, 'network: ECONNREFUSED') },
    rankRepos: (i, r) => r,
    llmRefineQueries: async () => null,
    llmRerank: async () => null,
  }
  await assert.rejects(
    () => analyzeProject('/p', { config: baseConfig, deps }),
    (e) => e instanceof GithubError && e.status === 0 && e.message && /network/.test(e.message),
  )
})

test('analyzeProject keeps partial results when SOME queries fail (失敗不中斷 contract preserved)', async () => {
  let calls = 0
  const deps = {
    readProjectIntent: async () => ({ name: 'x', description: 'desc', keywords: ['k'], language: null, deps: [], remote: null }),
    buildSearchQueries: () => ['q1', 'q2'],
    searchRepositories: async () => {
      calls += 1
      if (calls === 1) throw new GithubError(0, 'network: timeout')
      return [{ full_name: 'a/ok', html_url: '', description: '', stargazers_count: 5, language: 'js', topics: [], updated_at: '2026-01-01T00:00:00Z' }]
    },
    rankRepos: (i, r) => r,
    llmRefineQueries: async () => null,
    llmRerank: async () => null,
  }
  const out = await analyzeProject('/p', { config: baseConfig, deps })
  assert.equal(out.repos.length, 1)
  assert.equal(out.repos[0].full_name, 'a/ok')
})
