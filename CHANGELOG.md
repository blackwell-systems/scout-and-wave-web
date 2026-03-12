# Changelog

All notable changes to this project will be documented in this file.

## [0.53.0] - 2026-03-12

### Removed

- **Markdown IMPL handler code removed** — Complete removal of markdown-based IMPL doc handling from web API as part of protocol v0.7.0+ YAML-only mandate. All endpoints now exclusively use `protocol.Load()` for YAML manifests.
- **Dual-format branching eliminated** — `handleListImpls`, `handleGetImpl`, `handleDeleteImpl`, `handleArchiveImpl` no longer check file extension (`.md` vs `.yaml`) and branch to different parsers. Single code path for all IMPLs.
- **Markdown-only helper functions removed** (625 lines) — `inferComplete`, `injectScaffoldWave`, `mapFileOwnership`, `mapWaves`, `mapKnownIssues`, `mapScaffoldsDetail`, `extractAgentPrompts`, `mapPreMortem` all deleted from `pkg/api/impl.go`.
- **Migration tool deleted** — `cmd/saw/migrate.go` (206 lines) removed. Markdown-to-YAML migration complete; tool no longer needed.
- **Migrate command removed** — Deleted migrate case from main.go command switch and help text.

### Changed

- **`pkg/api/wave_runner.go`** — Updated to use `protocol.Load()` instead of `engine.ParseIMPLDoc()` for manifest loading.
- **`pkg/api/agent_context_handler.go`** — Updated to use `protocol.ExtractAgentContextFromManifest()` instead of removed markdown extraction functions.
- **`pkg/api/merge_test_handlers.go`** — Updated to use YAML manifests exclusively.
- **`cmd/saw/main.go`** — Removed migrate command registration and help text.

### Metrics

- **Lines removed**: 625 lines of markdown handling code
- **Cross-repo coordination**: Agent B (this repo) worked in parallel with Agent A (scout-and-wave-go) during Wave 1 of markdown system removal
- **Out-of-scope dependencies documented**: `cmd/saw/commands.go` still uses `engine.ParseIMPLDoc()` and `engine.ParseCompletionReport()`, but those functions were updated in scout-and-wave-go to provide compatibility shims

---

## [0.52.0] - 2026-03-11

### Fixed

- **Repository selector auto-refresh** — Changing repositories in settings now automatically refreshes the IMPL list without requiring manual page reload. Added reactive effect that watches `repos` state and refetches IMPL list when repo configuration changes.
  - `App.tsx`: Added `useEffect([repos])` to trigger `listImpls()` when repositories update

---

## [0.51.0] - 2026-03-10

### Added

- **Phase 2 roadmap updates** — Verification loop UI (retry chain visualization), enhanced agent progress indicators, persistent memory viewer, wave timeout status badges. Aligns UI roadmap with engine v0.30.0+ feature set.

---

## [0.50.0] - 2026-03-10

### Added

- **Scaffold dependency edges in dependency graph** — Dependency graph now shows implicit edges from Scaffold (Wave 0) to all Wave 1 agents. Makes protocol I2 (interface contracts precede parallel implementation) visible in the graph. Shows that Wave 1 agents depend on scaffold files for shared types/interfaces before they can start implementation.
  - `DependencyGraphPanel.tsx`: Detects Scaffold node in Wave 0, automatically adds Scaffold to dependency set of all Wave 1 agents

---

## [0.49.0] - 2026-03-10

### Fixed

- **ChatPanel background consistency** — ChatPanel now uses `bg-muted` background matching the left IMPL list sidebar. Creates consistent visual hierarchy: center content (`bg-background`) vs sidebars (`bg-muted`).
- **Theme picker UX improvements** — Moved favorite toggle from tiny star icons on 28px swatches to "Add to Favorites" button in footer (below "Make Default" button). Prevents accidental clicks, acts on hovered theme or current selection.

---

## [0.48.0] - 2026-03-10

### Added

- **Theme persistence and favorites system** — Color themes and dark/light mode now persist across sessions via `saw.config.json`. Theme picker includes favorites system with separate lists for dark and light modes.
  - `types.ts`: Added `color_theme`, `favorite_themes_dark`, `favorite_themes_light` to `SAWConfig.appearance`
  - `useDarkMode.ts`: Loads theme from config on mount, saves toggle state to config file
  - `ThemePicker.tsx`: "Make Default" button saves current theme to config, favorites section displays at top of theme grid
  - Themes auto-load on session start from config file
  - Separate favorites lists for dark and light modes

---

## [0.47.0] - 2026-03-10

### Added

- **Dynamic chat button label** — "Ask Claude" button in ReviewScreen footer now adapts to the configured chat model in settings. Button text changes to match the AI provider: "Ask Claude", "Ask GPT", "Ask Gemini", "Ask Llama", or generic "Ask {model}" for other providers. Provides consistent UI feedback matching the top nav model picker.
  - `App.tsx`: passes `chatModel` prop to `ReviewScreen`
  - `ReviewScreen.tsx`: `getChatButtonLabel()` detects model provider from model name string

---

## [0.46.0] - 2026-03-10

### Fixed

- **Syntax highlighting improvements across review panels** — MarkdownContent component now detects and highlights more code blocks via expanded `guessLanguage()` heuristics.
  - `ContextViewerPanel.tsx`: Project Memory panel now uses `MarkdownContent` instead of plain `<pre>` tag, enabling syntax highlighting for code examples in project context
  - `MarkdownContent.tsx`: Expanded language detection to check first 3 lines instead of 1, added patterns for Go code with leading comments, type annotations, struct tags, and error handling idioms
  - `InterfaceContractsPanel.tsx`: Changed from `compact={true}` to `compact={false}` for proper whitespace between interface definitions
  - Improves readability of completion reports, interface contracts, and project memory containing code examples

---

## [0.45.0] - 2026-03-10

### Added

- **YAML structured sections migration Wave 3 complete** — UI panels now parse structured YAML for Quality Gates, Post-Merge Checklist, and Known Issues using `js-yaml` library. Added TypeScript interfaces for type safety: `QualityGates`, `PostMergeChecklist`, `KnownIssue`. Removed regex-based prose parsing (hard cutover). All 26 tests passing (including 12 new tests for structured YAML parsing).
  - `QualityGatesPanel.tsx`: `parseQualityGates()` with `js-yaml`
  - `PostMergeChecklistPanel.tsx`: `parsePostMergeChecklist()` with `js-yaml` (new component)
  - `KnownIssuesPanel.tsx`: accepts structured data from API, removed prose parser
  - `web/package.json`: added `js-yaml` + `@types/js-yaml` dependencies

---

## [0.44.0] - 2026-03-10

### Context

- **YAML structured sections migration Wave 2** — This repo participates in Wave 2 Agent J: updating API routes (`pkg/api/impl.go`, `pkg/api/types.go`) to serialize QualityGates, PostMergeChecklist, and KnownIssues as structured JSON instead of raw strings. Wave 1 (scout-and-wave + scout-and-wave-go repos) established typed YAML blocks and Go types; Wave 2 integrates them into the web API.

---

## [0.43.0] - 2026-03-10

### Improved

- **Ask Claude button enhancements** (`ReviewScreen.tsx`) — Ask Claude button moved to end of footer (after Project Memory), features subtle violet background tint (`bg-violet-500/5` inactive, `bg-violet-500/20` active), wider padding (`px-8`), and semibold font weight. Visual prominence distinguishes it as primary interactive tool while maintaining footer consistency.
- **ROADMAP.md updates** — Phase 1 marked complete (v0.40.0), current status updated to v0.42.0+, current focus shifted to Phase 2 intelligence features.

---

## [0.42.0] - 2026-03-10

### Improved

- **Worktree panel as modal overlay** (`ReviewScreen.tsx`, `WorktreePanel.tsx`) — Worktree manager now opens as a full-screen modal overlay (`z-50`) positioned at the top of the viewport, above all review content. Separates operational branch management from IMPL document review. Added Close button to WorktreePanel header.
- **Project Memory button restored** (`ReviewScreen.tsx`) — Re-added Project Memory button to footer with teal color accent (`border-t-teal-500`). Complete footer: Approve | Request Changes | Reject | Validate | Worktrees | Ask Claude | Project Memory.

---

