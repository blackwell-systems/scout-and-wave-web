# Changelog

All notable changes to this project will be documented in this file.

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
