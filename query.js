import { extractKeywords, isCjkToken, tokenize } from './intent.js'

function cleanDep(dep) {
  return dep.replace(/^@/, '').replace(/[^a-z0-9]/gi, ' ')
}

// GitHub search 语法里 " 是 phrase 分隔符、| : # @ 有操作符含义；
// 描述/README 摘要原样带进去会 422 Validation Failed，统一洗掉。
export function sanitizeText(text) {
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

// GitHub 的搜索是 AND 语义：一条 query 里塞 8 个词等于要求全部同时出现，
// 几乎必然 0 命中。所以关键词按 3 个一组切开，分成几条精度递减的 query。
const KEYWORDS_PER_QUERY = 3
// 上限 5 条 = 一次分析最多 5 次 search 调用（匿名搜索限流 10 次/分钟、
// 带 token 30 次/分钟）；再加上 analyze 的结果缓存，正常使用不会顶到限流。
export const MAX_QUERIES = 5

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// 关键词来源，按可信度排序（name×3 > keywords×2 > 描述×1，权重在
// extractKeywords 里算）。中文只认 name/keywords 里的整词——描述里的中文切成
// bigram 会产出「别当」「前项」这种 GitHub 上不存在的词，全 AND 拼进 query 只
// 会 0 命中，所以描述贡献的中文词一律丢掉。
function pickKeywords(intent) {
  const cjkAllowed = new Set([
    ...tokenize(intent.name, { cjk: 'run' }),
    ...(intent.keywords ?? []).flatMap((k) => tokenize(k, { cjk: 'run' })),
  ])
  return extractKeywords(intent).filter((word) => !isCjkToken(word) || cjkAllowed.has(word))
}

// 描述直接整段塞进 query 会带上 the/a/for/blazing 这类噪声词，而 GitHub 是
// AND 语义——每个噪声词都在缩小命中面。走 tokenize 只留实词，最多 4 个。
const DESC_WORDS = 4

export function buildSearchQueries(intent) {
  const queries = []
  // 同一条 query 发两遍只会白烧一次限流额度
  const push = (q) => {
    if (q && !queries.includes(q)) queries.push(q)
  }

  const langSuffix = intent.language ? ` language:${intent.language}` : ''
  const name = cleanName(intent.name)
  // 描述里的中文切 bigram 只会产出 GitHub 上不存在的词（别当/前项），所以
  // 这里只取英文实词——中文项目靠 name-only 和关键词组召回。
  const descWords = [...new Set(tokenize(String(intent.description ?? '').slice(0, 120), { cjk: 'none' }))]
    .slice(0, DESC_WORDS)
  const desc = sanitizeText(descWords.join(' '))

  // ① name+description：描述干净（多为英文）时精准
  if (name && desc) push(`${name} ${desc} in:name,description,readme${langSuffix}`)

  // ② name-only 工作马：长中文 README 描述全 AND 必然 0 结果，靠它兜底
  if (name) push(`${name} in:name,description,readme${langSuffix}`)

  const kws = pickKeywords(intent)
  const groups = chunk(kws, KEYWORDS_PER_QUERY)

  // ③ 关键词组：精度中等，仍带 language 限定
  for (const group of groups.slice(0, 2)) {
    if (group.length) push(`${group.join(' ')} in:description,topics${langSuffix}`)
  }

  // ④ 宽查询兜底（m06420-2）：只留最显著的两个词、去掉 language 限定——
  // 同类项目常写在别的语言里，前几条全 0 命中时这是最后的召回网。
  if (kws.length >= 2) push(`${kws.slice(0, 2).join(' ')} in:name,description,readme`)

  // ⑤ 依赖共现：信号弱，排在最后，超出上限时优先被丢掉
  if (intent.deps?.length) {
    const cleaned = intent.deps.slice(0, 2).map(cleanDep).filter(Boolean)
    if (cleaned.length) push(`${cleaned.join(' ')} in:readme`)
  }

  return queries.slice(0, MAX_QUERIES)
}