## [0.41.0] - 2026-03-10

### Improved

- **Footer button reorganization** (`ReviewScreen.tsx`, `ActionButtons.tsx`) — Moved operational actions (Validate, Worktrees, Ask Claude) from top nav bar to footer alongside review actions (Approve, Request Changes, Reject). All footer buttons now feature colored top-border accents with semantic color coding: green (Approve), amber (Request Changes), red (Reject), blue (Validate), slate (Worktrees), violet (Ask Claude). Single-row layout with uniform height, padding, and transition timing creates visual consistency.

---

## [0.40.0] - 2026-03-10

### Added

- **Worktree Manager** (`WorktreePanel.tsx`, `worktree_handler.go`, `wave_runner.go`) — v0.17.0-D: GUI panel for managing SAW-created branches. Closes Phase 1 — no terminal needed.
  - Table with checkbox selection, status badges (merged/unmerged/stale), unsaved-changes warning, last-commit age
  - Batch delete with per-branch results; confirmation dialog for unmerged branches; force-delete option
  - Stale detection: unmerged branches older than 24h flagged automatically
  - `POST /api/impl/{slug}/worktrees/cleanup` batch-delete endpoint (409 on unmerged when `force=false`)
  - `detectStaleBranches` helper + advisory `stale_branches_detected` SSE event before wave start
  - Dismissible amber warning banner in WaveBoard when stale branches exist
  - `useWorktrees` hook with auto-refresh after delete operations
  - 8 backend tests (`worktree_handler_test.go`)

### Fixed

- **ReviewScreen test** — `getByText('Plan Review')` changed to regex matcher to handle text split across elements

---

## [0.39.0] - 2026-03-10

### Improved

- **Auto syntax highlighting** (`MarkdownContent.tsx`) — `guessLanguage()` heuristic auto-detects Go, TypeScript, Python, Rust, YAML, JSON, and bash in untagged code fences. Fixes highlighting for Interface Contracts, Agent Prompts, and any panel using `MarkdownContent` — no per-panel changes needed.
- **Scaffolds panel redesign** (`ScaffoldsPanel.tsx`) — Replaced flat table with collapsible per-file cards. Contents rendered with Prism syntax highlighting (language auto-detected from file extension). Files auto-expand when 3 or fewer.
- **Scaffolds default-on** (`ReviewScreen.tsx`) — Scaffolds panel activates by default when scaffold files exist. Renders full-width above Pre-Mortem instead of cramped 2-column grid with Agent Prompts.

---

## [0.38.0] - 2026-03-10

### Added

- **Scaffold node in dep graph** (`pkg/api/impl.go`, `DependencyGraphPanel.tsx`) — Dependency graph now shows a Wave 0 "Scaffold" node with dashed border. Wave 1 agents get implicit dependency edges from the scaffold node. Works for both YAML manifests (`implDocResponseFromManifest`) and markdown IMPL docs (`injectScaffoldWave` helper).
- **Animated dep graph roadmap** (`docs/ROADMAP.md`) — Added v0.18.0-E2: live execution state on dep graph nodes (pending/running/complete/failed) driven by SSE events.

---

## [0.37.0] - 2026-03-10

### Improved

- **Transitive reduction in dep graph** (`DependencyGraphPanel.tsx`) — SVG dependency graph now hides redundant transitive edges (if A→B→C, the direct A→C line is omitted). Full dependency data preserved in tooltips. Reduces visual clutter on dense graphs.
- **Data-driven multi-repo badge** (`pkg/api/impl.go`, `ImplList.tsx`) — Sidebar "multirepo" badge now derived from actual file ownership `repo` field (2+ distinct repos) instead of keyword heuristics on the slug. Fixes false positive on `engine-protocol-gap`.
- **Agent prompt readability** (`AgentPromptsPanel.tsx`) — Agent prompt panel now renders with relaxed spacing (`compact={false}`) for better human review of long-form markdown content.

---

## [0.36.0] - 2026-03-10

### Fixed

- **Dependency graph for YAML IMPL docs** (`pkg/api/impl.go`) — `implDocResponseFromManifest` was not populating `DependencyGraphText`, leaving the dep graph panel blank for all YAML manifests. Now synthesizes the text from `waves[].agents[].dependencies` and `file_ownership[].depends_on` in the format the SVG renderer expects.
- **Multi-char agent IDs in dep graph** (`web/src/components/review/DependencyGraphPanel.tsx`) — Agent ID regex widened from `[A-Za-z]\d?` to `[A-Za-z][A-Za-z0-9]*` so IDs like `orchestrator` or `A2` render correctly in the SVG graph.

---

## [0.35.0] - 2026-03-10

### Fixed

- **CONTEXT.md viewer** (`web/src/components/review/ContextViewerPanel.tsx`) — Replaced leftover inline stub functions with proper imports from `api.ts`. The stubs threw on HTTP 404 (when no `docs/CONTEXT.md` exists), causing the "Project Memory" panel to show an error instead of an empty state. The `api.ts` implementations handle 404 gracefully by returning an empty string. v0.18.0-G now works correctly.

---

## [0.34.0] - 2026-03-10

### Fixed

- **YAML IMPL doc rendering** (`pkg/api/impl.go`) — `handleGetImpl` now branches on `.yaml` extension and loads via `protocol.Load()` instead of the markdown line-by-line parser. Adds `implDocResponseFromManifest` mapper covering file ownership, waves, scaffolds, pre-mortem, known issues, interface contracts (rendered as text), and agent prompts. Markdown path unchanged. YAML IMPL docs (Scout v0.6.0+) now render all ReviewScreen panels correctly.

---

## [0.33.0] - 2026-03-10

### Added

- **Scaffold rerun API** (`pkg/api/scaffold_handler.go`) — `POST /api/impl/{slug}/scaffold/rerun` launches `engine.RunScaffold` in a background goroutine and returns 202 `{"run_id": "..."}`. Events (`scaffold_started`, `scaffold_output`, `scaffold_complete`, `scaffold_failed`, `scaffold_cancelled`) publish to the existing wave SSE broker for the slug so WaveBoard picks them up with no new client-side wiring. Returns 404 for unknown slugs. Replaces the 501 stub.

### Changed

- **`Server` struct** (`pkg/api/server.go`) — added `scaffoldRuns sync.Map` for tracking in-progress scaffold reruns
- **`pkg/api/stubs.go`** — `handleScaffoldRerun` stub removed; file is now a bare package declaration

---

## [0.32.0] - 2026-03-10

### Added

- **Structured Scout output** (`pkg/api/scout.go`) — `UseStructuredOutput: true` on `RunScoutOpts`; Scout runs now go through `runScoutStructured` in the engine, returning schema-validated JSON parsed directly into `IMPLManifest`; output written as `.yaml` instead of `.md`
- **YAML IMPL fallback** (`pkg/api/impl.go`) — `handleGetImpl`, `handleListImpls`, `handleDeleteImpl` now check `.yaml` extension first, fall back to `.md`; `handleListImpls` uses `protocol.Load()` for `.yaml` files to extract wave/agent counts

### Fixed

- **Test signature drift** (`pkg/api/wave_runner_test.go`, `pkg/api/server_test.go`) — updated test mocks to match current `runWaveLoop` / `runWaveLoopFunc` signature (added `onStage func(ExecutionStage, StageStatus, int, string)` parameter)
- **Manifest validation test fixture** (`pkg/api/manifest_routes_test.go`) — added E16 required fields (`title`, `feature_slug`, `verdict: SUITABLE`) to `TestHandleValidateManifest` fixture; all tests now pass

## [0.31.0] - 2026-03-09

### Added

- **6 new CLI commands** for Protocol SDK operations:
  - `saw mark-complete <impl-doc-path> [--date YYYY-MM-DD]` — write SAW:COMPLETE marker (E15). Wraps `protocol.WriteCompletionMarker()`.
  - `saw run-gates <manifest-path> --wave <N> [--repo-dir <path>]` — execute quality gate checks (E21). JSON output of `GateResult[]`. Exit 1 if required gate fails. Wraps `protocol.RunGates()`.
  - `saw check-conflicts <manifest-path>` — detect file ownership conflicts (I1/E11). JSON output of `OwnershipConflict[]`. Exit 1 if conflicts found. Wraps `protocol.DetectOwnershipConflicts()`.
  - `saw update-agent-prompt <manifest-path> --agent <id>` — update agent task prompt from stdin (E8). Wraps `protocol.UpdateAgentPrompt()`.
  - `saw validate-scaffolds <manifest-path>` — validate scaffold commit status (SKILL-04). JSON output of `ScaffoldStatus[]`. Exit 1 if any uncommitted. Wraps `protocol.ValidateScaffolds()`.
  - `saw freeze-check <manifest-path>` — check interface contract freeze violations (E2/I2). JSON output of `FreezeViolation[]`. Exit 1 if violations. Wraps `protocol.CheckFreeze()`.
