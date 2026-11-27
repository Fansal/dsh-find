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
