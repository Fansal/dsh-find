// dsh-find client：composer-dock「找同类」按钮 + 结果面板 + 配置表单
// 纯 DOM（非 React 组件），照搬仓库根 client.js 的 MutationObserver 兜底重挂模式。
// 会话 cwd 取法与 app 端一致：ctx.sessions.list.getSnapshot().byId[?]?.cwd
// （参照 dsh-client-ui-conversation 的 sessions.list.getSnapshot().byId[sessionId]?.cwd）。
// m04619: i18n via ctx.locale（zh/en dicts + fallback），排序切换、结果数量设置、加载更多。

window.__ModuleLoader__.load({
  id: 'dsh-find',
  factory: (require) => {
    // resolveProjectPath 优先取 require 的 client-util.js；require 不可用时用等价内联兜底
    let resolvePath = null
    try {
      resolvePath = require('./client-util.js').resolveProjectPath
    } catch {
      resolvePath = null
    }
    if (typeof resolvePath !== 'function') {
      resolvePath = (sessionCtx) => {
        if (!sessionCtx || typeof sessionCtx !== 'object') return null
        const wp = sessionCtx.workspace?.path
        if (typeof wp === 'string' && wp) return wp
        const cwd = sessionCtx.session?.cwd
        if (typeof cwd === 'string' && cwd) return cwd
        return null
      }
    }

    // settings.section slot renderer is a React component (slots contract), so
    // the client needs React. Available via the ModuleLoader require (same as
    // sessionkit); without it the settings page entry is skipped.
    let React = null
    try {
      React = require('react')
    } catch {
      React = null
    }

    const module = { exports: {} }

    // ---- i18n (m04619) ----
    // Bound through ctx.locale when available; otherwise fall back to the zh
    // table (or en for non-zh navigator languages) with the same {param}
    // interpolation contract.
    const NS = 'dsh-find'
    const DICTS = {
      zh: {
        'panel.title': '找同类项目',
        'panel.close': '关闭',
        'panel.loading': '正在分析当前项目并搜索 GitHub…',
        'panel.requestFailed': '请求失败：{msg}',
        'panel.empty': '没有找到相似项目，换个目录或在「设置 → dsh-find 找同类」里补充 token 再试。',
        'panel.noPath': '无法确定当前项目（没有活跃会话或 cwd）',
        'panel.sort': '排序',
        'panel.loadMore': '加载更多（再 {n} 条）',
        'sort.relevance': '相关度',
        'sort.stars': '星数',
        'sort.updated': '最近更新',
        'source.llm': '搜索词由 LLM 提炼',
        'source.heuristic': '启发式搜索（未用 LLM 提炼查询词）',
        'warn.dir': '未识别到项目元数据（缺 package.json / README / git remote），已按目录名「{name}」搜索',
        'info.child': '当前目录没有项目文件，已按子目录「{name}」的项目识别',
        'meta.relevance': '相关度 {n}',
        'desc.none': '（暂无描述）',
        'desc.originalDown': ' 原文 ▾',
        'desc.originalUp': ' 原文 ▴',
        'desc.expandDown': ' 展开 ▾',
        'desc.expandUp': ' 收起 ▴',
        'desc.titleOriginal': '点击查看原文描述',
        'desc.titleExpand': '点击查看完整描述',
        'button.label': '🔍 找同类',
        'button.title': '识别当前项目并在 GitHub 上找同类项目',
        'error.rateLimit': 'GitHub API 限流，稍后再试；或在「设置 → dsh-find 找同类」里填写 token 提升额度',
        'error.auth': 'token 无效或已过期，请到「设置 → dsh-find 找同类」检查',
        'error.noMetadata': '没有可识别的项目元数据（缺 package.json / README / git remote）',
        'error.noProject': '目录不存在或不是有效项目',
        // m03271: corporate MITM re-signs HTTPS — node rejects the unknown root
        'error.tls': 'HTTPS 证书校验失败（本机网络有 HTTPS 拦截）。若信任该网络，到「设置 → dsh-find 找同类」把「跳过 HTTPS 证书校验」设为开启',
        'error.network': '网络错误，请检查网络或代理设置',
        'settings.title': '找同类项目',
        'settings.desc': '在输入框旁点「🔍 找同类」，按当前会话目录识别项目并在 GitHub 搜索相似仓库。下方配置全局生效。',
        'config.save': '保存',
        'config.saving': '保存中…',
        'config.saved': '已保存',
        'config.saveFailed': '保存失败：{msg}',
        'config.invalidNumber': '无效数值：{label}（需 ≥0 的数字）',
        'config.invalidCsv': '无效输入：{label}（需至少一个值）',
        'config.defaultUnset': '默认（不修改）',
        'config.on': '开启',
        'config.off': '关闭',
        'section.github.title': 'GitHub 访问',
        'section.github.desc': '搜索走 GitHub 官方 Search API：带 token 每分钟 30 次，匿名 10 次。',
        'field.token': 'GitHub Token',
        'field.token.hint': '可选，留空 = 匿名搜索',
        'field.proxy': '代理地址',
        'field.proxy.hint': '可选，如 http://127.0.0.1:7890',
        'field.tls': '跳过 HTTPS 证书校验',
        'field.tls.hint': '仅当提示「证书校验失败」且信任本机网络时开启',
        'section.llm.title': 'LLM 增强',
        'section.llm.desc': '用模型为搜索结果生成中文简介。dsh = 跟随当前会话模型（推荐）。',
        'field.mode': '模式',
        'option.defaultFollow': '默认（跟随会话模型）',
        'option.dsh': 'dsh（跟随会话模型）',
        'option.openai': 'openai（自填兼容端点）',
        'field.baseUrl': 'Base URL',
        'field.baseUrl.hint': '仅 openai 模式需要，如 https://api.openai.com/v1',
        'field.apiKey': 'API Key',
        'field.apiKey.hint': '仅 openai 模式需要',
        'field.model': '模型名',
        'field.model.hint': '仅 openai 模式需要，如 gpt-4o-mini',
        'section.results.title': '结果数量与排序',
        'section.results.desc': '面板单次展示的结果数与默认排序。加载更多按 10 条递增。',
        'field.limit': '结果数量',
        'field.limit.hint': '默认 10，最多 50',
        'field.sort': '默认排序',
        'field.sort.hint': '面板首次打开时使用的排序',
        'option.defaultRelevance': '默认（相关度）',
        'section.weights.title': '评分权重',
        'section.weights.desc': '相关度 = 各项加权之和。留空 = 使用默认值。',
        'field.weight.language': '语言匹配',
        'field.weight.language.hint': '默认 25',
        'field.weight.keywordPerHit': '每关键词命中',
        'field.weight.keywordPerHit.hint': '默认 5',
        'field.weight.keywordCap': '关键词得分上限',
        'field.weight.keywordCap.hint': '默认 45',
        'field.weight.stars': '星数',
        'field.weight.stars.hint': '默认 20',
        'field.weight.recent': '两年内更新',
        'field.weight.recent.hint': '默认 10',
        'section.filters.title': '结果过滤',
        'section.filters.desc': '搜索后先过滤再排序。留空 = 使用默认值。',
        'field.minStars': '最少星数',
        'field.minStars.hint': '默认 0（不过滤）',
        'field.excludeForks': '排除 fork',
        'field.excludeForks.hint': '默认关闭',
        'field.excludeArchived': '排除已归档',
        'field.excludeArchived.hint': '默认开启（滤掉「Moved to …」空壳仓库）',
        'field.languages': '语言白名单',
        'field.languages.hint': '逗号分隔，如 JavaScript, TypeScript；留空 = 不限',
      },
      en: {
        'panel.title': 'Similar projects',
        'panel.close': 'Close',
        'panel.loading': 'Analyzing this project and searching GitHub…',
        'panel.requestFailed': 'Request failed: {msg}',
        'panel.empty': 'No similar projects found. Try another directory, or add a token under Settings → dsh-find.',
        'panel.noPath': 'Cannot determine the current project (no active session or cwd)',
        'panel.sort': 'Sort',
        'panel.loadMore': 'Load more ({n} more)',
        'sort.relevance': 'Relevance',
        'sort.stars': 'Stars',
        'sort.updated': 'Recently updated',
        'source.llm': 'Query terms refined by the LLM',
        'source.heuristic': 'Heuristic search (query terms not LLM-refined)',
        'warn.dir': 'No project metadata found (missing package.json / README / git remote); searched by directory name "{name}"',
        'info.child': 'No project files in this directory; identified the project via subdirectory "{name}"',
        'meta.relevance': 'Relevance {n}',
        'desc.none': '(no description)',
        'desc.originalDown': ' Original ▾',
        'desc.originalUp': ' Original ▴',
        'desc.expandDown': ' Expand ▾',
        'desc.expandUp': ' Collapse ▴',
        'desc.titleOriginal': 'Click to see the original description',
        'desc.titleExpand': 'Click to see the full description',
        'button.label': '🔍 Find similar',
        'button.title': 'Identify this project and find similar repositories on GitHub',
        'error.rateLimit': 'GitHub API rate limit — try again later, or add a token under Settings → dsh-find to raise the quota',
        'error.auth': 'Token invalid or expired — check it under Settings → dsh-find',
        'error.noMetadata': 'No recognizable project metadata (missing package.json / README / git remote)',
        'error.noProject': 'Directory does not exist or is not a valid project',
        'error.tls': 'HTTPS certificate verification failed (HTTPS interception on this network). If you trust it, enable "Skip HTTPS certificate verification" under Settings → dsh-find',
        'error.network': 'Network error — check your network or proxy settings',
        'settings.title': 'Similar projects',
        'settings.desc': 'Click "🔍 Find similar" next to the composer to identify the current session directory and search GitHub for similar repositories. Settings below apply globally.',
        'config.save': 'Save',
        'config.saving': 'Saving…',
        'config.saved': 'Saved',
        'config.saveFailed': 'Save failed: {msg}',
        'config.invalidNumber': 'Invalid number for {label} (expected a number ≥ 0)',
        'config.invalidCsv': 'Invalid input for {label} (need at least one value)',
        'config.defaultUnset': 'Default (leave unchanged)',
        'config.on': 'On',
        'config.off': 'Off',
        'section.github.title': 'GitHub access',
        'section.github.desc': 'Searches use the official GitHub Search API: 30 req/min with a token, 10 anonymous.',
        'field.token': 'GitHub Token',
        'field.token.hint': 'Optional; leave empty for anonymous search',
        'field.proxy': 'Proxy URL',
        'field.proxy.hint': 'Optional, e.g. http://127.0.0.1:7890',
        'field.tls': 'Skip HTTPS certificate verification',
        'field.tls.hint': 'Only enable when prompted about certificate failures and you trust this network',
        'section.llm.title': 'LLM enhancement',
        'section.llm.desc': 'Uses a model to generate Chinese summaries for results. dsh = follow the current session model (recommended).',
        'field.mode': 'Mode',
        'option.defaultFollow': 'Default (follow session model)',
        'option.dsh': 'dsh (follow session model)',
        'option.openai': 'openai (custom OpenAI-compatible endpoint)',
        'field.baseUrl': 'Base URL',
        'field.baseUrl.hint': 'openai mode only, e.g. https://api.openai.com/v1',
        'field.apiKey': 'API Key',
        'field.apiKey.hint': 'openai mode only',
        'field.model': 'Model name',
        'field.model.hint': 'openai mode only, e.g. gpt-4o-mini',
        'section.results.title': 'Result count & order',
        'section.results.desc': 'How many results the panel shows per round, and the default order. "Load more" adds 10 at a time.',
        'field.limit': 'Result count',
        'field.limit.hint': 'Default 10, max 50',
        'field.sort': 'Default sort',
        'field.sort.hint': 'Order used when the panel first opens',
        'option.defaultRelevance': 'Default (relevance)',
        'section.weights.title': 'Scoring weights',
        'section.weights.desc': 'Relevance is the weighted sum. Leave empty for defaults.',
        'field.weight.language': 'Language match',
        'field.weight.language.hint': 'Default 25',
        'field.weight.keywordPerHit': 'Per-keyword hit',
        'field.weight.keywordPerHit.hint': 'Default 5',
        'field.weight.keywordCap': 'Keyword score cap',
        'field.weight.keywordCap.hint': 'Default 45',
        'field.weight.stars': 'Stars',
        'field.weight.stars.hint': 'Default 20',
        'field.weight.recent': 'Updated within 2 years',
        'field.weight.recent.hint': 'Default 10',
        'section.filters.title': 'Result filters',
        'section.filters.desc': 'Applied before ranking. Leave empty for defaults.',
        'field.minStars': 'Minimum stars',
        'field.minStars.hint': 'Default 0 (no filtering)',
        'field.excludeForks': 'Exclude forks',
        'field.excludeForks.hint': 'Off by default',
        'field.excludeArchived': 'Exclude archived',
        'field.excludeArchived.hint': 'On by default (filters out "Moved to …" stub repos)',
        'field.languages': 'Language whitelist',
        'field.languages.hint': 'Comma separated, e.g. JavaScript, TypeScript; empty = any',
      },
    }
    let _t = null
    function detectLang() {
      try {
        const lang = (navigator?.language || navigator?.languages?.[0] || 'zh').toLowerCase()
        return lang.startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'zh'
      }
    }
    function t(key, params) {
      if (_t) {
        const s = _t(key, params)
        if (s && s !== key) return s
      }
      const dict = DICTS[detectLang()] ?? DICTS.zh
      let s = dict[key] ?? DICTS.zh[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) s = s.split('{' + k + '}').join(String(v))
      }
      return s
    }

    function el(tag, attrs, ...children) {
      const node = document.createElement(tag)
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
          if (k === 'style' && typeof v === 'object') Object.assign(node.style, v)
          else if (k === 'onClick') node.addEventListener('click', v)
          else if (v !== undefined && v !== null) node.setAttribute(k, String(v))
        }
      }
      for (const child of children) {
        if (child === null || child === undefined) continue
        node.append(child)
      }
      return node
    }

    function closePanel() {
      document.querySelector('[data-dsh-find="panel"]')?.remove()
    }

    function panelShell() {
      return el(
        'div',
        {
          'data-dsh-find': 'panel',
          style: {
            position: 'fixed',
            top: '64px',
            right: '16px',
            width: '320px',
            maxHeight: '80vh',
            overflowY: 'auto',
            zIndex: '2147483000',
            background: 'var(--dsw-specific-menu, #fff)',
            color: 'var(--dsw-alias-label-primary, #222)',
            border: '1px solid var(--dsw-alias-border-l1, #ddd)',
            borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(0,0,0,.18)',
            fontFamily: 'inherit',
            fontSize: '13px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
          },
        },
        el(
          'div',
          { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          el('strong', { style: { fontSize: '13px' } }, t('panel.title')),
          el(
            'button',
            {
              'aria-label': t('panel.close'),
              onClick: closePanel,
              style: {
                border: '0',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 6px',
              },
            },
            '✕',
          ),
        ),
      )
    }

    function bodyText(container, text) {
      const div = el('div', { style: { padding: '8px 2px', lineHeight: '1.5' } }, text)
      container.append(div)
      return div
    }

    // 行2：简要总结（2 行截断）；有完整 description 且与总结不同时可点击展开/收起。
    // 点击只切换展开态，不触发跳转（与行1 的链接分开）。
    function descRow(repo) {
      const summary = repo.summary ?? repo.description ?? t('desc.none')
      const full = typeof repo.description === 'string' && repo.description ? repo.description : null
      const expandable = Boolean(full && full !== summary)
      let expanded = false
      const label = el('span', null, summary)
      // m02773: AI 简介是中文概括，展开看到的却是英文原文——摘要含中文
      // 而原文不含中文时，提示词用「原文」，避免用户以为展开是同语言的长文
      const isZh = (t) => /[\u4e00-\u9fff]/.test(t ?? '')
      const showsOriginal = () => isZh(summary) && !isZh(full)
      const collapseHint = () => (!expandable ? '' : showsOriginal() ? t('desc.originalDown') : t('desc.expandDown'))
      const expandHint = () => (!expandable ? '' : showsOriginal() ? t('desc.originalUp') : t('desc.expandUp'))
      const hint = el(
        'span',
        { style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '11px', marginLeft: '4px' } },
        collapseHint(),
      )
      const row = el(
        'div',
        {
          style: {
            color: 'var(--dsw-alias-label-secondary, #666)',
            fontSize: '12px',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: '2',
            WebkitBoxOrient: 'vertical',
            cursor: expandable ? 'pointer' : 'default',
          },
          title: expandable ? (showsOriginal() ? t('desc.titleOriginal') : t('desc.titleExpand')) : undefined,
          onClick: expandable
            ? () => {
                expanded = !expanded
                label.textContent = expanded ? full : summary
                hint.textContent = expanded ? expandHint() : collapseHint()
                if (expanded) {
                  row.style.display = 'block'
                  row.style.WebkitLineClamp = 'none'
                  row.style.overflow = 'visible'
                } else {
                  row.style.display = '-webkit-box'
                  row.style.WebkitLineClamp = '2'
                  row.style.overflow = 'hidden'
                }
              }
            : undefined,
        },
        label,
        hint,
      )
      return row
    }

    // m04619: error copy is translated (i18n); unknown codes fall back to the
    // server-provided message so a new backend error still surfaces text.
    const ERROR_KEYS = {
      'rate-limit': 'error.rateLimit',
      auth: 'error.auth',
      'no-metadata': 'error.noMetadata',
      'no-project': 'error.noProject',
      tls: 'error.tls',
      network: 'error.network',
    }
    function errorCopy(code, message) {
      const key = ERROR_KEYS[code]
      if (key) return t(key)
      return message ?? code
    }

    const SORT_OPTIONS = [
      ['relevance', 'sort.relevance'],
      ['stars', 'sort.stars'],
      ['updated', 'sort.updated'],
    ]
    // mirrors config.js LIMIT_MAX so「加载更多」stops before the server clamp
    const LOAD_MORE_STEP = 10
    const CLIENT_LIMIT_MAX = 50

    // One analyze round: fetch + render into the results container. The panel
    // owns { sort, limit } state so the sort switcher and「加载更多」can re-run
    // it without rebuilding the whole panel.
    function openPanel(ctx) {
      closePanel() // 重复点击：先移除旧面板再新开
      const panel = panelShell()
      document.body.append(panel)

      const path = resolvePath(currentSessionCtx(ctx))
      if (path === null) {
        bodyText(panel, t('panel.noPath'))
        return
      }

      const state = { sort: null, limit: null, requested: null, busy: false }
      const selectStyle = {
        border: '1px solid var(--dsw-alias-border-l2, #ddd)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-l1, transparent)',
        color: 'inherit',
        padding: '4px 8px',
        fontSize: '12px',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }
      const sortSel = el('select', { 'data-dsh-find': 'sort', title: t('panel.sort'), style: { ...selectStyle, flex: '1', minWidth: '0' } })
      for (const [value, key] of SORT_OPTIONS) sortSel.append(el('option', { value }, t(key)))
      sortSel.value = 'relevance'
      sortSel.addEventListener('change', () => {
        // per-call sort override (server re-sorts the ranked pool; cache is
        // keyed per sort). limit restarts so each sort shows its top results.
        state.sort = sortSel.value
        state.limit = null
        refresh()
      })
      const moreBtn = el(
        'button',
        {
          'data-dsh-find': 'more',
          onClick: () => {
            state.limit = Math.min(CLIENT_LIMIT_MAX, (state.requested ?? LOAD_MORE_STEP) + LOAD_MORE_STEP)
            refresh()
          },
          style: {
            border: '1px solid var(--dsw-alias-border-l2, #ddd)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary, #666)',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '4px 10px',
            whiteSpace: 'nowrap',
            display: 'none',
          },
        },
        t('panel.loadMore', { n: LOAD_MORE_STEP }),
      )
      const toolbar = el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, sortSel, moreBtn)
      const results = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } })
      panel.append(toolbar, results)

      async function refresh() {
        if (state.busy) return
        state.busy = true
        moreBtn.style.display = 'none'
        results.replaceChildren()
        const loading = el('div', { style: { padding: '8px 2px' } }, t('panel.loading'))
        results.append(loading)
        const body = { path }
        if (state.sort) body.sort = state.sort
        if (state.limit !== null) body.limit = state.limit
        let data
        try {
          const res = await fetch('/api/dsh-find/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          data = await res.json()
        } catch (err) {
          loading.remove()
          bodyText(results, t('panel.requestFailed', { msg: err?.message ?? String(err) }))
          state.busy = false
          return
        }
        loading.remove()
        state.busy = false
        if (data?.error) {
          bodyText(results, errorCopy(data.error.code, data.error.message))
          return
        }
        const repos = data?.repos ?? []
        if (repos.length === 0) {
          bodyText(results, t('panel.empty'))
          return
        }
        state.requested = typeof data?.limit === 'number' ? data.limit : state.limit
        renderResults(results, data, path)
        // more results exist when the server filled the requested count
        if (typeof state.requested === 'number' && repos.length >= state.requested && state.requested < CLIENT_LIMIT_MAX) {
          moreBtn.textContent = t('panel.loadMore', { n: Math.min(LOAD_MORE_STEP, CLIENT_LIMIT_MAX - state.requested) })
          moreBtn.style.display = ''
        }
      }

      refresh()
    }

    function renderResults(results, data, path) {
      const repos = data?.repos ?? []
      // review minor: surface the query-source (LLM-refined vs heuristic) so a
      // degraded LLM path is visible instead of silently looking identical
      const sourceHint = data?.source === 'llm' ? t('source.llm') : t('source.heuristic')
      results.append(el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', marginBottom: '4px' } }, sourceHint))
      // m02536: dir-name fallback — the folder had no package.json / README /
      // git-remote metadata, so the search ran on the directory basename; tell
      // the user the basis of the results so they can judge relevance.
      if (data?.nameSource === 'dir') {
        const dirName = String(path).split(/[\\/]/).filter(Boolean).pop() ?? ''
        results.append(el('div', {
          style: {
            fontSize: '11px',
            color: 'var(--dsw-warn-fg, #b96a00)',
            background: 'var(--dsw-warn-bg, #fff4e0)',
            border: '1px solid var(--dsw-warn-border, #f0d9a8)',
            borderRadius: '6px',
            padding: '4px 8px',
            marginBottom: '4px',
          },
        }, t('warn.dir', { name: dirName })))
      }
      // m03591: the dir had no markers but holds a project one level down — say
      // which child the search was based on so the result basis is visible.
      if ((data?.nameSource === 'child-pkg' || data?.nameSource === 'child-remote') && data?.detectedPath) {
        const childName = String(data.detectedPath).split(/[\\/]/).filter(Boolean).pop() ?? ''
        results.append(el('div', {
          style: {
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #555)',
            background: 'var(--dsw-alias-bg-l2, #f5f5f5)',
            border: '1px solid var(--dsw-alias-border-l2, #e5e5e5)',
            borderRadius: '6px',
            padding: '4px 8px',
            marginBottom: '4px',
          },
        }, t('info.child', { name: childName })))
      }
      const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } })
      for (const repo of repos) {
        // 卡片 = 外层 div：行1 是跳转链接（单独 a），行2 是可展开/收起的描述区（独立 div，不触发跳转）
        list.append(
          el(
            'div',
            {
              style: {
                border: '1px solid var(--dsw-alias-border-l2, #e5e5e5)',
                borderRadius: '8px',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              },
            },
            el(
              'a',
              {
                href: repo.html_url || '#',
                target: '_blank',
                rel: 'noopener noreferrer',
                style: { textDecoration: 'none', color: 'inherit', cursor: 'pointer' },
              },
              el(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
                el('strong', { style: { fontSize: '12.5px' } }, repo.full_name ?? ''),
                el(
                  'span',
                  { style: { color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: '11px' } },
                  // 相关度（m02613）直接跟在星数后面显示，不再放独立按钮
                  // 摘要来源（AI/原文）不再显示——「原文 ▾」提示已足以区分
                  `⭐ ${repo.stargazers_count ?? 0}${
                    typeof repo.relevance === 'number'
                      ? ` · ${t('meta.relevance', { n: Math.max(0, Math.min(100, Math.round(repo.relevance))) })}`
                      : ''
                  }${repo.language ? ` · ${repo.language}` : ''}`,
                ),
              ),
            ),
            descRow(repo),
          ),
        )
      }
      results.append(list)
    }

    // Settings-page config form (m03752). This is now the ONLY config UI: the
    // panel's ⚙ entry was removed. Field kinds: text | number | bool | select |
    // csv. Dotted keys nest into the POST body ({ llm: {...} } etc.).
    // m04619: labels/hints are i18n keys (t()); the「结果数量与排序」card was
    // added (limit + default sort).
    const CONFIG_SECTIONS = [
      {
        titleKey: 'section.github.title',
        descKey: 'section.github.desc',
        fields: [
          { key: 'token', labelKey: 'field.token', hintKey: 'field.token.hint' },
          { key: 'proxy', labelKey: 'field.proxy', hintKey: 'field.proxy.hint' },
          {
            key: 'tlsAllowUnauthorized',
            labelKey: 'field.tls',
            hintKey: 'field.tls.hint',
            kind: 'bool',
          },
        ],
      },
      {
        titleKey: 'section.llm.title',
        descKey: 'section.llm.desc',
        fields: [
          {
            key: 'llm.mode',
            labelKey: 'field.mode',
            kind: 'select',
            options: [
              ['', 'option.defaultFollow'],
              ['dsh', 'option.dsh'],
              ['openai', 'option.openai'],
            ],
          },
          { key: 'llm.baseUrl', labelKey: 'field.baseUrl', hintKey: 'field.baseUrl.hint' },
          { key: 'llm.apiKey', labelKey: 'field.apiKey', hintKey: 'field.apiKey.hint' },
          { key: 'llm.model', labelKey: 'field.model', hintKey: 'field.model.hint' },
        ],
      },
      {
        titleKey: 'section.results.title',
        descKey: 'section.results.desc',
        fields: [
          { key: 'limit', labelKey: 'field.limit', hintKey: 'field.limit.hint', kind: 'number' },
          {
            key: 'sort',
            labelKey: 'field.sort',
            hintKey: 'field.sort.hint',
            kind: 'select',
            options: [
              ['', 'option.defaultRelevance'],
              ['relevance', 'sort.relevance'],
              ['stars', 'sort.stars'],
              ['updated', 'sort.updated'],
            ],
          },
        ],
      },
      {
        titleKey: 'section.weights.title',
        descKey: 'section.weights.desc',
        fields: [
          { key: 'scoring.weights.language', labelKey: 'field.weight.language', hintKey: 'field.weight.language.hint', kind: 'number' },
          { key: 'scoring.weights.keywordPerHit', labelKey: 'field.weight.keywordPerHit', hintKey: 'field.weight.keywordPerHit.hint', kind: 'number' },
          { key: 'scoring.weights.keywordCap', labelKey: 'field.weight.keywordCap', hintKey: 'field.weight.keywordCap.hint', kind: 'number' },
          { key: 'scoring.weights.stars', labelKey: 'field.weight.stars', hintKey: 'field.weight.stars.hint', kind: 'number' },
          { key: 'scoring.weights.recent', labelKey: 'field.weight.recent', hintKey: 'field.weight.recent.hint', kind: 'number' },
        ],
      },
      {
        titleKey: 'section.filters.title',
        descKey: 'section.filters.desc',
        fields: [
          { key: 'filters.minStars', labelKey: 'field.minStars', hintKey: 'field.minStars.hint', kind: 'number' },
          { key: 'filters.excludeForks', labelKey: 'field.excludeForks', hintKey: 'field.excludeForks.hint', kind: 'bool' },
          {
            key: 'filters.excludeArchived',
            labelKey: 'field.excludeArchived',
            hintKey: 'field.excludeArchived.hint',
            kind: 'bool',
          },
          {
            key: 'filters.languages',
            labelKey: 'field.languages',
            hintKey: 'field.languages.hint',
            kind: 'csv',
          },
        ],
      },
    ]

    // settings page (m03063): configForm accepts an initial config (from
    // GET /api/dsh-find/config) to prefill inputs.
    function configForm(initial = null) {
      // dotted keys nest into { llm: {...} } so the form actually writes
      // mode/baseUrl/apiKey/model (route only merges body.llm). Empty text =
      // explicitly clear the stored value; empty number/bool = leave unchanged.
      const setNested = (obj, dottedKey, value) => {
        const parts = dottedKey.split('.')
        let node = obj
        for (let i = 0; i < parts.length - 1; i += 1) {
          node[parts[i]] ??= {}
          node = node[parts[i]]
        }
        node[parts[parts.length - 1]] = value
      }
      const valOf = (dottedKey) => {
        const parts = dottedKey.split('.')
        let node = initial
        for (let i = 0; i < parts.length - 1; i += 1) {
          if (node == null || typeof node !== 'object') return undefined
          node = node[parts[i]]
        }
        return node == null ? undefined : node[parts[parts.length - 1]]
      }

      const inputStyle = {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid var(--dsw-alias-border-l2, #ddd)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-l1, transparent)',
        color: 'inherit',
        padding: '5px 8px',
        fontSize: '12px',
        fontFamily: 'inherit',
      }

      const inputs = {}
      const box = el('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          maxWidth: '680px',
        },
      })

      for (const section of CONFIG_SECTIONS) {
        const card = el('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            border: '1px solid var(--dsw-alias-border-l1, #eee)',
            borderRadius: '8px',
            padding: '12px 14px',
          },
        })
        card.append(
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            el('strong', { style: { fontSize: '13px', fontWeight: '600' } }, t(section.titleKey)),
            el('span', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, t(section.descKey)),
          ),
        )
        for (const field of section.fields) {
          const kind = field.kind ?? 'text'
          const row = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } })
          const labelId = `dsh-find-${field.key.replace(/\./g, '-')}`
          const label = el('label', {
            for: labelId,
            style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #555)' },
          }, t(field.labelKey))
          let control
          if (kind === 'select') {
            control = el('select', {
              id: labelId,
              'data-dsh-find': `config-${field.key.replace(/\./g, '-')}`,
              style: { ...inputStyle, cursor: 'pointer' },
            })
            for (const [value, labelKey] of field.options) {
              const opt = el('option', { value }, t(labelKey))
              control.append(opt)
            }
          } else if (kind === 'bool') {
            control = el('select', {
              id: labelId,
              'data-dsh-find': `config-${field.key.replace(/\./g, '-')}`,
              style: { ...inputStyle, cursor: 'pointer' },
            })
            for (const [value, labelKey] of [['', 'config.defaultUnset'], ['true', 'config.on'], ['false', 'config.off']]) {
              control.append(el('option', { value }, t(labelKey)))
            }
          } else {
            control = el('input', {
              id: labelId,
              'data-dsh-find': `config-${field.key.replace(/\./g, '-')}`,
              inputmode: kind === 'number' ? 'numeric' : undefined,
              style: kind === 'number' ? { ...inputStyle, maxWidth: '140px' } : inputStyle,
            })
          }
          inputs[field.key] = control
          row.append(label, control)
          if (field.hintKey) {
            row.append(
              el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, t(field.hintKey)),
            )
          }
          card.append(row)
        }
        box.append(card)
      }

      // prefill from GET /api/dsh-find/config; null/'' stays empty so saves keep
      // the "empty text = clear" semantics.
      if (initial && typeof initial === 'object') {
        for (const section of CONFIG_SECTIONS) {
          for (const field of section.fields) {
            const v = valOf(field.key)
            const control = inputs[field.key]
            if (v === undefined || v === null || v === '') continue
            if (field.kind === 'bool' || field.kind === 'select') {
              const s = String(v)
              if ([...control.options].some((o) => o.value === s)) control.value = s
            } else if (field.kind === 'csv') {
              if (Array.isArray(v)) control.value = v.join(', ')
            } else if (typeof v === 'string') {
              control.value = v
            } else if (typeof v === 'number' && Number.isFinite(v)) {
              control.value = String(v)
            }
          }
        }
      }

      const status = el('span', {
        style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' },
      })
      const saveBtn = el(
        'button',
        {
          onClick: async () => {
            const body = {}
            for (const section of CONFIG_SECTIONS) {
              for (const field of section.fields) {
                const raw = inputs[field.key].value
                const v = typeof raw === 'string' ? raw.trim() : raw
                const kind = field.kind ?? 'text'
                if (kind === 'bool') {
                  // empty = leave unchanged (do not send the key)
                  if (v) setNested(body, field.key, v === 'true')
                  continue
                }
                if (kind === 'select') {
                  if (v) setNested(body, field.key, v)
                  continue
                }
                if (kind === 'number') {
                  if (!v) continue
                  const n = Number(v)
                  if (!Number.isFinite(n) || n < 0) {
                    status.textContent = t('config.invalidNumber', { label: t(field.labelKey) })
                    return
                  }
                  setNested(body, field.key, n)
                  continue
                }
                if (kind === 'csv') {
                  if (!v) continue
                  const list = v.split(',').map((x) => x.trim()).filter(Boolean)
                  if (!list.length) {
                    status.textContent = t('config.invalidCsv', { label: t(field.labelKey) })
                    return
                  }
                  setNested(body, field.key, list)
                  continue
                }
                // text: empty string explicitly unsets the stored value
                setNested(body, field.key, v)
              }
            }
            status.textContent = t('config.saving')
            try {
              const res = await fetch('/api/dsh-find/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              const data = await res.json()
              status.textContent = data?.ok ? t('config.saved') : t('config.saveFailed', { msg: res.status })
              if (data?.ok) setTimeout(() => (status.textContent = ''), 1500)
            } catch (err) {
              status.textContent = t('config.saveFailed', { msg: err?.message ?? err })
            }
          },
          style: {
            border: '0',
            borderRadius: '6px',
            background: 'var(--dsw-alias-brand-primary, #1f6feb)',
            color: '#fff',
            cursor: 'pointer',
            padding: '5px 16px',
            fontSize: '12px',
            fontWeight: '500',
          },
        },
        t('config.save'),
      )
      box.append(
        el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, saveBtn, status),
      )
      return box
    }

    function currentSessionCtx(ctx) {
      try {
        const snap = ctx?.sessions?.list?.getSnapshot?.()
        const byId = snap?.byId
        if (!byId || typeof byId !== 'object') return {}
        const entries = Object.values(byId)
        const entry =
          entries.find((s) => (s?.retainedBy?.mainView ?? 0) > 0) ?? entries[0]
        return entry ? { session: entry } : {}
      } catch {
        return {}
      }
    }

    function mountButton(ctx) {
      const docks = document.querySelectorAll('[data-composer-dock]')
      for (const dock of docks) {
        if (dock.querySelector('[data-dsh-find="button"]')) continue
        const btn = el(
          'button',
          {
            'data-dsh-find': 'button',
            title: t('button.title'),
            onClick: () => openPanel(ctx),
            style: {
              border: '1px solid var(--dsw-alias-border-l2, #ddd)',
              borderRadius: '6px',
              background: 'transparent',
              color: 'var(--dsw-alias-label-secondary, #666)',
              cursor: 'pointer',
              fontSize: '12px',
              padding: '2px 8px',
              marginLeft: '6px',
              flex: 'none',
            },
          },
          t('button.label'),
        )
        dock.append(btn)
      }
    }

    // settings page (m03063): register a settings.section entry that renders the
    // config form, prefilled from GET /api/dsh-find/config. The slot renderer is
    // a React component; our DOM form is mounted into its container via a ref
    // callback (no hooks needed). This is the only config entry (m03752).
    function registerSettingsSection(ctx) {
      if (!React || typeof ctx?.slots?.inject !== 'function' || typeof ctx?.slots?.register !== 'function') return
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-find',
            order: 100,
            label: 'dsh-find 找同类',
          },
          () =>
            React.createElement('div', {
              ref: async (node) => {
                if (!node) return
                // React can re-run the ref on the same node; mount the form once.
                if (node.getAttribute('data-dsh-find') === 'settings-root') return
                node.setAttribute('data-dsh-find', 'settings-root')
                node.style.padding = '4px 2px 24px'
                let config = null
                try {
                  const res = await fetch('/api/dsh-find/config')
                  if (res.ok) {
                    const data = await res.json()
                    if (data && typeof data === 'object' && data.config) config = data.config
                  }
                } catch {
                  config = null
                }
                const head = el('div', {
                  style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' },
                })
                head.append(
                  el('strong', { style: { fontSize: '15px', fontWeight: '600' } }, t('settings.title')),
                  el(
                    'span',
                    { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
                    t('settings.desc'),
                  ),
                )
                node.append(head, configForm(config))
              },
            }),
        ),
      )
    }

    module.exports = {
      name: 'dsh-find',
      inject: ['sessions', 'slots', 'locale'],
      apply(ctx) {
        // m04619: bind the locale dictionaries; t() falls back to the zh/en
        // tables when ctx.locale is unavailable (e.g. old host builds).
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function' && typeof ctx.locale.bind === 'function') {
            ctx.locale.register(NS, DICTS)
            _t = ctx.locale.bind(NS)
          }
        } catch {
          _t = null
        }
        mountButton(ctx)
        registerSettingsSection(ctx)
        const observer = new MutationObserver(() => mountButton(ctx))
        observer.observe(document.body, { childList: true, subtree: true })
        ctx.on('dispose', () => {
          observer.disconnect()
          closePanel()
          document
            .querySelectorAll('[data-dsh-find="button"]')
            .forEach((b) => b.remove())
        })
      },
    }
    return module.exports
  },
})