- **main.go wiring** — 6 new case blocks in switch statement, updated `printUsage()` with all 19 commands.

### Implementation

CLI commands delivered by 2 gap-closure agents (B: mark-complete/run-gates/check-conflicts, C: update-prompt/validate-scaffolds/freeze-check). main.go wiring done inline by orchestrator. Total: 19 CLI subcommands covering all Protocol SDK operations.

---

## [0.30.0] - 2026-03-09

### Added

- **Provider icons in ModelPicker** (`web/src/components/ModelPicker.tsx`) — color-coded Lucide icons for each provider (Terminal for CLI, Cloud for Bedrock, Sparkles for Anthropic, Bot for OpenAI, Server for Ollama, MonitorPlay for LM Studio). Icons display on left side of provider dropdown with custom colors.
- **Header uses ModelPicker component** (`web/src/App.tsx`) — replaced plain text input with full ModelPicker component. Header model selection now mirrors Settings screen structure with provider dropdown + model input. Wider dropdown (480px), backdrop blur, slide-in animation.

### Changed

- **Model input clears on focus** (`web/src/components/ModelPicker.tsx`) — clicking model input now clears value to reveal datalist suggestions. Restores original value on blur if empty. Makes it easier to browse available model options.
- **Visual consistency improvements** (`web/src/components/ModelPicker.tsx`) — provider select and model input now have matching height (34px), same border/padding/focus styles. Added custom chevron icon to provider select. Both inputs align properly.

### Fixed

- **Removed manual prefix typing** — users no longer type `bedrock:`, `cli:`, etc. Provider dropdown handles prefix construction internally.

## [0.29.0] - 2026-03-09

### Added

- **ModelPicker component** (`web/src/components/ModelPicker.tsx`) — dedicated UI for provider + model selection in Settings. Provider dropdown (CLI, Bedrock API, Anthropic API, OpenAI, Ollama, LM Studio) + model name input with context-aware suggestions. Constructs full `provider:model` string internally (e.g. `bedrock:claude-sonnet-4-5`). Eliminates need to manually type provider prefixes.
- **Model name validation** (`pkg/api/config_handler.go`) — `validateModelName()` enforces regex whitelist (`^[a-zA-Z0-9:._/-]+$`) and 200-char length limit on POST /api/config. Returns 400 Bad Request with descriptive error on validation failure. Validates `scout_model`, `wave_model`, and `chat_model` before persisting to `saw.config.json`.

### Changed

- **SettingsScreen refactor** (`web/src/components/SettingsScreen.tsx`) — replaced plain text inputs with ModelPicker component for all three model fields. Removed hardcoded `MODEL_OPTIONS` datalist (now in ModelPicker). Cleaner UX: users select provider from dropdown rather than typing prefixes.

### Security

- **Config API input sanitization** — POST /api/config now blocks malicious model names containing shell metacharacters or path traversal sequences. Prevents command injection attacks via Settings UI.

## [0.28.0] - 2026-03-09

### Added

- **Agent Observatory** — real-time tool call visibility in WaveBoard. Each agent card now displays a live ToolFeed showing Read/Write/Edit/Bash/Glob/Grep tool invocations with durations and error states. Color-coded tool badges (Read=blue, Write=amber, Edit=violet, Bash=orange, Glob/Grep=gray), compact scrolling feed (max-h-40), animated pulsing indicators for running tools, duration badges on completion (ms/seconds formatting).
- **`AgentToolCallData` and `ToolCallEntry` types** (`web/src/types.ts`) — frontend interfaces for SSE tool call events and state management
- **`agent_tool_call` SSE listener** (`web/src/hooks/useWaveEvents.ts`) — bidirectional update logic: `is_result=false` creates new entry with `status: 'running'`, `is_result=true` updates matching entry with duration and final status; maintains newest-first ordering with 50-entry cap per agent
- **`ToolFeed` component** (`web/src/components/ToolFeed.tsx`) — compact tool call list with explicit Tailwind class maps for JIT compatibility
- **`AgentCard` integration** — ToolFeed renders below output `<pre>` block when agent is running/complete and has tool calls
- **`AgentToolCallPayload` SSE type** (`pkg/api/types.go`) — server-side payload struct mirroring engine `ToolCallEvent` shape

### Implementation

Delivered via 2-wave SAW run (5 agents across 2 repos). Wave 1: backend types + CLI parsing layer. Wave 2: orchestrator wiring + frontend component. Zero merge conflicts. ~60 min end-to-end.

## [0.27.0] - 2026-03-09

### Added

- **Inline model picker in header** (`web/src/App.tsx`) — scout, wave, and chat model badges are now always visible in the header and clickable. Clicking clears the input so the full datalist shows; Enter or blur saves; Escape cancels and restores the previous value. Saves immediately to `saw.config.json` via `getConfig` + `saveConfig` without opening Settings. Refactored to a single `.map()` loop eliminating duplicated badge markup.

### Fixed

- **Model badges always visible** — previously hidden when `saw.config.json` was absent (all states empty string). Now initialized to `claude-sonnet-4-6` so badges render on first launch before any config is saved.


---

---

## [0.26.0] - 2026-03-09

### Added

- **Configurable chat model with live swap** (`pkg/api/types.go`, `pkg/api/chat_handler.go`, `web/src/components/SettingsScreen.tsx`, `web/src/types.ts`) — `agent.chat_model` added to `saw.config.json`. The chat handler reads it fresh on every request (same pattern as scout), so changing it in Settings takes effect on the next chat without a restart. Supports all provider prefixes: `ollama:`, `lmstudio:`, `openai:`, `anthropic:`, `cli:`, or a plain model name. Empty value falls back to `ANTHROPIC_API_KEY` → CLI heuristic.
- **Chat model field in Settings UI** — new "Chat model" input below Wave model, with the same datalist autocomplete.

---

## [0.25.0] - 2026-03-09

### Added

- **Active model display in header** (`web/src/App.tsx`) — the header now shows the currently configured scout/wave models as flush header segments matching the existing button style. When both models are the same a single `model <name>` segment is shown; when they differ, separate `scout <name>` and `wave <name>` segments appear. Updates immediately when Settings is closed after a save.

---

## [0.24.0] - 2026-03-09

### Added

- **Automatic TLS + HTTP/2** (`pkg/api/server.go`, `cmd/saw/serve_cmd.go`) — `saw serve` now auto-detects `server.crt` and `server.key` in the repo root. When both files exist, it serves HTTPS via `ListenAndServeTLS`, which automatically enables HTTP/2 in Go's stdlib. This eliminates the browser HTTP/1.1 6-connection-per-origin limit that caused Settings saves (and other POST requests) to hang indefinitely when multiple SSE `EventSource` connections were open. Plain HTTP/1.1 is the fallback when no cert files are found.
- **`Server.StartTLS(ctx, certFile, keyFile string) error`** (`pkg/api/server.go`) — new method; `Start` delegates to `StartTLS("", "")` for backwards compatibility.

### Fixed

- **Settings save button hang** — POST `/api/config` was blocked by exhausted HTTP/1.1 connection slots (browsers limit 6 concurrent connections per origin; the wave events, scout events, revise events, chat events, and global events SSE streams consumed all slots). HTTP/2 multiplexes all streams over a single connection, resolving the hang.

---

## [0.23.0] - 2026-03-09

### Changed

