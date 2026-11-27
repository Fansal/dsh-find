import { extractKeywords } from './intent.js'

function cleanDep(dep) {
  return dep.replace(/^@/, '').replace(/[^a-z0-9]/gi, ' ')
}

// GitHub search 语法里 " 是 phrase 分隔符、| : # @ 有操作符含义；
// 描述/README 摘要原样带进去会 422 Validation Failed，统一洗掉。
function sanitizeText(text) {
  return String(text)
    .replace(/["|:#@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// scoped 包名（@dsh-local/sessionkit）取末段才有区分度，且 / 在 query 里会被当 repo 分隔符
function cleanName(name) {
  const seg = String(name ?? '').split('/').filter(Boolean).pop() ?? ''
  return sanitizeText(seg)
}

export function buildSearchQueries(intent) {
  const queries = []

  const langSuffix = intent.language ? ` language:${intent.language}` : ''
  const name = cleanName(intent.name)
  const desc = sanitizeText(intent.description?.slice(0, 90) ?? '')

  // ① name+description：描述干净（多为英文）时精准
  if (name && desc) {
    queries.push(`${name} ${desc} in:name,description,readme${langSuffix}`)
  }

  // ② name-only 工作马：长中文 README 描述全 AND 必然 0 结果，靠它兜底
  if (name) {
    queries.push(`${name} in:name,description,readme${langSuffix}`)
  }

  // package.json keywords 常为空；空则退到从 name/description/language 提炼的关键词
  const kws = intent.keywords?.length ? intent.keywords : extractKeywords(intent)
  if (kws?.length) {
    queries.push(`${kws.join(' ')} in:description,topics${langSuffix}`)
  }

  if (intent.deps?.length) {
    const cleaned = intent.deps.slice(0, 2).map(cleanDep).filter(Boolean)
    if (cleaned.length) {
      queries.push(`${cleaned.join(' ')} in:readme`)
    }
  }

  return queries
}
