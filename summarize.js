// dsh-find summarize：为每个搜索命中的仓库生成一句「简要功能总结」。
// 启发式（零依赖）：优先 description（截断），其次 topics 主题词，再次 language，
// 全空给占位文案。纯函数，便于单测；未来若接入 LLM 增强，在调用方替换即
// 可（本模块保持同步纯函数签名）。

const MAX_LEN = 96

export function summarizeRepo(repo = {}) {
  const desc = typeof repo.description === 'string' ? repo.description.trim() : ''
  if (desc) return desc.length > MAX_LEN ? desc.slice(0, MAX_LEN - 1) + '…' : desc

  const topics = Array.isArray(repo.topics) ? repo.topics.filter((t) => typeof t === 'string' && t) : []
  if (topics.length) return `主题：${topics.slice(0, 4).join('、')}`

  const lang = typeof repo.language === 'string' && repo.language ? repo.language : null
  if (lang) return `一个 ${lang} 开源项目`

  return '（暂无描述）'
}
