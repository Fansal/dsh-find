# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Panel sort switcher** — re-order results by relevance / stars / recently updated
  (per-call; the server re-sorts the ranked pool and the cache keys per sort).
- **Result count setting** (`limit`, default 10 / max 50) plus a panel **"Load more"** button
  that appends 10 more results per round without rewriting the saved setting.
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
