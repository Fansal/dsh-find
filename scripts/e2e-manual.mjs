// 真实联网 E2E（手动跑，不属于 `npm test` 的单元测试集）
//   node scripts/e2e-manual.mjs [项目目录]
// 默认跑当前工作目录；会真实调用 GitHub search API，需要网络。
import { analyzeProject } from '../analyze.js'
import { loadConfig } from '../config.js'

const target = process.argv[2] || process.cwd()

// loadConfig is async — forgetting await silently fed a Promise into
// analyzeProject (token/llm all undefined → anonymous+default run).
const config = await loadConfig({ homeDir: process.env.USERPROFILE || process.env.HOME })

// Never print the raw config: it carries the GitHub token.
const redacted = {
  ...config,
  token: config.token ? `***(${config.token.length} chars)` : null,
  llm: { ...config.llm, apiKey: config.llm?.apiKey ? '***' : null },
}
console.log('target:', target)
console.log('config:', JSON.stringify(redacted))

const out = await analyzeProject(target, { config })
console.log('source:', out.source)
console.log('count:', out.repos.length)
for (const r of out.repos) {
  console.log(`- ${r.full_name} ⭐${r.stargazers_count} [${r.language ?? '-'}] ${(r.description ?? '').slice(0, 60)}`)
}
if (out.repos.length < 1) {
  console.error('E2E FAIL: expected >= 1 repo')
  process.exit(1)
}
console.log('E2E OK')
