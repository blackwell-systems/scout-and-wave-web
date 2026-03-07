# Changelog

All notable changes to this project will be documented in this file.

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
