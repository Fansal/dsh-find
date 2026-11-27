import { test } from 'node:test'
import assert from 'node:assert/strict'
import { llmRefineQueries, llmRerank, sessionModelSummaries } from '../llm.js'

const cfg = { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat' }
const intent = { name: 'md parser', description: 'parse markdown', keywords: [], language: 'js', deps: [], remote: null }

test('llmRefineQueries parses line list', async () => {
  let capturedInit = null
  const fetchImpl = async (url, init) => {
    capturedInit = init
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'markdown parser\nmd parser node' } }] }) }
  }
  const qs = await llmRefineQueries(intent, cfg, fetchImpl)
  assert.deepEqual(qs, ['markdown parser', 'md parser node'])
  // review major: openai path must carry an abort timeout signal so a hanging
  // model endpoint can never block the pipeline (session path already has one)
  assert.ok(capturedInit && capturedInit.signal instanceof AbortSignal, 'chatOnce init must include AbortSignal timeout')
})

test('llmRefineQueries returns null on failure (network)', async () => {
  const fetchImpl = async () => { throw new TypeError('boom') }
  assert.equal(await llmRefineQueries(intent, cfg, fetchImpl), null)
})

test('llmRefineQueries returns null on non-2xx', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({}) })
  assert.equal(await llmRefineQueries(intent, cfg, fetchImpl), null)
})

test('llmRerank maps ordered full_names or returns null', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'a/y\nb/x' } }] }) })
  const repos = [{ full_name: 'b/x', html_url: '', description: '', stargazers_count: 1, language: 'js', topics: [], updated_at: '' }, { full_name: 'a/y', html_url: '', description: '', stargazers_count: 1, language: 'js', topics: [], updated_at: '' }]
  const out = await llmRerank(intent, repos, cfg, fetchImpl)
  assert.equal(out[0].full_name, 'a/y')
})

// ---- sessionModelSummaries: host-session-model Chinese summaries ----

function fakeLlm({ chunks, prepareImpl } = {}) {
  return {
    prepareCall: prepareImpl ?? (async () => ({ config: {}, stream: async function* () {
      for (const c of chunks) yield c
    } })),
  }
}

const selection = { provider: 'deepseek', model: 'deepseek-v4-flash' }
const zhRepos = [
  { full_name: 'a/b', html_url: '', description: 'desc A', stargazers_count: 1, language: 'js', topics: ['md'], updated_at: '' },
  { full_name: 'c/d', html_url: '', description: 'desc B', stargazers_count: 2, language: 'ts', topics: [], updated_at: '' },
]

test('sessionModelSummaries assembles chunks into zh map', async () => {
  const chunks = [
    { type: 'text-delta', index: 0, text: '{"a/b": "解析 Markdown 的库",' },
    { type: 'text-delta', index: 0, text: ' "c/d": "TypeScript 工具集"}' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const map = await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks }), selection })
  assert.ok(map)
  assert.equal(map.get('a/b'), '解析 Markdown 的库')
  assert.equal(map.get('c/d'), 'TypeScript 工具集')
})

test('sessionModelSummaries returns null without llm or selection', async () => {
  assert.equal(await sessionModelSummaries(zhRepos, { llm: null, selection }), null)
  assert.equal(await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: [] }), selection: null }), null)
  assert.equal(await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: [] }), selection: {} }), null)
  assert.equal(await sessionModelSummaries([], { llm: fakeLlm({ chunks: [] }), selection }), null)
})

test('sessionModelSummaries returns null when stream fails or non-stop', async () => {
  const throwLlm = { prepareCall: async () => { throw new Error('boom') } }
  assert.equal(await sessionModelSummaries(zhRepos, { llm: throwLlm, selection }), null)
  const badChunks = [{ type: 'text-delta', index: 0, text: 'partial' }, { type: 'finish', reason: { kind: 'error' } }]
  assert.equal(await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: badChunks }), selection }), null)
  const emptyChunks = [{ type: 'finish', reason: { kind: 'stop' } }]
  assert.equal(await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: emptyChunks }), selection }), null)
})

test('sessionModelSummaries tolerates fenced/garbage output (falls back null)', async () => {
  const fenced = [
    { type: 'text-delta', index: 0, text: '```json\n{"a/b": "解析 Markdown 的库"}\n```' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const map = await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: fenced }), selection })
  assert.ok(map)
  assert.equal(map.get('a/b'), '解析 Markdown 的库')
  const garbage = [
    { type: 'text-delta', index: 0, text: '抱歉，我无法' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  assert.equal(await sessionModelSummaries(zhRepos, { llm: fakeLlm({ chunks: garbage }), selection }), null)
})