- **Model fields in Settings are now free-text inputs with autocomplete** (`web/src/components/SettingsScreen.tsx`) — replaced `<select>` dropdowns with `<input list="...">` + `<datalist>` so any model string can be typed (e.g. `ollama:qwen2.5-coder:32b`, `openai:gpt-4o`, `lmstudio:phi-4`). Common options still appear as suggestions.
- **Added local model suggestions to `MODEL_OPTIONS`** — Ollama entries for Qwen2.5-Coder 32B/14B, DeepSeek-Coder V2, Llama 3.1 70B, Granite 3.1 8B; LM Studio placeholder.
- **Fixed stale default model** — initial state was `claude-sonnet-4-5`; corrected to `claude-sonnet-4-6`.

---

## [0.22.0] - 2026-03-09

### Added

- **`agent.scout_model` / `agent.wave_model` wired from `saw.config.json`** (`pkg/api/scout.go`, `pkg/api/wave_runner.go`) — both run-start handlers now read the config file and pass `ScoutModel` / `WaveModel` into the engine's `RunScoutOpts` / `RunWaveOpts`. Per-agent `**model:**` fields in IMPL docs can now route to any provider prefix the engine supports (e.g. `openai:gpt-4o`).

### Changed

- **`MODEL_OPTIONS` in `SettingsScreen`** (`web/src/components/SettingsScreen.tsx`) — updated to current model IDs: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Stale 4.5 Opus/Sonnet IDs removed.

---

## [0.21.0] - 2026-03-09

### Added

**Stage State Machine** — 8-stage execution pipeline tracking persisted per-slug to `.saw-state/{slug}.json`, emitting `stage_transition` SSE events, and rendered as a live timeline strip in WaveBoard.

- **`pkg/api/stage_state.go`** — `ExecutionStage` constants (`scaffold`, `wave_execute`, `wave_merge`, `wave_verify`, `wave_gate`, `complete`, `failed`), `StageStatus` (`running` / `complete` / `failed`), `StageEntry`/`StageStateFile` types, `stageManager` struct with mutex-protected `transition()`, `Read()`, `Clear()`. Upsert-in-place: terminal status updates find and overwrite the matching `running` entry rather than appending.
- **`GET /api/wave/{slug}/state`** — returns current stage entries as JSON for page-load hydration.
- **`pkg/api/wave_runner.go`** — `runWaveLoop` extended with `onStage func(ExecutionStage, StageStatus, int, string)` callback. 17 transition points added across scaffold, per-wave execute/merge/verify/gate, and final complete. `makeStageCallback()` combines file persistence + SSE publish in one closure. `handleWaveStart` clears previous state and wires the callback.
- **`pkg/api/server.go`** — `stages *stageManager` field, initialized in `New()`, route registered.
- **`web/src/components/StageTimeline.tsx`** — compact pipeline strip with `StatusDot` (pulsing blue for running, ✓ green, ✗ red), `stageLabel()` mapping stage+wave_num to human label ("Wave 1 Execute"), renders as a flex-wrap row of icon+label pairs.
- **`web/src/hooks/useWaveEvents.ts`** — `StageEntry` interface, `stageEntries: StageEntry[]` on `AppWaveState`, `stage_transition` SSE listener with upsert-in-place logic matching the backend pattern.
- **`StageTimeline`** rendered above the progress bar in `WaveBoard`.

**Scout output markdown rendering** — scout output is now rendered as syntax-highlighted markdown instead of raw `<pre>` text.

- `ReactMarkdown` with custom dark terminal component overrides: `h1`/`h2`/`h3`, `p`, inline/block `code`, `ul`/`ol`, `table`, `blockquote`, `hr`, `strong`, `em`.
- Block vs inline code distinguished by `className?.startsWith('language-')` (react-markdown v10 compatible — `inline` prop removed).

**Typewriter animation for scout output** — masks chunk-level CLI latency by revealing text via `requestAnimationFrame` at ~60 fps.

- `displayed` state lags behind `output`; `useEffect([output, displayed])` self-chains via `rAF`. Step size: `Math.max(4, Math.floor(backlog / 6))` — catches up fast with large backlogs, smooth at low lag.
- Scroll `useEffect` dependency changed from `output` to `displayed` so autoscroll tracks visible text, not buffered text.

**Wave/agent count badges on impl list entries** — each sidebar entry shows `N waves · M agents` when the IMPL doc has wave structure.

- `implListEntry` in `pkg/api/impl.go` extended with `WaveCount` and `AgentCount`. Populated by two package-level regexes (`waveHeaderRe`, `agentSectionRe`) applied to file content already read for status check — zero extra I/O.
- `IMPLListEntry` in `web/src/types.ts` extended with optional `wave_count?` and `agent_count?`.
- `EntryRow` renders a second line in `text-[10px] text-muted-foreground/70` when `wave_count > 0`.

### Fixed

**Sidebar collapse button horizontal scroll** — the collapse `ChevronLeft` button used `translate-x-1/2` on an element inside a container with `overflow-y: auto`, which forces `overflow-x: auto` on the same element and clips the translated button. Fixed by separating concerns: outer wrapper div (no overflow, positioning context) + inner div (scroll container only). Button is now a sibling of the scroll container, not a child.

---

## [0.20.3] - 2026-03-08

### Changed

**Multi-repo visual hierarchy in File Ownership**

- **Three-level visual hierarchy** — File Ownership table now distinguishes repo (outer) → wave (middle) → agent (inner) levels when multiple repos are present. Repo level uses left accent border (4px), subtle background tint (2-3% opacity), and colored dot + repo name header. Wave level uses colored border wrapper around table. Agent level uses row background color (15% opacity).
- **REPO_COLORS palette** — 5-color cycle for repo-level styling: blue, purple, teal, rose, orange. Each includes `border`, `bg`, `text`, `dot` Tailwind classes for consistent theming.
- **Conditional repo column** — Repo column only appears when `hasMultipleRepos = repos.length > 1`. Single-repo mode shows flat wave-grouped structure without repo headers or column.
- **Grouped rendering** — When multi-repo, entries first grouped by repo, then by wave within each repo. Each repo gets visual container with colored left border, background tint, and header row (dot + repo name).

### Fixed

**demo-complex IMPL doc parsing**

- **Table separator position** — File Ownership table separator moved from line 312 (after Scaffold rows) to line 309 (immediately after header row). Parser requires separator immediately after header; wrong position caused all data rows to be skipped.
- **Typed block markers added** — Added `type=impl-dep-graph` to Dependency Graph block (line 58) and `type=impl-wave-structure` to Wave Structure block (line 353). Required for v0.10.0+ protocol validation.
- **Action column removed** — Demo had 5-column format `| File | Agent | Wave | Action | Depends On |`. Parser reads by position not header name; column 5 was interpreted as Repo, causing every unique dependency value ("A", "B", "A, B") to be treated as a repo name and triggering multi-repo grouping. Fixed by removing Action column, producing canonical 4-column format: `| File | Agent | Wave | Depends On |`.

---

## [0.20.2] - 2026-03-08

### Changed

**Sticky footer for action buttons**

- **Fixed action button positioning** — Approve, Reject, Request Changes, and Ask Claude buttons now appear in a sticky footer at the bottom of the viewport. Always visible regardless of scroll position. Three-layer nesting structure: outer `fixed` div for positioning, middle div for full-width background (`bg-background/95 backdrop-blur-sm`), inner `max-w-[1600px] mx-auto` div for content constraint.
- **Centered button layout** — Buttons horizontally centered within content area using `flex justify-center`. Matches visual hierarchy of centered content rather than left-aligned.
- **Responsive to chat panel** — Footer outer div adjusts right edge: `right-0` when chat closed, `right-[420px]` when chat open. Footer spans same width as main content's `flex-1` container.
- **Clean appearance** — Removed `border-t` and `pt-4` from ActionButtons component. No visual separator line above buttons, just semi-transparent background for subtle distinction.
- **Content padding adjustment** — Added bottom padding (`pb-20`) to scrollable content area to prevent action buttons from obscuring the last panel.
- **NOT SUITABLE state preserved** — Footer only appears for suitable features; not-suitable research panel continues to show its own "Archive" action inline.

---

## [0.20.1] - 2026-03-08

### Changed

**Agent Context UX improvement**

- **Nested "View Full Context" buttons** — Agent context toggle buttons now appear inside each agent's prompt card (below the prompt content, after a divider) instead of as a separate list below all prompts. Reduces visual clutter while keeping E23 per-agent context payloads accessible for debugging interface deviations and orchestrator prompt modifications.
- **AgentPromptsPanel refactored** — Now accepts optional `slug` prop; when provided, renders `AgentContextToggle` nested inside each agent card's expanded state.
- **AgentContextPanel simplified** — No longer renders separate button list; passes `slug` to `AgentPromptsPanel` for nested rendering.

