async function chatOnce(messages, cfg, fetchImpl) {
  const url = `${cfg.baseUrl}/chat/completions`
  const init = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0 }),
    // review major: a hanging model endpoint must never block the pipeline —
    // callers wrap chatOnce in try/catch and silently fall back, so an abort
    // here is safe. (session-model path already has its own 45s timeout.)
    signal: AbortSignal.timeout(30_000),
  }
  const fetcher = fetchImpl ?? globalThis.fetch
  const res = await fetcher(url, init)
  if (!res.ok) return null
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  return content
}

export async function llmRefineQueries(intent, cfg, fetchImpl) {
  if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.model) return null
  try {
    const content = await chatOnce(
      [
        { role: 'system', content: '把项目意图提炼为 1-3 条英文 GitHub 搜索词，每行一条，只输出查询词' },
        { role: 'user', content: `项目意图：${intent.name || ''} ${intent.description || ''} ${(intent.keywords ?? []).join(' ')}`.trim() },
      ],
      cfg,
      fetchImpl,
    )
    if (content === null) return null
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
    return lines.slice(0, 3)
  } catch {
    return null
  }
}

export async function llmRerank(intent, repos, cfg, fetchImpl) {
  if (!cfg || !cfg.baseUrl || !cfg.apiKey || !cfg.model) return null
  try {
    const content = await chatOnce(
      [
        { role: 'system', content: '按与给定项目意图的相关性给仓库重排，返回 full_name 顺序，一行一个' },
        { role: 'user', content: `项目意图：${intent.name || ''} ${intent.description || ''}\n仓库：\n${repos.map((r) => r.full_name).join('\n')}` },
      ],
      cfg,
      fetchImpl,
    )
    if (content === null) return null
    const ordered = content.split('\n').map((l) => l.trim()).filter(Boolean)
    const byName = new Map(repos.map((r) => [r.full_name, r]))
    const result = ordered.map((name) => byName.get(name)).filter((r) => r !== undefined)
    if (result.length === 0) return null
    return result
  } catch {
    return null
  }
}

// ---- session-model Chinese summaries (host LlmRuntime, no dsh-llm import) ----

const SESSION_TIMEOUT_MS = 45000

/**
 * Shared session-model runner: prepareCall -> stream text-delta/finish chunks ->
 * stop validation. Returns the full content string or null on any failure.
 */
async function runSessionPrompt(prompt, { llm, selection, log = () => {}, maxTokens = 4096 }) {
  const timeoutSignal = typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(SESSION_TIMEOUT_MS)
    : undefined
  const prepared = await llm.prepareCall(
    { provider: selection.provider, model: selection.model, maxTokens, reasoningEffort: selection.reasoningEffort },
    timeoutSignal,
  )
  log('prepareCall ok, resolved config:', JSON.stringify(prepared?.config ?? null))
  const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  const options = { ...(prepared?.config ?? {}), messages, ...(timeoutSignal ? { signal: timeoutSignal } : {}) }
  let content = ''
  let terminal = null
  for await (const chunk of prepared.stream(options)) {
    if (chunk?.type === 'text-delta') content += chunk.text
    else if (chunk?.type === 'finish') terminal = chunk.reason
  }
  log('stream finished: terminal=%s contentLen=%d', JSON.stringify(terminal ?? null), content.length)
  if (!terminal || terminal.kind !== 'stop' || !content.trim()) return null
  return content
}

/**
 * Ask the DSH host LLM (the session's model) to write a one-line Chinese
 * summary per repository. Mirrors the calling pattern of dsh-experimental-
 * translator: ctx.get("llm") -> prepareCall({provider,model,maxTokens}, signal)
 * -> stream(options) text-delta/finish chunks -> stop validation -> JSON parse.
 *
 * We deliberately do NOT import @deepseek-ai/dsh-llm (dsh-find is a standalone
 * package): chunks are assembled here, and `llm`/`selection` are injected so
 * tests can drive a fake stream.
 *
 * Returns a Map<full_name, zhSummary> or null on any failure — callers fall
 * back to the heuristic summary.
 */
