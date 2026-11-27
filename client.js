// dsh-find client：composer-dock「找同类」按钮 + 结果面板 + 配置表单
// 纯 DOM（非 React 组件），照搬仓库根 client.js 的 MutationObserver 兜底重挂模式。
// 会话 cwd 取法与 app 端一致：ctx.sessions.list.getSnapshot().byId[?]?.cwd
// （参照 dsh-client-ui-conversation 的 sessions.list.getSnapshot().byId[sessionId]?.cwd）。

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
    const ERROR_COPY = {
      'rate-limit': 'GitHub API 限流，稍后再试；或在「设置 → dsh-find 找同类」里填写 token 提升额度',
      auth: 'token 无效或已过期，请到「设置 → dsh-find 找同类」检查',
      'no-metadata': '没有可识别的项目元数据（缺 package.json / README / git remote）',
      'no-project': '目录不存在或不是有效项目',
      // m03271: corporate MITM re-signs HTTPS — node rejects the unknown root
      tls: 'HTTPS 证书校验失败（本机网络有 HTTPS 拦截）。若信任该网络，到「设置 → dsh-find 找同类」把「跳过 HTTPS 证书校验」设为开启',
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
          el('strong', { style: { fontSize: '13px' } }, '找同类项目'),
          el(
            'button',
            {
              'aria-label': '关闭',
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

    function bodyText(panel, text) {
      const div = el('div', { style: { padding: '8px 2px', lineHeight: '1.5' } }, text)
      panel.append(div)
      return div
    }

    // 行2：简要总结（2 行截断）；有完整 description 且与总结不同时可点击展开/收起。
    // 点击只切换展开态，不触发跳转（与行1 的链接分开）。
    function descRow(repo) {
      const summary = repo.summary ?? repo.description ?? '（暂无描述）'
      const full = typeof repo.description === 'string' && repo.description ? repo.description : null
      const expandable = Boolean(full && full !== summary)
      let expanded = false
      const label = el('span', null, summary)
      // m02773: AI 简介是中文概括，展开看到的却是英文原文——摘要含中文
      // 而原文不含中文时，提示词用「原文」，避免用户以为展开是同语言的长文
      const isZh = (t) => /[\u4e00-\u9fff]/.test(t ?? '')
      const showsOriginal = () => isZh(summary) && !isZh(full)
      const collapseHint = () => (!expandable ? '' : showsOriginal() ? ' 原文 ▾' : ' 展开 ▾')
      const expandHint = () => (!expandable ? '' : showsOriginal() ? ' 原文 ▴' : ' 收起 ▴')
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
          title: expandable ? (showsOriginal() ? '点击查看原文描述' : '点击查看完整描述') : undefined,
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

    async function runAnalyze(panel, path) {
      const loading = el('div', { style: { padding: '8px 2px' } }, '正在分析当前项目并搜索 GitHub…')
      panel.append(loading)
      let data
      try {
        const res = await fetch('/api/dsh-find/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        data = await res.json()
      } catch (err) {
        loading.remove()
        bodyText(panel, `请求失败：${err?.message ?? err}`)
        return
      }
      loading.remove()
      if (data?.error) {
        const copy = ERROR_COPY[data.error.code] ?? data.error.message ?? data.error.code
        bodyText(panel, copy)
        return
      }
      const repos = data?.repos ?? []
      if (repos.length === 0) {
        bodyText(panel, '没有找到相似项目，换个目录或在「设置 → dsh-find 找同类」里补充 token 再试。')
        return
      }
      // review minor: surface the query-source (LLM-refined vs heuristic) so a
      // degraded LLM path is visible instead of silently looking identical
      const sourceHint = data?.source === 'llm'
        ? '搜索词由 LLM 提炼'
        : '启发式搜索（未用 LLM 提炼查询词）'
      panel.append(el('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)', marginBottom: '4px' } }, sourceHint))
      // m02536: dir-name fallback — the folder had no package.json / README /
      // git-remote metadata, so the search ran on the directory basename; tell
      // the user the basis of the results so they can judge relevance.
      if (data?.nameSource === 'dir') {
        const dirName = String(path).split(/[\\/]/).filter(Boolean).pop() ?? ''
        panel.append(el('div', {
          style: {
            fontSize: '11px',
            color: 'var(--dsw-warn-fg, #b96a00)',
            background: 'var(--dsw-warn-bg, #fff4e0)',
            border: '1px solid var(--dsw-warn-border, #f0d9a8)',
            borderRadius: '6px',
            padding: '4px 8px',
            marginBottom: '4px',
          },
        }, `未识别到项目元数据（缺 package.json / README / git remote），已按目录名「${dirName}」搜索`))
      }
      // m03591: the dir had no markers but holds a project one level down — say
      // which child the search was based on so the result basis is visible.
      if ((data?.nameSource === 'child-pkg' || data?.nameSource === 'child-remote') && data?.detectedPath) {
        const childName = String(data.detectedPath).split(/[\\/]/).filter(Boolean).pop() ?? ''
        panel.append(el('div', {
          style: {
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #555)',
            background: 'var(--dsw-alias-bg-l2, #f5f5f5)',
            border: '1px solid var(--dsw-alias-border-l2, #e5e5e5)',
            borderRadius: '6px',
            padding: '4px 8px',
            marginBottom: '4px',
          },
        }, `当前目录没有项目文件，已按子目录「${childName}」的项目识别`))
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
                    typeof repo.relevance === 'number' ? ` · 相关度 ${Math.max(0, Math.min(100, Math.round(repo.relevance)))}` : ''
                  }${repo.language ? ` · ${repo.language}` : ''}`,
                ),
              ),
            ),
            descRow(repo),
          ),
        )
      }
      panel.append(list)
    }

    // Settings-page config form (m03752). This is now the ONLY config UI: the
    // panel's ⚙ entry was removed. Field kinds: text | number | bool | select |
    // csv. Dotted keys nest into the POST body ({ llm: {...} } etc.).
    const CONFIG_SECTIONS = [
      {
        title: 'GitHub 访问',
        desc: '搜索走 GitHub 官方 Search API：带 token 每分钟 30 次，匿名 10 次。',
        fields: [
          { key: 'token', label: 'GitHub Token', hint: '可选，留空 = 匿名搜索' },
          { key: 'proxy', label: '代理地址', hint: '可选，如 http://127.0.0.1:7890' },
          {
            key: 'tlsAllowUnauthorized',
            label: '跳过 HTTPS 证书校验',
            kind: 'bool',
            hint: '仅当提示「证书校验失败」且信任本机网络时开启',
          },
        ],
      },
      {
        title: 'LLM 增强',
        desc: '用模型为搜索结果生成中文简介。dsh = 跟随当前会话模型（推荐）。',
        fields: [
          {
            key: 'llm.mode',
            label: '模式',
            kind: 'select',
            options: [
              ['', '默认（跟随会话模型）'],
              ['dsh', 'dsh（跟随会话模型）'],
              ['openai', 'openai（自填兼容端点）'],
            ],
          },
          { key: 'llm.baseUrl', label: 'Base URL', hint: '仅 openai 模式需要，如 https://api.openai.com/v1' },
          { key: 'llm.apiKey', label: 'API Key', hint: '仅 openai 模式需要' },
          { key: 'llm.model', label: '模型名', hint: '仅 openai 模式需要，如 gpt-4o-mini' },
        ],
      },
      {
        title: '评分权重',
        desc: '相关度 = 各项加权之和。留空 = 使用默认值。',
        fields: [
          { key: 'scoring.weights.language', label: '语言匹配', kind: 'number', hint: '默认 25' },
          { key: 'scoring.weights.keywordPerHit', label: '每关键词命中', kind: 'number', hint: '默认 5' },
          { key: 'scoring.weights.keywordCap', label: '关键词得分上限', kind: 'number', hint: '默认 45' },
          { key: 'scoring.weights.stars', label: '星数', kind: 'number', hint: '默认 20' },
          { key: 'scoring.weights.recent', label: '两年内更新', kind: 'number', hint: '默认 10' },
        ],
      },
      {
        title: '结果过滤',
        desc: '搜索后先过滤再排序。留空 = 使用默认值。',
        fields: [
          { key: 'filters.minStars', label: '最少星数', kind: 'number', hint: '默认 0（不过滤）' },
          { key: 'filters.excludeForks', label: '排除 fork', kind: 'bool', hint: '默认关闭' },
          {
            key: 'filters.excludeArchived',
            label: '排除已归档',
            kind: 'bool',
            hint: '默认开启（滤掉「Moved to …」空壳仓库）',
          },
          {
            key: 'filters.languages',
            label: '语言白名单',
            kind: 'csv',
            hint: '逗号分隔，如 JavaScript, TypeScript；留空 = 不限',
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
            el('strong', { style: { fontSize: '13px', fontWeight: '600' } }, section.title),
            el('span', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, section.desc),
          ),
        )
        for (const field of section.fields) {
          const kind = field.kind ?? 'text'
          const row = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } })
          const labelId = `dsh-find-${field.key.replace(/\./g, '-')}`
          const label = el('label', {
            for: labelId,
            style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #555)' },
          }, field.label)
          let control
          if (kind === 'select') {
            control = el('select', {
              id: labelId,
              'data-dsh-find': `config-${field.key.replace(/\./g, '-')}`,
              style: { ...inputStyle, cursor: 'pointer' },
            })
            for (const [value, text] of field.options) {
              const opt = el('option', { value }, text)
              control.append(opt)
            }
          } else if (kind === 'bool') {
            control = el('select', {
              id: labelId,
              'data-dsh-find': `config-${field.key.replace(/\./g, '-')}`,
              style: { ...inputStyle, cursor: 'pointer' },
            })
            for (const [value, text] of [['', '默认（不修改）'], ['true', '开启'], ['false', '关闭']]) {
              control.append(el('option', { value }, text))
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
          if (field.hint) {
            row.append(
              el('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #888)' } }, field.hint),
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
                    status.textContent = `无效数值：${field.label}（需 ≥0 的数字）`
                    return
                  }
                  setNested(body, field.key, n)
                  continue
                }
                if (kind === 'csv') {
                  if (!v) continue
                  const list = v.split(',').map((x) => x.trim()).filter(Boolean)
                  if (!list.length) {
                    status.textContent = `无效输入：${field.label}（需至少一个值）`
                    return
                  }
                  setNested(body, field.key, list)
                  continue
                }
                // text: empty string explicitly unsets the stored value
                setNested(body, field.key, v)
              }
            }
            status.textContent = '保存中…'
            try {
              const res = await fetch('/api/dsh-find/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              })
              const data = await res.json()
              status.textContent = data?.ok ? '已保存' : `保存失败：${res.status}`
              if (data?.ok) setTimeout(() => (status.textContent = ''), 1500)
            } catch (err) {
              status.textContent = `保存失败：${err?.message ?? err}`
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
        '保存',
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

    function openPanel(ctx) {
      closePanel() // 重复点击：先移除旧面板再新开
      const panel = panelShell()
      document.body.append(panel)

      const path = resolvePath(currentSessionCtx(ctx))
      if (path === null) {
        bodyText(panel, '无法确定当前项目（没有活跃会话或 cwd）')
        return
      }
      runAnalyze(panel, path)
    }

    function mountButton(ctx) {
      const docks = document.querySelectorAll('[data-composer-dock]')
      for (const dock of docks) {
        if (dock.querySelector('[data-dsh-find="button"]')) continue
        const btn = el(
          'button',
          {
            'data-dsh-find': 'button',
            title: '识别当前项目并在 GitHub 上找同类项目',
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
          '🔍 找同类',
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
                  el('strong', { style: { fontSize: '15px', fontWeight: '600' } }, '找同类项目'),
                  el(
                    'span',
                    { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
                    '在输入框旁点「🔍 找同类」，按当前会话目录识别项目并在 GitHub 搜索相似仓库。下方配置全局生效。',
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
      inject: ['sessions', 'slots'],
      apply(ctx) {
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