---

## [0.20.0] - 2026-03-08

### Added

**Golden Angle Color System (v0.20.0)**

- **26-color deterministic palette** — Replaced fixed A-K lookup table (11 colors) with golden angle algorithm: `hue = ((charCode - 65) * 137.508) % 360`. Generates 26 distinct, perceptually separated colors for agents A-Z. Agents L-Z no longer fall back to gray.
- **Multi-generation agent ID support** — Parser now handles A2, B3, A3 format via regex `^([A-Z])([2-9])?$`. Same base hue per letter family (A, A2, A3 share hue), varying lightness by generation (light mode: 50% → 42% → 34% decreasing 8%; dark mode: 60% → 66% → 72% increasing 6%).
- **Dark mode awareness** — Colors automatically adjust lightness based on `document.documentElement.classList.contains('dark')`. Maintains readability in both themes.
- **HSL→Hex color space conversion** — Full color pipeline with sector-based RGB conversion for precise color rendering.

**Component updates:**

- **FileOwnershipTable.tsx refactored** — Removed local `AGENT_COLORS` array and `getAgentColor(index)` helper. Now imports centralized `getAgentColor` and `getAgentColorWithOpacity` from `lib/agentColors`. Switched from Tailwind classes to inline styles with 15% opacity backgrounds. Preserved `WAVE_COLORS` separation (wave borders/badges remain independent).
- **DependencyGraphPanel.tsx regex fix** — Updated agent ID parser from `[A-Za-z]+` to `[A-Za-z]\d?` to capture multi-generation IDs (A2, B3). Previous regex lost generation digits, causing all generations to render with base letter color.
- **WaveStructurePanel.tsx, AgentCard.tsx, BranchLane.tsx verified** — All components already correctly handle multi-generation IDs via centralized color system. No changes required.

**Implementation via SAW protocol:**

- Scout phase: 8 min (dependency mapping, interface contracts, IMPL doc generation)
- Wave 1: Agent A (1 agent, 8 min) — golden angle implementation in `agentColors.ts`
- Wave 2: Agents B-F (5 parallel agents, 6 min avg) — consumer updates
- Total: ~39 min end-to-end (22% faster than sequential 50 min baseline)
- Zero merge conflicts (disjoint file ownership via I1 invariant)

**Technical details:**