export async function sessionModelSummaries(repos, { llm, selection, log = () => {} }) {
  if (!llm || !selection || !selection.provider || !selection.model) return null
  if (!Array.isArray(repos) || repos.length === 0) return null
  try {
    const content = await runSessionPrompt(buildSummaryPrompt(repos), { llm, selection, log })
    if (!content) return null
    const map = parseZhMap(content, repos)
    log('parse result: %s', map ? `map size ${map.size}` : 'null')
    return map
  } catch (e) {
    log('error:', e?.stack ?? String(e))
    return null
  }
}

function buildSummaryPrompt(repos) {
  const list = repos.map((r) => ({
    full_name: r.full_name,
    language: r.language ?? '',
    description: r.description ?? '',
    topics: Array.isArray(r.topics) ? r.topics : [],
  }))
  return (
    '你是 GitHub 项目分析助手。下面是搜索到的仓库列表（JSON 数组）。\n' +
    '请用中文为每个仓库写一句 20-40 字的简介，概括它主要做什么。\n' +
    '只输出一个 JSON 对象：键为 full_name，值为中文简介字符串。\n' +
    '不要输出任何其他文字、解释或 markdown 代码块。\n' +
    '仓库列表：\n' + JSON.stringify(list)
  )
}

function parseZhMap(raw, repos) {
  let s = raw.trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenced) s = fenced[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj
  try {
    obj = JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const map = new Map()
  for (const r of repos) {
    const v = obj[r.full_name]
    if (typeof v === 'string' && v.trim()) map.set(r.full_name, v.trim())
  }
  return map.size > 0 ? map : null
}

// ---- session-model query refinement (m04619: mode 'dsh' also refines) ----

const MAX_QUERY_LEN = 120

/** Strip list markers / quotes an LLM likes to add around query lines. */
function stripQueryLine(line) {
  return String(line)
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Ask the DSH session model to turn the project intent into GitHub search
 * queries. Same transport as sessionModelSummaries (host LlmRuntime), so
 * mode:'dsh' can refine queries too — previously only the OpenAI-compatible
 * path (llmRefineQueries) did. Returns string[] (1-3 items) or null on any
 * failure; callers fall back to buildSearchQueries().
 */
export async function sessionModelQueries(intent, { llm, selection, log = () => {} }) {
  if (!llm || !selection || !selection.provider || !selection.model) return null
  if (!intent) return null
  try {
    const content = await runSessionPrompt(buildQueryPrompt(intent), { llm, selection, log, maxTokens: 512 })
    if (!content) return null
    const lines = content
      .split('\n')
      .map(stripQueryLine)
      .filter((l) => l && l.length <= MAX_QUERY_LEN)
    const out = []
    for (const l of lines) {
      if (!out.includes(l)) out.push(l)
      if (out.length === 3) break
    }
    log('queries: %s', JSON.stringify(out))
    return out.length ? out : null
  } catch (e) {
    log('query refine error:', e?.stack ?? String(e))
    return null
  }
}

function buildQueryPrompt(intent) {
  const kws = Array.isArray(intent.keywords) ? intent.keywords : []
  const deps = Array.isArray(intent.deps) ? intent.deps.slice(0, 8) : []
  return (
    '你在帮我用 GitHub 搜索找到与下面这个项目「做的事情相同或相近」的开源项目。\n' +
    '请输出 1-3 条 GitHub 代码搜索查询词，每行一条，只输出查询词本身。\n' +
    '要求：\n' +
    '- 用英文关键词，不要整句、不要中文；\n' +
    '- 每条 2-5 个词，避免过于宽泛的词（如 library、tool、app 单独使用）；\n' +
    '- 不要输出引号、编号、解释或 markdown 代码块。\n' +
    '项目信息：\n' +
    `name: ${intent.name ?? ''}\n` +
    `language: ${intent.language ?? ''}\n` +
    `description: ${intent.description ?? ''}\n` +
    `keywords: ${kws.join(', ')}\n` +
    `dependencies: ${deps.join(', ')}`
  )
}
