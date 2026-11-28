# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Renamed the package to `dsh-find-project`** (m06953): npm/bundle name, cordis patch id,
  client loader id, and host service name all move together; profile `dependencies` key and
  `dsh.profile.bundles` entry must be updated to `"dsh-find-project"`. Internal identities
  (routes `/api/dsh-find/*`, config file `~/.dsh/dsh-find.config.json`, i18n namespace) are
  unchanged, so existing settings and tokens keep working.

### Added

- **Panel sort switcher** — re-order results by relevance / stars / recently updated
  (per-call; the server re-sorts the ranked pool and the cache keys per sort).
- **Result count setting** (`limit`, default 10 / max 50) plus a panel **"Load more"** button
  at the end of the results list (moved out of the top toolbar, m05987) that appends 5 more
  results per round without rewriting the saved setting.
  The analyze response now echoes `totalPool` (the deduped+filtered pool size before the
  trim): the button counts the *real* remainder and a drained pool shows
  「已加载全部 N 条 / All N results loaded」instead of a button that yields fewer than promised.
- **Bilingual UI** (English / 中文) — all panel, button, error and settings texts bound through
  `ctx.locale` with dictionary fallback.
- **Session-model query refinement** — `llm.mode: 'dsh'` (default) now refines search queries
  through the current session model (1-3 English query terms), in addition to generating the
  Chinese result summaries; unavailable models fall back to heuristic queries silently.
- Settings-page card "结果数量与排序" (result count + default sort) with persisted `limit`
  and `sort` config keys.
- **对比咨询 (Compare advice)** — opt-in via the new "对比咨询" settings card. When
  `compare.enabled` is on, `/api/dsh-find/analyze` carries `compareCandidates` (thresholds:
  `minStars` 100 / `minRelevance` 50 / `maxCount` 3 / `months` 24, all configurable);
  the panel shows a per-repo「对比」button plus a「对比 Top N」aggregate button. New
  `POST /api/dsh-find/compare` reads the current project intent fresh, pulls each repo's
  README + top issues (single failures degrade to metadata-only), and the session model
  writes a four-part Chinese report: 功能差距 / 踩坑预警 / 架构借鉴 / 优先级建议.
  Errors surface as `compare-disabled` / `compare-model` / `compare-empty`.
- CHANGELOG and English quick-start section in the README.

### Changed

- `/api/dsh-find/analyze` accepts optional per-call `limit` and `sort` body overrides
  (clamped/sanitized like the saved config; cache entries are separated per combination).
- `/api/dsh-find/analyze` response now echoes the effective `limit` so the panel can
  show/hide "Load more".
- Config `sort` persisted and sanitized (`normalizeSort`, unknown → `relevance`).
- **Keyword extraction rewritten** (`intent.js`) — one shared `tokenize(text, { cjk })`
  now feeds both query building and relevance scoring:
  - CJK support: the old ASCII-only `split(/[^a-z0-9]+/)` dropped Chinese descriptions
    entirely, so a Chinese project produced no usable query. Chinese now tokenizes into
    overlapping bigrams (or whole runs for name/keywords), and the scorer matches them.
  - Weighted extraction: `name ×3 > keywords ×2 > description ×1`, top 8 instead of the
    first 12 words by appearance order.
  - Bigger stop-word list (marketing words like `plugin` / `simple` / `fast` / `awesome`
    are pure noise in an AND query) and minimal plural folding (`repositories` →
    `repository`), applied identically on the scoring side.
  - `language` no longer competes for a keyword slot — it is already a `language:`
    qualifier.
- **Query building rewritten as a gradient** (`query.js`) — GitHub search is AND
  semantics, so a single query carrying 8+ words matched nothing:
  1. `name + 4 description words` (precise) →
  2. `name`-only workhorse →
  3. keyword groups of 3 (`in:description,topics`, up to 2 groups) →
  4. wide fallback on the top 2 keywords **without** the `language:` qualifier →
  5. dependency co-occurrence (`in:readme`), first to be dropped at the cap.
  Hard cap of 5 queries per analysis (anonymous search allows 10/min), duplicates removed,
  and description-only CJK bigrams never reach a query (they match nothing on GitHub).
- **Spam-resistant ranking** (`score.js`) — keyword-stuffed junk repos used to top the list
  (GitHub's auto-generated `<adjective>-<noun>` names, e.g. `Sfedfcv/redesigned-pancake`,
  carrying a description full of the project's keywords):
  - Popularity now only counts when the **repo name** shares a keyword with the project.
    A keyword-stuffed description is cheap to fake; a matching name is not.
  - Repos whose name matches GitHub's random-name shape *and* shares no keyword with the
    project are dropped before ranking (and before `totalPool` is counted). A legitimate
    `urban-robot` survives as soon as `robot` is one of its keywords.

## [0.1.0]

### Added

- Initial release: composer-dock「🔍 找同类」button, result panel (name / stars / relevance /
  language / expandable description), heuristic project intent detection
  (package.json → git remote → directory basename, with a child-directory fallback),
  GitHub search via the host web server (`/api/dsh-find/analyze`), relevance scoring with
  tunable weights, result filters (minStars / excludeForks / excludeArchived / language whitelist),
  LLM enhancement (`openai` mode: query refinement + reranking; `dsh` mode: session-model
  Chinese summaries), 10-minute result cache, settings-page config form
  (GET/POST `/api/dsh-find/config`), rate-limit / auth / network / TLS error mapping,
  proxy support, and optional token.
