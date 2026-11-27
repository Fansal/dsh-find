import { test } from 'node:test'
import assert from 'node:assert/strict'
import { llmRefineQueries, llmRerank, sessionModelSummaries, sessionModelQueries, sessionModelCompare, buildComparePrompt } from '../llm.js'

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

// ---- sessionModelQueries: mode 'dsh' also refines the search queries ----

const qIntent = { name: 'sessionkit', description: '会话管理插件', keywords: ['session', 'rewind'], language: 'javascript', deps: ['undici'] }

test('sessionModelQueries parses 1-3 query lines and strips markers', async () => {
  const chunks = [
    { type: 'text-delta', index: 0, text: '- session manager plugin\n' },
    { type: 'text-delta', index: 0, text: '2. "conversation rewind"\n' },
    { type: 'text-delta', index: 0, text: 'session toolchain\n' },
    { type: 'text-delta', index: 0, text: 'fourth line ignored\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const qs = await sessionModelQueries(qIntent, { llm: fakeLlm({ chunks }), selection })
  assert.deepEqual(qs, ['session manager plugin', 'conversation rewind', 'session toolchain'])
})

test('sessionModelQueries dedupes and drops overlong lines', async () => {
  const long = 'x'.repeat(200)
  const chunks = [
    { type: 'text-delta', index: 0, text: `session manager\nsession manager\n${long}\n` },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const qs = await sessionModelQueries(qIntent, { llm: fakeLlm({ chunks }), selection })
  assert.deepEqual(qs, ['session manager'])
})

test('sessionModelQueries returns null without llm/selection or usable output', async () => {
  assert.equal(await sessionModelQueries(qIntent, { llm: null, selection }), null)
  assert.equal(await sessionModelQueries(qIntent, { llm: fakeLlm({ chunks: [] }), selection: null }), null)
  assert.equal(await sessionModelQueries(null, { llm: fakeLlm({ chunks: [] }), selection }), null)
  const blank = [{ type: 'text-delta', index: 0, text: '  \n\n ' }, { type: 'finish', reason: { kind: 'stop' } }]
  assert.equal(await sessionModelQueries(qIntent, { llm: fakeLlm({ chunks: blank }), selection }), null)
})

test('sessionModelQueries returns null when the stream fails or does not stop', async () => {
  const throwLlm = { prepareCall: async () => { throw new Error('boom') } }
  assert.equal(await sessionModelQueries(qIntent, { llm: throwLlm, selection }), null)
  const errChunks = [{ type: 'text-delta', index: 0, text: 'session manager' }, { type: 'finish', reason: { kind: 'error' } }]
  assert.equal(await sessionModelQueries(qIntent, { llm: fakeLlm({ chunks: errChunks }), selection }), null)
})

// ---- sessionModelCompare: mode 'dsh' compare advice report (m05495) ----

const cmpRepos = [
  { full_name: 'a/big', html_url: '', description: 'markdown parser', stargazers_count: 500, language: 'js', topics: ['md'], updated_at: '' },
  { full_name: 'g/ok', html_url: '', description: 'md toolkit', stargazers_count: 200, language: 'ts', topics: [], updated_at: '' },
]
const cmpMaterials = [
  { readme: 'R'.repeat(5000), issues: [{ title: 'i1', comments: 7 }, { title: 'i2', comments: 3 }] },
  { readme: null, issues: null },
]

test('buildComparePrompt carries four sections, intent, excerpted readme and issues', () => {
  const prompt = buildComparePrompt(qIntent, cmpRepos, cmpMaterials)
  assert.ok(prompt.includes('## 功能差距'), 'must include feature-gap section')
  assert.ok(prompt.includes('## 踩坑预警'), 'must include pitfalls section')
  assert.ok(prompt.includes('## 架构借鉴'), 'must include architecture section')
  assert.ok(prompt.includes('## 优先级建议'), 'must include priority section')
  assert.ok(prompt.includes('name: sessionkit'))
  assert.ok(prompt.includes('"full_name":"a/big"'))
  // 5000-char readme must be excerpted to 3000 chars + ellipsis
  assert.ok(prompt.includes('R'.repeat(3000) + '…'))
  assert.ok(!prompt.includes('R'.repeat(3001)))
  // issues are carried as title+comments; repo 2 tolerates null materials
  assert.ok(prompt.includes('"title":"i1","comments":7'))
  assert.ok(prompt.includes('"full_name":"g/ok"'))
  assert.ok(!prompt.includes('"topIssues":[null]'))
})

test('sessionModelCompare returns the model report text', async () => {
  const chunks = [
    { type: 'text-delta', index: 0, text: '## 功能差距\n- a/big 有 X' },
    { type: 'text-delta', index: 0, text: '\n## 优先级建议\n- 先做 Y' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  const out = await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: fakeLlm({ chunks }), selection })
  assert.equal(out, '## 功能差距\n- a/big 有 X\n## 优先级建议\n- 先做 Y')
})

test('sessionModelCompare returns null without llm/selection/repos or on failure', async () => {
  assert.equal(await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: null, selection }), null)
  assert.equal(await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: fakeLlm({ chunks: [] }), selection: null }), null)
  assert.equal(await sessionModelCompare(qIntent, [], cmpMaterials, { llm: fakeLlm({ chunks: [] }), selection }), null)
  assert.equal(await sessionModelCompare(null, cmpRepos, cmpMaterials, { llm: fakeLlm({ chunks: [] }), selection }), null)
  const throwLlm = { prepareCall: async () => { throw new Error('boom') } }
  assert.equal(await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: throwLlm, selection }), null)
  const errChunks = [{ type: 'text-delta', index: 0, text: 'partial' }, { type: 'finish', reason: { kind: 'error' } }]
  assert.equal(await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: fakeLlm({ chunks: errChunks }), selection }), null)
  const emptyChunks = [{ type: 'finish', reason: { kind: 'stop' } }]
  assert.equal(await sessionModelCompare(qIntent, cmpRepos, cmpMaterials, { llm: fakeLlm({ chunks: emptyChunks }), selection }), null)
})