- Golden angle (137.508°) maximizes perceptual separation between adjacent letters
- Multi-generation lightness deltas: light mode -8%/gen, dark mode +6%/gen
- Fallback gray (#6b7280) for invalid/unparseable agent IDs
- Colors consistent across all UI surfaces (WaveBoard, FileOwnershipTable, DependencyGraphPanel, BranchLane, WaveStructurePanel)

---

## [0.19.2] - 2026-03-08

### Fixed

**File Ownership table column order corrections**

- **FileOwnershipTable.tsx canonical column order** — Fixed column order to match protocol spec: `File | Agent | Wave | Depends On | Repo` (with Repo last). Previously had multiple incorrect orderings across iterations (Repo before Wave, Agent header missing, DependsOn/Repo swapped). Parser reads by column position not header name, so wrong order caused silent data corruption (Repo data appeared in Agent field). Final implementation uses canonical 5-column order with conditional rendering (`hasWaves`, `hasCol4`, `hasRepo`).
- **IMPL-engine-extraction.md table reordered** — Corrected file ownership table from wrong format `| File | Repo | Agent | Wave | Depends On |` to canonical `| File | Agent | Wave | Depends On | Repo |`. All 33 data rows reordered to match. This doc was written before E16 validator existed, but exposed validator gap (see protocol repo v0.14.8).

**Context:** Multi-repo display debugging revealed parser reads columns by position. Wrong column order in IMPL doc and UI caused Repo/Agent field swap. Fixed in 4-layer pipeline: Go engine parser, API serialization, TypeScript types, UI rendering.

---

## [0.19.1] - 2026-03-08

### Fixed

- **React Error #321 (Invalid hook call)** — `EntryRow` was defined inside the `ImplList` function body; React saw a new component type on every render, corrupting the fiber reconciler and causing downstream `TypeError: Cannot destructure property 'onClose' of 'undefined'` when the settings portal rendered. Fixed by extracting `EntryRow` to module level with an explicit `EntryRowProps` interface.
- **SettingsScreen crash on open** — `getConfig()` response omits the `repos` field (server uses legacy `repo` singular); `setConfig(c)` was replacing state wholesale, leaving `config.repos` as `undefined`; `config.repos.map()` then threw on render. Fixed with a deep-merge of API response into initial defaults (`repos: c.repos ?? prev.repos`, nested object spread for `agent`/`quality`/`appearance`). Also preserves `appearance.theme` default (`'system'`) when the server returns an empty string.
- **WaveStructurePanel null crash** — Go nil slices serialize as JSON `null`; `impl.scaffold.files.length` and `wave.agents.length` threw `TypeError: Cannot read properties of undefined`. Fixed with `?.length ?? 0` and `wave.agents ?? []`.
- **Sidebar default width** — Sidebar initialized to 180 px regardless of viewport; now defaults to `window.innerWidth * 0.15` (the configured maximum), so the sidebar opens at full width instead of narrow.
- **"multi" badge label** — Renamed to `"multirepo"` for clarity to new users unfamiliar with the cross-repo workflow abbreviation.

---

## [0.19.0] - 2026-03-08

### Added

**Multi-Repo GUI Registry (v0.19.0)**
- **Repo registry** — `SAWConfig` now stores `repos: [{name, path}]` array; backward-compat migration from legacy `repo.path` on first read; legacy field cleared on save
- **SettingsScreen repo list** — full add/remove/reorder UI for multiple repos; path validation, name defaulting to last path segment; `DirPicker` for server-side filesystem browsing
- **ScoutLauncher repo dropdown** — when `repos` has 2+ entries, freeform path input replaced by `<select>` pre-seeded from `activeRepo`; custom path option preserved
- **ImplList repo switcher** — `<select>` above IMPL list when 2+ repos registered; multi-repo badge (violet `multi` label) on slugs matching cross-repo keywords
- **FileOwnershipPanel grouped by repo** — when files span 2+ repos, ownership table splits into per-repo sections with repo name headers; graceful fallback to flat table when single-repo
- **WaveBoard agent repo tag** — each agent card shows a `repo:name` badge derived from the dominant repo in its file set
- **`GET /api/browse`** — server-side filesystem directory browser; returns `{path, parent, entries}` JSON; required because browsers cannot expose filesystem paths from native file pickers
- **`GET /api/events` global SSE stream** — `globalBroker` fans out `impl_list_updated` to all connected clients; IMPL list refreshes automatically without page reload
- **fsnotify IMPL watcher** — `startIMPLWatcher` watches `IMPLDir` for file create/rename events; broadcasts `impl_list_updated` to keep sidebar in sync with CLI scout runs
- **`impl_list_updated` events** — also fired on approve, reject, and wave completion so status changes propagate instantly to the sidebar

---

## [0.18.0] - 2026-03-08

### Added

**Chat with Claude (v0.18.0-B)**
- **ChatPanel.tsx** — Fixed-position chat overlay in ReviewScreen; user messages right-aligned (blue), assistant messages left-aligned (gray), auto-scroll, Copy button on last assistant message
- **useChatWithClaude.ts** — Hook managing chat state: `sendMessage` (appends user turn, streams assistant chunks via SSE), `clearHistory`, running/error state
- **chat_handler.go** — `handleImplChat` (POST) launches a read-only Claude agent with IMPL doc context; `handleImplChatEvents` streams `chat_output`, `chat_complete`, `chat_failed` SSE events; run_id scoped per request
- **ReviewScreen wiring** — "Ask Claude" button in actions row opens ChatPanel overlay

**Per-Agent Context Payload (v0.18.0-K)**
- **AgentContextToggle.tsx** — Collapsible "View Agent Context" button per agent; fetches `context_text` from backend, renders in `<pre>` block with Copy button
- **AgentContextPanel.tsx** — Composes `AgentPromptsPanel` + one `AgentContextToggle` per agent prompt entry; wired into ReviewScreen `agent-prompts` slot

---

## [0.17.0] - 2026-03-08

### Added

**New review panels (v0.17.0-C)**
- **QualityGatesPanel** — Parses `[required]`/`[optional]` gate lines from IMPL doc text, renders a Command / Required? / Description table with badge column
- **NotSuitableResearchPanel** — Full research output for NOT SUITABLE verdicts: red verdict banner, rationale via MarkdownContent, numbered blockers callout, serial implementation notes (dep graph + interface contracts), Archive button
- **FileDiffPanel** — On-demand file diff viewer: fetches diff on mount, per-line syntax coloring (`+` green, `-` red, `@@` blue-gray), Back button
- **ContextViewerPanel** — Read/edit toggle for `docs/CONTEXT.md`: read mode shows `<pre>` block, edit mode is a full textarea with Save (calls `putContext`) and Close

**ReviewScreen integration (v0.17.0-D / v0.18.0-C)**
- `PanelKey` extended with `'quality-gates' | 'context-viewer'`
- NOT SUITABLE branch renders `NotSuitableResearchPanel` as primary content, hides panel toggles and ActionButtons
- `FileDiffPanel` takes over as full-screen when a file is clicked; `ContextViewerPanel` renders as fixed z-50 modal overlay
- "Ask Claude" button added to actions row (see v0.18.0)

**WaveBoard failure-type action buttons (v0.18.0-D)**
- Local `WaveMergeState`/`WaveTestState` stubs replaced with proper import from `useWaveEvents`
- Failure-type dispatch table: `transient` → "Retry", `fixable` → "Fix + Retry", `needs_replan` → "Re-Scout" (with optional `onRescout` prop), `timeout` → "Retry (scope down)", `escalate` → orange "Needs Manual Review" badge (no button)
- All retry paths preserve the `setStatusOverrides` optimistic update

**Scout context panel (v0.18.0-A)**
- `ScoutLauncher` gains a collapsible "Add context (optional)" section: file paths textarea, notes textarea, four predefined constraint checkboxes
- `contextData` (`ScoutContext`) passed as third argument to `runScout`; persisted in `sessionStorage`

**Settings screen (v0.18.0-G)**
- **SettingsScreen.tsx** — Four-section settings UI: Repo path, Agent model selects (scout/wave, three model options), Quality gates checkboxes, Appearance theme select; loads via `getConfig()`, saves via `saveConfig()`
- **App.tsx** — Gear icon in header opens SettingsScreen; replaces center-column content while open

**New backend handlers (v0.17.0-A, v0.17.0-C)**
- `diff_handler.go` — `GET /api/impl/{slug}/wave/{wave}/agent/{agent}/diff?file={file}`; uses `git diff main...{branch} -- {file}` with `HEAD~1...HEAD` fallback
- `worktree_handler.go` — `GET /api/worktrees` (list, filtered by SAW branch pattern), `DELETE /api/worktrees/{branch}` (409 on unmerged without force)
- `context_handler.go` — `GET/PUT /api/context`; reads/writes `docs/CONTEXT.md` with atomic rename
- `config_handler.go` — `GET/PUT /api/config`; reads/writes `saw-config.json`
- `agent_context_handler.go` — `GET /api/impl/{slug}/agent/{agent}/context`; uses `engine.ParseIMPLDoc` for structured extraction, raw markdown fallback

**New API types + routes**
- `types.go`: `WorktreeEntry`, `WorktreeListResponse`, `FileDiffResponse`, `SAWConfig` (+ `RepoConfig`, `AgentConfig`, `QualityConfig`, `AppearConfig`), `ChatRequest`, `ChatMessage`, `ChatRunResponse`, `AgentContextResponse`
- `server.go`: 11 new route registrations

**Frontend types + API client (v0.17.0-B)**
- `types.ts`: 8 new interfaces (`WorktreeEntry`, `WorktreeListResponse`, `FileDiffResponse`, `SAWConfig`, `ChatMessage`, `QualityGate`, `ScoutContext`, `AgentContextResponse`)
- `api.ts`: 11 new functions (`listWorktrees`, `deleteWorktree`, `fetchFileDiff`, `getConfig`, `saveConfig`, `getContext`, `putContext`, `startImplChat`, `subscribeChatEvents`, `rerunScaffold`, `fetchAgentContext`); `runScout` updated with optional `context?: ScoutContext` third parameter

---

## [0.16.0] - 2026-03-08

### Added

**Request Changes — inline IMPL editor with Claude revision**
- **RevisePanel** — "Request Changes" button opens a full revision panel replacing the review screen; "← Back" returns to review without changes
- **Ask Claude mode** — natural-language feedback field sends instructions to a Claude agent that reads and rewrites the IMPL doc in place; streams live output via SSE (`revise_output`, `revise_complete`, `revise_failed` events)
- **Manual edit mode** — raw markdown textarea with Save button for direct edits; atomic write via temp file + rename
- **Lock during revision** — manual edit textarea and Save button disabled while Claude is revising to prevent conflicts
- **Auto-reload** — ReviewScreen reloads the IMPL doc after Save or Claude revision completes

**Real-time Claude output streaming**
- **PTY + stream-json** — CLI backend now uses `--output-format stream-json` inside a PTY; Node.js line-buffers when connected to a terminal, enabling per-event streaming instead of batched end-of-run output
- **JSON fragment reassembly** — PTY set to 65535 columns; scanner accumulates wrapped JSON fragments until a complete object is parsed before processing
- **Rich event formatting** — `formatStreamEvent` converts stream-json events to human-readable lines: tool calls shown as `→ ToolName(arg)`, tool results indented and truncated at 400 chars, final event shown as `✓ complete`
- **1 MB scanner buffer** — handles large tool-result JSON lines without truncation

**Scout UX improvements**
- **Minimum description length** — Scout launcher requires at least 15 characters before enabling the Run button; error shown if keyboard shortcut bypasses the disabled state; prevents trivial/test inputs from launching full codebase scans
- **Completion banner** — scout_complete no longer auto-navigates; instead shows a "Plan ready → Review" green banner; user explicitly clicks to proceed after seeing output
- **Rotating status messages** — placeholder cycles through descriptive messages (Reading codebase, Mapping file ownership, etc.) while waiting for first output chunk

**Bug fixes**
- **NOT SUITABLE verdict parsing** — parser now handles `**Verdict: NOT SUITABLE**` (bold markdown) in addition to bare `Verdict:` lines; uses `strings.Contains` + `**` stripping
- **"Plan rejected" sticky banner** — `rejected` state now resets when selecting a different plan; was persisting across all plans in the sidebar
- **Scrollbar theme-aware** — scrollbar colors changed from hardcoded `rgb(134, 239, 172)` green to `hsl(var(--primary))`; scrollbar now follows the active theme (Gruvbox, Darcula, Catppuccin, Nord, default)
- **`useCallback` unused import** — removed unused `useCallback` import from ScoutLauncher.tsx that caused TypeScript build error

**New API endpoints**
- `POST /api/impl/{slug}/revise` — launches Claude revision agent, returns `run_id`
- `GET /api/impl/{slug}/revise/{runID}/events` — SSE stream for revision progress

---

## [0.15.0] - Unreleased

### Added

**GUI-driven protocol loop**
- **Scout launcher** — "New plan" button opens a full-screen launcher; type a feature description, click Run Scout, watch live output stream in; auto-navigates to review screen on completion
- **Back button** — Scout launcher has a "← Back" button to return to the review screen without completing a run
- **Wave gate** — `runWaveLoop` pauses between waves and publishes `wave_gate_pending` SSE event; WaveBoard shows a blue gate banner with "Proceed to Wave N+1" button
- **IMPL editor in gate banner** — when wave gate is pending, an inline IMPL doc editor appears in the banner; users can edit interface contracts before proceeding to the next wave
- **Re-run button** — failed agent cards show a "↺ Re-run" button that POSTs to the rerun endpoint and optimistically resets the agent to pending state
- **AgentCard output toggle** — "▼ Show more / ▲ Show less" toggle on agent output pane (shown when output > 200 chars); auto-scroll disabled when expanded

**New API endpoints**
- `POST /api/scout/run` — launches a Scout agent, returns `run_id`
- `GET /api/scout/{runID}/events` — SSE stream of scout output (`scout_output`, `scout_complete`, `scout_failed` events)
- `POST /api/wave/{slug}/gate/proceed` — unblocks the wave gate for a slug
- `POST /api/wave/{slug}/agent/{letter}/rerun` — stub endpoint for agent rerun (full implementation deferred)
- `GET /api/impl/{slug}/raw` — returns raw IMPL doc markdown as `text/plain`
- `PUT /api/impl/{slug}/raw` — atomically writes raw markdown to the IMPL doc on disk

**Bug fixes**
- **Completion report path fix** — orchestrator now polls the worktree copy of the IMPL doc (not the main repo copy) when waiting for agent completion reports; resolves the circular dependency that caused all wave runs to time out
- **`--cwd` flag removed** — CLI backend uses `cmd.Dir` instead of `--cwd` flag (removed in claude v2.x)
- **Nested Claude session** — stripped `CLAUDECODE` env var from agent subprocess so SAW works without an API key inside an existing Claude Code session

---

## [0.14.0] - Unreleased

### Added

**UI refinements**
- **Agent color coding** — consistent color scheme across all UI components: A=blue, B=green, C=orange, D=purple, E=pink, F=cyan, G=amber, H=violet, I=emerald, J=red, K=indigo; applied to agent cards (left border + header), dependency graph nodes, wave timeline badges
- **Sidebar dark mode background** — sidebar nav uses `#191919` background in dark mode for improved contrast
- **Double-click sidebar expand** — double-clicking the collapsed sidebar expands it
- **Sidebar width constraints** — sidebar capped at 10% screen width (down from 40%), minimum 140px; gives main content area up to 90% of screen width
- **Wider content layout** — ReviewScreen max width increased to 1600px (from 1152px) to prevent tab button wrapping
- **Conditional Pre-Mortem panel** — Pre-Mortem only auto-enabled if content exists
- **Default panel order** — panels open in order: Pre-Mortem (if exists), Wave Structure, Dependency Graph, File Ownership
- **Manual slug entry removed** — sidebar no longer includes manual slug input form
- **Wider scrollbar** — scrollbar width increased to 18px (from 14px) for better visibility

**E16 validator sub-rules (E16A/E16C)**
- **E16A: required block presence** — `ValidateIMPLDoc` now enforces that `impl-file-ownership`, `impl-dep-graph`, and `impl-wave-structure` blocks all appear when any typed block is present; fires only when `blockCount > 0` so pre-v0.10.0 docs are unaffected
- **E16C: out-of-band dep graph detection** — plain fenced blocks whose content matches `[A-Z]` agent refs and the word `Wave` produce a `warning`-type `ValidationError` (not an exit 1 error); prompts author to move the content into a typed `impl-dep-graph` block

**v0.10.0 protocol support**
- **Typed-block dispatch** — parser detects `` ```yaml type=impl-* `` fenced blocks as canonical section anchors; heading-based detection retained as fallback for pre-v0.10.0 docs
- **PreMortem parsing** — `ParseIMPLDoc` extracts `## Pre-Mortem` risk table into `IMPLDoc.PreMortem` (`*types.PreMortem`)
- **ScoutValidating state** — new `State` constant inserted between `ScoutPending` and `NotSuitable`; represents IMPL doc written, E16 validation in progress
- **E16 Go validator** — `protocol.ValidateIMPLDoc(path)` validates all typed blocks in an IMPL doc; returns `[]types.ValidationError` with block type, line number, and message; equivalent to `validate-impl.sh` reference implementation
- **New types** — `PreMortemRow`, `PreMortem`, `ValidationError` in `pkg/types/types.go`; `IMPLDoc.PreMortem *PreMortem` field

---

## [0.13.0] - 2026-03-07

### Added

**Multi-select toggle panel interface**
- **Toggle panels** — ReviewScreen refactored to use toggleable panel buttons; multiple panels can be active simultaneously and stack vertically
- **Overview always visible** — Overview panel displayed at top by default, no toggle button needed
- **Default panels** — Wave Structure and Dependency Graph pre-selected for immediate visibility

**Enhanced visualizations**
- **Timeline wave structure** — vertical timeline rail with typed nodes (filled dots for waves, hollow for orchestrator steps, ring for complete); merge lanes between waves showing branch count and gating
- **Subtle agent badges** — 10% opacity backgrounds with colored borders instead of solid fills (supports A-K agents), 48px to match DAG node size
- **SVG dependency DAG** — interactive directed acyclic graph with bezier curve edges, arrow markers, colored wave column backgrounds, and high-contrast inverted tooltips on hover
- **Custom scrollbar** — subtle green scrollbar (green-300 light, green-400 dark) for better immersion
- **Click-ordered panels** — toggled panels render in click order, not fixed order
- **Sticky toggle bar** — panel buttons pin to top on scroll with full-width backdrop blur and subtle tint; activates only when scrolled (IntersectionObserver)
- **Timeline status** — wave/merge/complete dots reflect IMPL doc_status: hollow when active, filled when complete
- **Astral jewel dots** — SVG timeline nodes with radial gradients, inner highlights, and outer glow filters replace flat CSS circles; jewels dim when pending, illuminate when complete

**Markdown rendering**
- **Full markdown in all panels** — shared `MarkdownContent` component renders proper markdown (headings, lists, bold, inline code) across Agent Prompts, Interface Contracts, Post-Merge Checklist, and Known Issues
- **Syntax-highlighted code blocks** — fenced code blocks render with language-specific highlighting (Go, TypeScript, Rust, etc.) via react-syntax-highlighter
- **Dark/light theme support** — VS Code Dark+/Light themes switch automatically
- **Realistic demo prompts** — Agent Prompts in demo IMPL fleshed out with full multi-paragraph instructions (role, files, requirements, verification)

**Parser extensions**
- **5 new IMPL sections** — ParseIMPLDoc extracts: Known Issues, Scaffolds detail, Interface Contracts, Dependency Graph, Post-Merge Checklist
- **New types** — KnownIssue and ScaffoldFile types in pkg/types/types.go
- **Test coverage** — 6 new parser tests (24/24 passing)

**API layer extensions**
- **6 new response fields** — known_issues, scaffolds_detail, interface_contracts_text, dependency_graph_text, post_merge_checklist_text, agent_prompts
- **3 new API types** — KnownIssueEntry, ScaffoldFileEntry, AgentPromptEntry with mapper functions

**TypeScript types**
- **Extended IMPLDocResponse** — 3 new interfaces in web/src/types.ts

**Demo content**
- **demo-complex IMPL** — complex 3-wave structure with 11 agents (A-K), scaffold step, rich dependencies for UI showcase

**Strategic planning**
- **ROADMAP.md** — documents SAW as provider-agnostic infrastructure; Phase 1 includes multi-provider backend, live agent observability, UI polish, demo/docs
- **Live Agent Observability (v0.14.0)** — roadmap entry for SSE-based real-time agent output, completion report streaming, git activity feed, and wave progress indicators

### Fixed

- **Dependency graph not parsing** — `parseKnownIssuesSection` skipped `---` separators instead of breaking, consuming the next section header from the scanner; downstream sections (Dependency Graph, Interface Contracts) were never reached
- **Dependency graph duplicate waves** — frontend parser matched summary lines like "Wave 2 dependencies:" as wave headers; now extracts only code-fenced content and uses stricter regex
- **Duplicate File Ownership header** — removed CardHeader from FileOwnershipPanel to avoid duplicate title

---

- **E15: IMPL doc completion lifecycle** — parser recognizes `<!-- SAW:COMPLETE YYYY-MM-DD -->` tag and populates `DocStatus`/`CompletedAt` on `IMPLDoc`
- **API: `doc_status` field** — `GET /api/impl/{slug}` returns `doc_status: "ACTIVE" | "COMPLETE"` and `completed_at`
- **API: rich list endpoint** — `GET /api/impl` returns `[{slug, doc_status}]` instead of bare strings; enables picker filtering without full parse
- **Web UI: active/complete picker grouping** — active IMPL docs appear first; completed docs grouped under a muted "Completed" divider

### Fixed

- **Wave structure diagram showing only 1 wave** — parser now regroups agents using file ownership table wave numbers when IMPL doc lacks `## Wave N` headers
- **Scaffold node missing from wave diagram** — API now detects scaffold files from file ownership table and sets `scaffold.required: true`
- **Scaffold rows sorted last in file ownership table** — Scaffold Agent now sorted first (before Wave 1), then by wave number, then by agent letter
- **Light mode file ownership table contrast** — row background colors darkened from `-50` to `-100` for better visibility
- **Cold-start audit findings (P0-P3)** — port mismatch in README (`:8080` → `localhost:7432`), prerequisites section, IMPL doc/jargon definitions, quickstart workflow, `--help` exit code, missing-flag usage hints, build-from-source docs, sample IMPL doc, protocol repo relationship, changelog version gap note

---

## [0.11.0] - 2026-03-07

### Added

**Backend interface abstraction (`pkg/agent/backend`)**
- `backend.Backend` interface in `pkg/agent/backend/backend.go` — single abstraction for all LLM execution paths
- `backend.Config` — backend-agnostic configuration (model, max tokens, max turns)
- API backend (`pkg/agent/backend/api/`) — extracts existing Anthropic SDK client into a `Backend` implementation; behavior identical to prior releases
- CLI backend (`pkg/agent/backend/cli/`) — shells out to `claude --print`; enables Claude Max plan users to run SAW without an API key
- Runner refactored to accept `backend.Backend`; `Sender`/`ToolRunner` split removed from the public surface

**`--backend` flag and `SAW_BACKEND` env var**
- `saw scout` and `saw scaffold` accept `--backend <api|cli|auto>`
- `SAW_BACKEND` env var provides a persistent default; flag takes precedence
- `auto` mode: selects API backend when `ANTHROPIC_API_KEY` is set, CLI backend otherwise

**Parser improvements**
- File ownership table 4th-column detection — parser reads the header row to determine whether the column is `Action` or `Depends On` and populates the correct field on `FileOwnershipInfo`
- Flexible agent header parsing: accepts both `###` and `####` heading levels, and both `:` and `—` as name separators
- Auto-wave creation from agent headers when an explicit wave section is absent
- `FileOwnershipInfo` enriched with `Agent`, `Wave`, `Action`, and `DependsOn` fields

## [0.10.0] - 2026-03-07

### Added

**SSE bridge**
- `OrchestratorEvent`, `EventPublisher`, and `SetEventPublisher` in `pkg/orchestrator/events.go` — event types emitted during wave execution with strongly-typed payloads (`AgentStartedPayload`, `AgentCompletePayload`, `AgentFailedPayload`, `WaveCompletePayload`, `RunCompletePayload`)
- API layer maps orchestrator events to SSE without the orchestrator importing `pkg/api`

**Wave start endpoint**
- `POST /api/wave/{slug}/start` — triggers wave execution for a reviewed IMPL doc
- Active-run guard via `sync.Map` prevents duplicate concurrent runs for the same slug

**Web UI — dark mode**
- `useDarkMode` hook — reads and persists preference to `localStorage`, applies `dark` class on `<html>`
- `DarkModeToggle` component — sun/moon button wired to the hook; all web components updated for dark-mode compatibility via Tailwind `dark:` variants

**Web UI — IMPL picker**
- Home screen lists available IMPL docs; users select from the picker instead of typing a slug manually

**Web UI — wave start wiring**
- `startWave` call added to `App.tsx` after the user approves an IMPL doc; the UI transitions to the `WaveBoard` live dashboard automatically

> **Note:** Versions 0.3.0–0.9.x were internal development iterations and not publicly released.

## [0.2.0] - 2026-03-07

### Added

**Web UI backend (`saw serve`)**
- `saw serve` — start a local HTTP server for reviewing IMPL docs and monitoring wave execution
- `pkg/api/server.go` — HTTP server with graceful shutdown, stdlib `net/http` only
- `pkg/api/impl.go` — `GET /api/impl/{slug}` returns parsed IMPL doc as structured JSON; `POST /api/impl/{slug}/approve` and `/reject` publish SSE events
- `pkg/api/wave.go` — SSE broker with per-slug pub/sub; `GET /api/wave/{slug}/events` streams agent status updates
- `pkg/api/types.go` — shared response types (`IMPLDocResponse`, `SSEEvent`, etc.)
- CLI flags: `--addr`, `--impl-dir`, `--repo`, `--no-browser`
- Auto-opens browser on macOS/Linux

**Web UI frontend (React + TypeScript + Tailwind)**
- `web/` — Vite-based React project with TypeScript and Tailwind CSS
- `ReviewScreen` — IMPL doc review with suitability badge, file ownership table, wave structure diagram, interface contracts display, and approve/reject action buttons
- `WaveBoard` — live wave execution dashboard with per-wave progress bars, agent cards showing status/files/errors, and scaffold status row
- `useWaveEvents` — SSE hook that subscribes to `/api/wave/{slug}/events` and maintains live agent/wave state
- `AgentCard` — color-coded status badges (pending/running/complete/failed) with file list and failure details
- `ProgressBar` — animated progress bar with label and percentage
- `web/embed.go` + `pkg/api/embed.go` — `go:embed` integration bakes `web/dist/` into the Go binary; single `saw` binary serves the React app
- `Makefile` — `make build` runs `npm run build` then `go build`; `make clean` removes artifacts

## [0.1.1] - 2026-03-06

### Added
- Binary releases for Linux, macOS, and Windows (amd64 + arm64) via GoReleaser
- GitHub Actions release workflow triggered on `v*` tags
- GitHub repository topics for discoverability
- Test coverage improved from 66.8% to 73.6%
- `go tool cover` coverage reporting in CI
- Godoc comments on all exported symbols for pkg.go.dev

### Changed
- GoReleaser config: version injected via ldflags (`-X main.version={{.Version}}`); archive includes version in filename; Windows uses `.zip`
- `saw --version` now reports the build-time version (not hardcoded `v0.1.0`)

## [0.1.0] - 2026-03-06

Initial release of the Go implementation of the Scout-and-Wave protocol.

### Added

**CLI (`saw`)**
- `saw wave` — execute all waves in an IMPL doc; `--wave N` to start from a specific wave; `--auto` to run all waves without prompts
- `saw merge` — standalone merge recovery subcommand (`--impl`, `--wave`)
- `saw scout` — launch a Scout agent to analyze the codebase and produce an IMPL doc
- `saw scaffold` — launch a Scaffold Agent to create shared type scaffold files
- `saw status` — print wave/agent completion status; `--json` for machine-readable output; `--missing` to list agents without completion reports
- `saw --version` / `saw --help`

**Orchestrator (`pkg/orchestrator`)**
- 10-state machine: `ScoutPending → Reviewed → ScaffoldPending → WavePending → WaveExecuting → WaveMerging → WaveVerified → Complete` (+ `NotSuitable`, `Blocked`)
- Concurrent agent launch via `errgroup` — all agents in a wave run in parallel
- `UpdateIMPLStatus` — ticks IMPL doc status checkboxes after wave completion
- Merge and post-merge verification via injected function seams (testable without git)

**Protocol (`pkg/protocol`)**
- IMPL doc parser: extracts feature name, waves, agents, test command, and metadata
- Completion report parser: reads YAML blocks from agent-named sections
- `UpdateIMPLStatus` / `UpdateIMPLStatusBytes`: ticks `[ ]` → `[x]` checkboxes for completed agents

**Agent (`pkg/agent`)**
- Anthropic API client with streaming support (`claude-opus-4-5`)
- `Runner.ExecuteWithTools` — agentic tool-use loop (up to N iterations)
- `StandardTools` — file read/write/list/search/shell tools scoped to a worktree path
- `WaitForCompletion` — polls IMPL doc for agent completion report with timeout

**Worktree (`pkg/worktree`)**
- `Manager.Create` — creates a `saw/wave{N}-agent-{X}` branch and worktree from HEAD
- `Manager.Remove` — removes worktree and deletes the branch

**Git (`internal/git`)**
- Wrappers for: `worktree add/remove`, `merge --no-ff`, `diff --name-only`, `rev-parse`, `merge --abort`
- Conflict detection from merge output

### Protocol compliance

Implements [SAW Protocol v0.8.0](https://github.com/blackwell-systems/scout-and-wave/tree/main/protocol) invariants I1–I6.
