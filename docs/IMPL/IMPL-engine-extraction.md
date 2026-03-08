---
Repositories:
  - scout-and-wave-web: /Users/dayna.blackwell/code/scout-and-wave-web
  - scout-and-wave-go: /Users/dayna.blackwell/code/scout-and-wave-go
test_command: go test ./...
lint_command: go vet ./...
---

## Suitability Assessment

Verdict: SUITABLE

The engine extraction decomposes cleanly across two repos and multiple packages. File ownership
is disjoint: Wave 1 agents create foundation packages in `scout-and-wave-go` (types, git, protocol,
worktree, agent) independently; Wave 2 agents create the engine facade and rewire `scout-and-wave-web`
HTTP handlers. No single file is required by more than one agent at a time. All cross-agent interfaces
can be fully specified before implementation — the engine API is callback-based with concrete Go
signatures readable from the existing code. The `go build` + `go test ./...` cycle across two real Go
modules gives high parallelization value: Wave 1 has 5 independent agents, each owning 1–4 files.

Pre-implementation scan results:
- Total items: engine extraction from scratch (0% implemented in scout-and-wave-go)
- Already implemented: 0 items (scout-and-wave-go is an empty scaffold with one init commit)
- To-do: all items
- Agent adjustments: none — all agents proceed as planned

Estimated times:
- Scout phase: ~15 min (reading two repos, mapping DAG, writing IMPL doc)
- Agent execution: ~40 min (8 agents, Wave 1 runs 5 in parallel ~20 min; Wave 2 runs 3 in parallel ~20 min)
- Merge & verification: ~10 min
Total SAW time: ~65 min

Sequential baseline: ~8 agents × 20 min avg = ~160 min
Time savings: ~95 min (~60% faster)

Recommendation: Clear speedup. Proceed.

---

## Scaffolds

Two scaffold files hold types that cross agent boundaries in Wave 1. All five Wave 1 agents import
from these files, so they must exist before Wave 1 launches.

| File | Contents | Import path | Status |
|------|----------|-------------|--------|
| `pkg/types/types.go` (in scout-and-wave-go) | All protocol types: `State`, `CompletionStatus`, `IMPLDoc`, `FileOwnershipInfo`, `Wave`, `AgentSpec`, `CompletionReport`, `InterfaceDeviation`, `KnownIssue`, `ScaffoldFile`, `PreMortemRow`, `PreMortem`, `ValidationError` | `github.com/blackwell-systems/scout-and-wave-go/pkg/types` | committed (f69c694) |
| `pkg/engine/engine.go` (in scout-and-wave-go) | Engine interface + `Event` type + `RunScoutOpts`, `RunWaveOpts`, `RunMergeOpts` option structs | `github.com/blackwell-systems/scout-and-wave-go/pkg/engine` | committed (1c777fd) |
| `go.mod` (in scout-and-wave-go) | Go module definition | `github.com/blackwell-systems/scout-and-wave-go` | committed (a0b345f) |
| `go.sum` (in scout-and-wave-go) | Go module lock file | `github.com/blackwell-systems/scout-and-wave-go` | committed (a0b345f) |

The Scaffold Agent must also initialise the Go module in `scout-and-wave-go` with:
```
go mod init github.com/blackwell-systems/scout-and-wave-go
```
and add `go.sum` + `go.mod` with the same dependencies as `scout-and-wave-web`
(`gopkg.in/yaml.v3`, `golang.org/x/sync`, `github.com/anthropics/anthropic-sdk-go`,
`github.com/creack/pty`, tidwall family).

---

## Pre-Mortem

**Overall risk:** medium

**Failure modes:**

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| `go.mod` / `replace` directive misaligned between repos so Wave 2 agents cannot `go build` | high | high | Scaffold Agent creates both `go.mod` files and `replace` directive before Wave 1 launches; agents verify with `go build ./...` before committing |
| Agent A (types) and Scaffold Agent produce subtly different type definitions, causing compile errors in Wave 2 | medium | high | Scaffold Agent creates `pkg/types/types.go` verbatim from IMPL contracts; Agent A does NOT define any types, only copies the file from scaffold |
| Wave 1 agents import each other's packages before they are merged, causing build failures in isolated worktrees | low | medium | All Wave 1 packages must compile independently; engine.go scaffold provides stubs so no wave-1 agent depends on another's output |
| HTTP handler rewiring (Agent G) breaks existing API routes | medium | high | Agent G uses table-driven tests covering all 16 routes; integration verified with `go test ./pkg/api/...` |
| `replace` directive path is wrong on fresh clone / different machine | medium | medium | Agents use absolute path from IMPL frontmatter; orchestrator documents the path override clearly |
| Duplicate type definitions: agents in scout-and-wave-go re-define types already in scaffold | low | high | Explicit constraint in every agent prompt: "do not define types already in pkg/types; import from the scaffold" |
| Cross-repo merge ordering: merging scout-and-wave-go agents before scout-and-wave-web agents is non-obvious | low | medium | Wave Execution Loop spells out the merge sequence; orchestrator merges go-repo agents first, then web-repo agents, then updates replace directive |

---

## Known Issues

- `TestDoctorHelpIncludesFixNote` in `cmd/saw/` is a known hangs (tries to execute test binary as CLI). Skip with `-skip 'TestDoctorHelpIncludesFixNote'` if present.
- RESOLVED: `scout-and-wave-go` now has `go.mod` and `go.sum` (committed a0b345f). Wave 1 agents can proceed with builds.

---

## Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (5 parallel agents — foundation packages in scout-and-wave-go):
    [A] pkg/types/types.go  (scout-and-wave-go)
         Copy types verbatim from scaffold; add Go module-level doc comment.
         ✓ root (no inter-agent dependencies; uses only scaffold)

    [B] internal/git/commands.go  (scout-and-wave-go)
         Copy git CLI wrappers: Run, WorktreeAdd, WorktreeRemove, WorktreeList,
         MergeNoFF, DeleteBranch, RevParse, DiffNameOnly.
         ✓ root (stdlib only)

    [C] pkg/protocol/parser.go + pkg/protocol/updater.go + pkg/protocol/validator.go
         pkg/protocol/types.go  (scout-and-wave-go)
         Copy IMPL doc parser, completion report parser, updater, validator,
         ErrReportNotFound sentinel.
         depends on: [A] (imports pkg/types)

    [D] pkg/worktree/manager.go  (scout-and-wave-go)
         Copy worktree Manager: Create, Remove, CleanupAll, List,
         preCommitHookScript, installPreCommitHook.
         depends on: [B] (imports internal/git)

    [E] pkg/agent/runner.go + pkg/agent/completion.go + pkg/agent/stream.go
         pkg/agent/tools.go + pkg/agent/backend/ (all files)  (scout-and-wave-go)
         Copy agent Runner, WaitForCompletion, backend interface + API + CLI backends.
         depends on: [A] (imports pkg/types), [C] (imports pkg/protocol)

Wave 2 (3 parallel agents — engine facade + web-repo rewiring):
    [F] pkg/orchestrator/ (all files) + pkg/git/activity.go
         pkg/engine/runner.go  (scout-and-wave-go)
         Create the Orchestrator (copied from scout-and-wave-web/pkg/orchestrator/),
         pkg/git Poller, and implement the engine package functions:
         RunScout, StartWave, RunMerge, ApproveImpl.
         depends on: [A] [B] [C] [D] [E]

    [G] pkg/api/wave_runner.go + pkg/api/scout.go + pkg/api/impl_edit.go
         pkg/api/git_activity.go  (scout-and-wave-web)
         Rewire HTTP handlers to call through to engine module. Replace direct
         imports of pkg/orchestrator, pkg/agent, pkg/worktree etc. with
         github.com/blackwell-systems/scout-and-wave-go/pkg/engine calls.
         depends on: [F]

    [H] go.mod + go.sum  (scout-and-wave-web)
         Add require + replace directives for scout-and-wave-go.
         depends on: [F] (module must exist before require can be verified)

[Conflict note: Agent G touches pkg/api/*.go in scout-and-wave-web; Agent H touches
go.mod in scout-and-wave-web. These are disjoint files. No conflict.]

[Cascade candidates:]
  - cmd/saw/commands.go and cmd/saw/merge_cmd.go — IN SCOPE (Agent G). Rewired to use
    engine.RunScout, engine.RunSingleWave, engine.MergeWave, engine.RunVerification,
    engine.ParseIMPLDoc, engine.ParseCompletionReport in place of direct pkg/orchestrator,
    pkg/agent, pkg/protocol, pkg/types imports. After merge, the old packages
    (pkg/orchestrator, pkg/agent, pkg/protocol, pkg/worktree, internal/git, pkg/git,
    pkg/types) are deleted from scout-and-wave-web by the Orchestrator as a post-merge step.
```

---

## Interface Contracts

All signatures are exact Go. These are binding contracts for Wave 2 agents.

### Engine package (scout-and-wave-go/pkg/engine)

```go
package engine

import "context"

// Event is emitted during wave execution (mirrors orchestrator.OrchestratorEvent).
type Event struct {
    Event string      // e.g. "agent_started", "agent_complete", "run_complete"
    Data  interface{} // same payload structs as pkg/orchestrator
}

// RunScoutOpts configures a Scout agent run.
type RunScoutOpts struct {
    Feature     string // human feature description (required)
    RepoPath    string // absolute path to the repository being scouted (required)
    SAWRepoPath string // path to scout-and-wave protocol repo (optional; falls back to $SAW_REPO then ~/code/scout-and-wave)
    IMPLOutPath string // where to write the IMPL doc (required)
}

// RunWaveOpts configures a wave execution run.
type RunWaveOpts struct {
    IMPLPath string // absolute path to IMPL doc (required)
    RepoPath string // absolute path to the target repository (required)
    Slug     string // IMPL slug for event routing (required)
}

// RunMergeOpts configures a merge operation.
type RunMergeOpts struct {
    IMPLPath string
    RepoPath string
    WaveNum  int
}

// RunScout executes a Scout agent, calling onChunk for each output fragment.
// Returns when the agent finishes. Cancellable via ctx.
func RunScout(ctx context.Context, opts RunScoutOpts, onChunk func(string)) error

// StartWave executes a full wave run (all waves in the IMPL doc).
// Publishes lifecycle events via onEvent. Blocks until all waves complete
// or a fatal error occurs.
func StartWave(ctx context.Context, opts RunWaveOpts, onEvent func(Event)) error

// RunScaffold checks for pending scaffold files and runs a Scaffold agent if needed.
func RunScaffold(ctx context.Context, implPath, repoPath, sawRepoPath string, onEvent func(Event)) error

// ParseIMPLDoc parses an IMPL doc and returns the structured representation.
// Delegates to pkg/protocol.ParseIMPLDoc.
func ParseIMPLDoc(path string) (*types.IMPLDoc, error)

// ParseCompletionReport parses an agent's completion report from the IMPL doc.
// Delegates to pkg/protocol.ParseCompletionReport.
func ParseCompletionReport(implDocPath, agentLetter string) (*types.CompletionReport, error)

// UpdateIMPLStatus ticks status checkboxes for completed agents.
// Delegates to pkg/protocol.UpdateIMPLStatus.
func UpdateIMPLStatus(implDocPath string, completedLetters []string) error

// ValidateInvariants validates disjoint file ownership invariants.
// Delegates to pkg/protocol.ValidateInvariants.
func ValidateInvariants(doc *types.IMPLDoc) error

// RunSingleWave executes exactly one wave (waveNum) of the IMPL doc.
// Used by CLI to drive the wave loop with inter-wave prompts.
func RunSingleWave(ctx context.Context, opts RunWaveOpts, waveNum int, onEvent func(Event)) error

// RunMergeOpts configures a single-wave merge.
type RunMergeOpts struct {
    IMPLPath string
    RepoPath string
    WaveNum  int
}

// MergeWave merges all agent worktrees for the given wave number.
func MergeWave(ctx context.Context, opts RunMergeOpts) error

// RunVerificationOpts configures post-merge verification.
type RunVerificationOpts struct {
    RepoPath    string
    TestCommand string // falls back to "go test ./..." if empty
}

// RunVerification runs the test suite and returns an error if it fails.
func RunVerification(ctx context.Context, opts RunVerificationOpts) error
```

### pkg/orchestrator public surface (unchanged — stays in scout-and-wave-web for CLI)

The orchestrator in `scout-and-wave-web` is NOT removed in this wave. The CLI (`cmd/saw/`) and
the orchestrator package remain in `scout-and-wave-web`. Only `pkg/api/` HTTP handlers are rewired.

### Rewired pkg/api call pattern (Agent G)

Agent G replaces direct orchestrator/agent/worktree calls with engine calls:

```go
// Before (wave_runner.go):
orch, err := orchestrator.New(repoPath, implPath)

// After (wave_runner.go rewired):
err := engine.StartWave(ctx, engine.RunWaveOpts{
    IMPLPath: implPath,
    RepoPath: repoPath,
    Slug:     slug,
}, onEvent)
```

```go
// Before (scout.go):
b := cli.New("", backend.Config{})
runner := agent.NewRunner(b, nil)
_, execErr := runner.ExecuteStreaming(ctx, spec, repoRoot, onChunk)

// After (scout.go rewired):
err := engine.RunScout(ctx, engine.RunScoutOpts{
    Feature:     feature,
    RepoPath:    repoRoot,
    SAWRepoPath: sawRepo,
    IMPLOutPath: implOut,
}, onChunk)
```

---

## File Ownership

```yaml type=impl-file-ownership
| File | Repo | Agent | Wave | Depends On |
|------|------|-------|------|------------|
| go.mod | scout-and-wave-go | Scaffold | 0 | — |
| go.sum | scout-and-wave-go | Scaffold | 0 | — |
| pkg/types/types.go | scout-and-wave-go | A | 1 | Scaffold |
| internal/git/commands.go | scout-and-wave-go | B | 1 | — |
| pkg/protocol/parser.go | scout-and-wave-go | C | 1 | A |
| pkg/protocol/updater.go | scout-and-wave-go | C | 1 | A |
| pkg/protocol/validator.go | scout-and-wave-go | C | 1 | A |
| pkg/protocol/types.go | scout-and-wave-go | C | 1 | A |
| pkg/worktree/manager.go | scout-and-wave-go | D | 1 | B |
| pkg/agent/backend/backend.go | scout-and-wave-go | E | 1 | A |
| pkg/agent/backend/api/client.go | scout-and-wave-go | E | 1 | A |
| pkg/agent/backend/cli/client.go | scout-and-wave-go | E | 1 | A |
| pkg/agent/runner.go | scout-and-wave-go | E | 1 | A, C |
| pkg/agent/completion.go | scout-and-wave-go | E | 1 | A, C |
| pkg/agent/stream.go | scout-and-wave-go | E | 1 | A |
| pkg/agent/tools.go | scout-and-wave-go | E | 1 | A |
| pkg/orchestrator/orchestrator.go | scout-and-wave-go | F | 2 | A, B, C, D, E |
| pkg/orchestrator/events.go | scout-and-wave-go | F | 2 | A |
| pkg/orchestrator/merge.go | scout-and-wave-go | F | 2 | A, B, C |
| pkg/orchestrator/verification.go | scout-and-wave-go | F | 2 | A |
| pkg/orchestrator/transitions.go | scout-and-wave-go | F | 2 | A |
| pkg/orchestrator/state.go | scout-and-wave-go | F | 2 | A |
| pkg/orchestrator/setters.go | scout-and-wave-go | F | 2 | A |
| pkg/git/activity.go | scout-and-wave-go | F | 2 | B |
| pkg/engine/runner.go | scout-and-wave-go | F | 2 | A, B, C, D, E |
| pkg/api/wave_runner.go | scout-and-wave-web | G | 2 | F |
| pkg/api/scout.go | scout-and-wave-web | G | 2 | F |
| pkg/api/impl_edit.go | scout-and-wave-web | G | 2 | F |
| pkg/api/git_activity.go | scout-and-wave-web | G | 2 | F |
| cmd/saw/commands.go | scout-and-wave-web | G | 2 | F |
| cmd/saw/merge_cmd.go | scout-and-wave-web | G | 2 | F |
| go.mod | scout-and-wave-web | H | 2 | F |
| go.sum | scout-and-wave-web | H | 2 | F |
```

---

## Wave Structure

```yaml type=impl-wave-structure
Scaffold: [Scaffold]       <- creates go.mod, go.sum, pkg/types/types.go, pkg/engine/engine.go in scout-and-wave-go
           |
Wave 1:  [A] [B] [C] [D] [E]    <- 5 parallel agents in scout-and-wave-go (foundation packages)
           | (A+B+C+D+E complete)
Wave 2:   [F] [G] [H]           <- 3 parallel agents: F in scout-and-wave-go, G+H in scout-and-wave-web
```

---

## Scaffold Phase

**Prerequisites:** The Scaffold Agent must run before Wave 1 launches.

The Scaffold Agent works in `/Users/dayna.blackwell/code/scout-and-wave-go` on the `main` branch (not a worktree — there is only one commit in the repo).

Tasks:
1. Run `go mod init github.com/blackwell-systems/scout-and-wave-go` (if `go.mod` does not already exist).
2. Add required dependencies matching `scout-and-wave-web/go.mod`:
   - `github.com/anthropics/anthropic-sdk-go v1.26.0`
   - `golang.org/x/sync v0.16.0`
   - `gopkg.in/yaml.v3 v3.0.1`
   - `github.com/creack/pty v1.1.24`
   - tidwall family (gjson, match, pretty, sjson)
   Run `go mod tidy` to generate `go.sum`.
3. Create `pkg/types/types.go` — exact copy of `scout-and-wave-web/pkg/types/types.go` with package declaration `package types` and module path updated.
4. Create `pkg/engine/engine.go` with the interface contracts from the Interface Contracts section above (the `engine` package public API + option structs). Function bodies may be stubs (`return nil`) — Agent F implements them.
5. Commit: `git commit -m "scaffold: go module init, types + engine interface stubs"`

---

## Wave 1

Wave 1 copies foundation packages from `scout-and-wave-web` into `scout-and-wave-go`. All five agents work independently in worktrees of `scout-and-wave-go`. They do NOT modify `scout-and-wave-web`.

### Agent A - Copy pkg/types

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
BRANCH: wave1-agent-A
REPO: scout-and-wave-go

Navigate to the worktree:
  cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A

Verify you are on the correct branch:
  git branch --show-current   # must print: wave1-agent-A

Verify the scaffold files exist:
  ls pkg/types/types.go       # must exist (created by Scaffold Agent)
  ls go.mod                   # must exist

If any check fails, STOP and report status: blocked.
```

**Field 1 — File ownership**

You own exclusively:
- `pkg/types/types.go` (in `scout-and-wave-go` worktree)

You must NOT touch any file in `scout-and-wave-web`.

**Field 2 — Interfaces to implement**

Verify and finalise `pkg/types/types.go`. The scaffold created a copy; your job is to:
- Confirm all types from `scout-and-wave-web/pkg/types/types.go` are present
- Add any missing types
- Ensure the package doc comment is accurate
- The file must compile standalone: `go build ./pkg/types/`

No new types. No modifications beyond what was seeded by the Scaffold Agent.

**Field 3 — Interfaces to call**

None. This package is stdlib-only. No imports outside the standard library.

**Field 4 — What to implement**

1. Read `/Users/dayna.blackwell/code/scout-and-wave-web/pkg/types/types.go` in full.
2. Compare it with the scaffold copy at `pkg/types/types.go` in your worktree.
3. Add any missing types. Fix any discrepancies.
4. Write the final file. Package declaration must be `package types`.
5. The file must not import `scout-and-wave-web` — it is self-contained.

**Field 5 — Tests to write**

Create `pkg/types/types_test.go` with:
- `TestStateString` — verify `State.String()` returns correct strings for all 11 states
- `TestCompletionStatusConstants` — verify `StatusComplete`, `StatusPartial`, `StatusBlocked` string values

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
go build ./pkg/types/
go vet ./pkg/types/
go test ./pkg/types/ -run "TestState|TestCompletion" -v
```

All three commands must exit 0 before committing.

**Field 7 — Constraints**

- Do NOT import `scout-and-wave-web` or any non-stdlib package.
- Do NOT define any engine API types here (those live in `pkg/engine/`).
- Do NOT modify `go.mod` or `go.sum` — those are owned by the Scaffold Agent.
- Keep the package path `github.com/blackwell-systems/scout-and-wave-go/pkg/types`.

**Field 8 — Completion report**

After committing your work, append the following YAML block to the IMPL doc at:
`/Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A/docs/IMPL/IMPL-engine-extraction.md`

(Create `docs/IMPL/` directory if it does not exist in the worktree.)

```yaml
## Agent A Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: <git rev-parse HEAD>
files_changed: []
files_created:
  - pkg/types/types.go
  - pkg/types/types_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestStateString
  - TestCompletionStatusConstants
verification: "go build ./pkg/types/ && go vet ./pkg/types/ && go test ./pkg/types/ — all pass"
```
```

---

### Agent B - Copy internal/git

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B
BRANCH: wave1-agent-B
REPO: scout-and-wave-go

Navigate to the worktree:
  cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B

Verify you are on the correct branch:
  git branch --show-current   # must print: wave1-agent-B

Verify go.mod exists:
  cat go.mod | head -3        # must show: module github.com/blackwell-systems/scout-and-wave-go

If any check fails, STOP and report status: blocked.
```

**Field 1 — File ownership**

You own exclusively:
- `internal/git/commands.go` (in `scout-and-wave-go` worktree)

You must NOT touch any file in `scout-and-wave-web`.

**Field 2 — Interfaces to implement**

Exact function signatures (all must be present and correct):

```go
package git

func Run(repoPath string, args ...string) (string, error)
func WorktreeAdd(repoPath, path, branch string) error
func WorktreeRemove(repoPath, path string) error
func WorktreeList(repoPath string) ([][2]string, error)
func MergeNoFF(repoPath, branch, message string) error
func DeleteBranch(repoPath, branch string) error
func RevParse(repoPath, ref string) (string, error)
func DiffNameOnly(repoPath, fromRef, toRef string) ([]string, error)
```

**Field 3 — Interfaces to call**

None. This package uses only `os/exec` and `strings` from stdlib.

**Field 4 — What to implement**

1. Read `/Users/dayna.blackwell/code/scout-and-wave-web/internal/git/commands.go`.
2. Create `internal/git/commands.go` in your worktree with an identical implementation.
3. Update the package doc comment to reference `scout-and-wave-go`.
4. No logic changes — this is a verbatim copy with updated module path references.

**Field 5 — Tests to write**

Create `internal/git/commands_test.go` with:
- `TestRunInvalidDir` — verify `Run` with a non-existent directory returns an error
- `TestRevParseHEAD` — in a temp git repo, verify `RevParse` returns a 40-char SHA

Use `t.TempDir()` + `exec.Command("git", "init", ...)` to create throwaway repos.

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B
go build ./internal/git/
go vet ./internal/git/
go test ./internal/git/ -run "TestRun|TestRevParse" -v -timeout 60s
```

**Field 7 — Constraints**

- Do NOT import `scout-and-wave-web` or any non-stdlib package.
- Do NOT modify `go.mod`.
- Keep package path `github.com/blackwell-systems/scout-and-wave-go/internal/git`.

**Field 8 — Completion report**

```yaml
## Agent B Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: <git rev-parse HEAD>
files_changed: []
files_created:
  - internal/git/commands.go
  - internal/git/commands_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestRunInvalidDir
  - TestRevParseHEAD
verification: "go build + go vet + go test — all pass"
```
```

---

### Agent C - Copy pkg/protocol

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-C
BRANCH: wave1-agent-C
REPO: scout-and-wave-go

Navigate to the worktree:
  cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-C

Verify branch:
  git branch --show-current   # must print: wave1-agent-C

Verify scaffold types exist:
  ls pkg/types/types.go       # must exist

If any check fails, STOP and report status: blocked.
```

**Field 1 — File ownership**

You own exclusively (all in `scout-and-wave-go` worktree):
- `pkg/protocol/parser.go`
- `pkg/protocol/updater.go`
- `pkg/protocol/validator.go`
- `pkg/protocol/types.go`

You must NOT touch `pkg/types/` (owned by Agent A) or any file in `scout-and-wave-web`.

**Field 2 — Interfaces to implement**

```go
package protocol

import "github.com/blackwell-systems/scout-and-wave-go/pkg/types"

var ErrReportNotFound = errors.New("completion report not found")

func ParseIMPLDoc(path string) (*types.IMPLDoc, error)
func ParseCompletionReport(implDocPath, agentLetter string) (*types.CompletionReport, error)
func UpdateIMPLStatus(implDocPath string, completedLetters []string) error
func ValidateInvariants(doc *types.IMPLDoc) error
```

**Field 3 — Interfaces to call**

- `github.com/blackwell-systems/scout-and-wave-go/pkg/types` — all protocol types
- `gopkg.in/yaml.v3` — for YAML parsing in completion reports

**Field 4 — What to implement**

1. Read all four source files from `scout-and-wave-web/pkg/protocol/`:
   - `parser.go`, `updater.go`, `validator.go`, `types.go`
2. Copy each into the corresponding path in your worktree.
3. Replace every import of `github.com/blackwell-systems/scout-and-wave-web/pkg/types`
   with `github.com/blackwell-systems/scout-and-wave-go/pkg/types`.
4. No logic changes.

**Field 5 — Tests to write**

Create `pkg/protocol/parser_test.go` with a minimal round-trip test:
- `TestParseIMPLDocMinimal` — write a temp IMPL doc with a Wave 1 header and one agent, parse it, verify wave count = 1 and agent letter = "A"
- `TestParseCompletionReportNotFound` — verify `ErrReportNotFound` is returned for a doc with no completion report

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-C
go build ./pkg/protocol/
go vet ./pkg/protocol/
go test ./pkg/protocol/ -run "TestParseIMPL|TestParseCompletion" -v -timeout 60s
```

**Field 7 — Constraints**

- Import from `scout-and-wave-go/pkg/types`, NOT from `scout-and-wave-web`.
- Do NOT modify `go.mod`.
- Do NOT create a `pkg/types/` directory in your worktree — use the scaffold-created one.

**Field 8 — Completion report**

```yaml
## Agent C Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-C
branch: wave1-agent-C
commit: <git rev-parse HEAD>
files_changed: []
files_created:
  - pkg/protocol/parser.go
  - pkg/protocol/updater.go
  - pkg/protocol/validator.go
  - pkg/protocol/types.go
  - pkg/protocol/parser_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestParseIMPLDocMinimal
  - TestParseCompletionReportNotFound
verification: "go build + go vet + go test — all pass"
```
```

---

### Agent D - Copy pkg/worktree

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-D
BRANCH: wave1-agent-D
REPO: scout-and-wave-go

cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-D
git branch --show-current   # must print: wave1-agent-D
ls internal/git/commands.go 2>/dev/null || echo "WARNING: git package not yet in scaffold"
# Note: internal/git is owned by Agent B and will be present in the scaffold.
# The scaffold created go.mod; internal/git/commands.go is created by Agent B
# in a parallel worktree. Your worktree branches from the scaffold commit, so
# internal/git/commands.go may NOT be present yet in your worktree. That is
# expected — see Field 7 constraints.
ls go.mod   # must exist
```

**Field 1 — File ownership**

You own exclusively (in `scout-and-wave-go` worktree):
- `pkg/worktree/manager.go`

**Field 2 — Interfaces to implement**

```go
package worktree

import "github.com/blackwell-systems/scout-and-wave-go/internal/git"

type Manager struct { /* unexported fields */ }

func New(repoPath string) *Manager
func (m *Manager) Create(wave int, agent string) (string, error)
func (m *Manager) Remove(path string) error
func (m *Manager) CleanupAll() error
func (m *Manager) List() []string
```

**Field 3 — Interfaces to call**

- `github.com/blackwell-systems/scout-and-wave-go/internal/git` — `WorktreeAdd`, `WorktreeRemove`, `DeleteBranch`

**Field 4 — What to implement**

1. Read `/Users/dayna.blackwell/code/scout-and-wave-web/pkg/worktree/manager.go`.
2. Create `pkg/worktree/manager.go` with identical logic.
3. Replace `scout-and-wave-web/internal/git` imports with `scout-and-wave-go/internal/git`.

IMPORTANT BUILD NOTE: Because Agent B's `internal/git` package is in a parallel worktree
and not yet merged to `main`, your isolated worktree will NOT have `internal/git/commands.go`.
To verify `go build` passes in isolation, create a minimal stub file:

```
internal/git/commands.go  — stub with just package declaration + empty function signatures
```

Add a comment `// BUILD STUB — replaced by Agent B merge`. This file will be overwritten
when Agent B is merged. Do NOT commit this stub as a real implementation.

Alternatively, if the orchestrator has already merged Agent B before launching Agent D,
the real file will be present and you do not need a stub.

**Field 5 — Tests to write**

Create `pkg/worktree/manager_test.go` with:
- `TestManagerNew` — verify `New` returns a non-nil Manager
- `TestManagerCreateRemoveRoundtrip` — in a temp git repo, create a worktree and remove it

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-D
go build ./pkg/worktree/
go vet ./pkg/worktree/
go test ./pkg/worktree/ -run "TestManager" -v -timeout 60s
```

**Field 7 — Constraints**

- Do NOT modify Agent B's stub file with real logic — leave the stub comment intact.
- Do NOT modify `go.mod`.
- Do NOT create real git operations in tests without `t.TempDir()` isolation.

**Field 8 — Completion report**

```yaml
## Agent D Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-D
branch: wave1-agent-D
commit: <git rev-parse HEAD>
files_changed: []
files_created:
  - pkg/worktree/manager.go
  - pkg/worktree/manager_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestManagerNew
  - TestManagerCreateRemoveRoundtrip
verification: "go build + go vet + go test — all pass"
```
```

---

### Agent E - Copy pkg/agent + pkg/agent/backend

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-E
BRANCH: wave1-agent-E
REPO: scout-and-wave-go

cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-E
git branch --show-current   # must print: wave1-agent-E
ls pkg/types/types.go       # must exist (from scaffold)
ls go.mod                   # must exist
```

**Field 1 — File ownership**

You own exclusively (in `scout-and-wave-go` worktree):
- `pkg/agent/backend/backend.go`
- `pkg/agent/backend/api/client.go`
- `pkg/agent/backend/cli/client.go`
- `pkg/agent/runner.go`
- `pkg/agent/completion.go`
- `pkg/agent/stream.go`
- `pkg/agent/tools.go`

**Field 2 — Interfaces to implement**

```go
// pkg/agent/backend/backend.go
package backend

type Config struct {
    Model     string
    MaxTokens int
    MaxTurns  int
}

type ChunkCallback func(chunk string)

type Backend interface {
    Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
    RunStreaming(ctx context.Context, systemPrompt, userMessage, workDir string, onChunk ChunkCallback) (string, error)
}

// pkg/agent/runner.go
package agent

type Runner struct { /* unexported */ }

func NewRunner(b backend.Backend, worktrees *worktree.Manager) *Runner
func (r *Runner) Execute(ctx context.Context, agentSpec *types.AgentSpec, worktreePath string) (string, error)
func (r *Runner) ExecuteStreaming(ctx context.Context, agentSpec *types.AgentSpec, worktreePath string, onChunk backend.ChunkCallback) (string, error)
func (r *Runner) ParseCompletionReport(implDocPath string, agentLetter string) (*types.CompletionReport, error)

// pkg/agent/completion.go
package agent

func WaitForCompletion(implDocPath, agentLetter string, timeout, pollInterval time.Duration) (*types.CompletionReport, error)
```

**Field 3 — Interfaces to call**

- `github.com/blackwell-systems/scout-and-wave-go/pkg/types`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/protocol` (for `ParseCompletionReport`, `ErrReportNotFound`)
- `github.com/blackwell-systems/scout-and-wave-go/pkg/worktree` (for `*worktree.Manager`)
- `github.com/anthropics/anthropic-sdk-go` (for API backend)
- `github.com/creack/pty` (for CLI backend)

**Field 4 — What to implement**

Source files to copy (from `scout-and-wave-web`):
1. `pkg/agent/backend/backend.go` → from `pkg/agent/backend/backend.go`
2. `pkg/agent/backend/api/` → from `pkg/agent/backend/api/` (all files)
3. `pkg/agent/backend/cli/` → from `pkg/agent/backend/cli/` (all files)
4. `pkg/agent/runner.go` → from `pkg/agent/runner.go`
5. `pkg/agent/completion.go` → from `pkg/agent/completion.go`
6. `pkg/agent/stream.go` → from `pkg/agent/stream.go`
7. `pkg/agent/tools.go` → from `pkg/agent/tools.go`

Replace all `scout-and-wave-web` module path prefixes with `scout-and-wave-go`.

IMPORTANT: The `runner.go` imports `pkg/worktree` (owned by Agent D) and `pkg/protocol`
(owned by Agent C). Both are in parallel worktrees. If they are not yet present, create
minimal stub files for each with empty function bodies. Mark stubs clearly with `// BUILD STUB`.

**Field 5 — Tests to write**

Create `pkg/agent/runner_test.go` with:
- `TestNewRunner` — verify `NewRunner` returns non-nil
- `TestWaitForCompletionTimeout` — verify timeout returns error when IMPL doc has no report

Create `pkg/agent/client_test.go` with:
- `TestBackendConfigDefaults` — verify zero-value Config is acceptable

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-E
go build ./pkg/agent/...
go vet ./pkg/agent/...
go test ./pkg/agent/ -run "TestNewRunner|TestWaitForCompletion|TestBackend" -v -timeout 60s
```

**Field 7 — Constraints**

- Do NOT copy test files from the source that exercise real API/CLI calls without mocking.
- Do NOT modify `go.mod` (dependencies already added by Scaffold Agent).
- All stub files must be clearly marked `// BUILD STUB`.

**Field 8 — Completion report**

```yaml
## Agent E Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-E
branch: wave1-agent-E
commit: <git rev-parse HEAD>
files_changed: []
files_created:
  - pkg/agent/backend/backend.go
  - pkg/agent/backend/api/client.go
  - pkg/agent/backend/cli/client.go
  - pkg/agent/runner.go
  - pkg/agent/completion.go
  - pkg/agent/stream.go
  - pkg/agent/tools.go
  - pkg/agent/runner_test.go
  - pkg/agent/client_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestNewRunner
  - TestWaitForCompletionTimeout
  - TestBackendConfigDefaults
verification: "go build + go vet + go test — all pass"
```
```

---

## Wave 2

Wave 2 begins after all Wave 1 agents (A, B, C, D, E) have been merged into `main` of
`scout-and-wave-go`. Three agents run in parallel: Agent F builds the engine facade and
orchestrator in `scout-and-wave-go`; Agents G and H rewire `scout-and-wave-web`.

### Agent F - Build engine facade + orchestrator (scout-and-wave-go)

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-F
BRANCH: wave2-agent-F
REPO: scout-and-wave-go

cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-F
git branch --show-current     # must print: wave2-agent-F

Verify all Wave 1 packages are present (merged):
  ls pkg/types/types.go       # Agent A
  ls internal/git/commands.go # Agent B
  ls pkg/protocol/parser.go   # Agent C
  ls pkg/worktree/manager.go  # Agent D
  ls pkg/agent/runner.go      # Agent E

If any file is missing, STOP and report status: blocked — Wave 1 merge incomplete.
```

**Field 1 — File ownership**

You own exclusively (all in `scout-and-wave-go` worktree):
- `pkg/orchestrator/orchestrator.go`
- `pkg/orchestrator/events.go`
- `pkg/orchestrator/merge.go`
- `pkg/orchestrator/verification.go`
- `pkg/orchestrator/transitions.go`
- `pkg/orchestrator/state.go`
- `pkg/orchestrator/setters.go`
- `pkg/git/activity.go`
- `pkg/engine/runner.go`

**Field 2 — Interfaces to implement**

The engine package functions (bodies, not just stubs):

```go
// pkg/engine/runner.go
package engine

func RunScout(ctx context.Context, opts RunScoutOpts, onChunk func(string)) error
func StartWave(ctx context.Context, opts RunWaveOpts, onEvent func(Event)) error
func RunScaffold(ctx context.Context, implPath, repoPath, sawRepoPath string, onEvent func(Event)) error
func ParseIMPLDoc(path string) (*types.IMPLDoc, error)
func ParseCompletionReport(implDocPath, agentLetter string) (*types.CompletionReport, error)
func UpdateIMPLStatus(implDocPath string, completedLetters []string) error
func ValidateInvariants(doc *types.IMPLDoc) error
```

The orchestrator package (identical to `scout-and-wave-web/pkg/orchestrator/` with import paths updated):

```go
// pkg/orchestrator/orchestrator.go
package orchestrator

func New(repoPath string, implDocPath string) (*Orchestrator, error)
func (o *Orchestrator) RunWave(waveNum int) error
func (o *Orchestrator) MergeWave(waveNum int) error
func (o *Orchestrator) RunVerification(testCommand string) error
func (o *Orchestrator) UpdateIMPLStatus(waveNum int) error
func (o *Orchestrator) IMPLDoc() *types.IMPLDoc
func (o *Orchestrator) SetEventPublisher(pub EventPublisher)
func (o *Orchestrator) TransitionTo(newState types.State) error
func SetParseIMPLDocFunc(f func(path string) (*types.IMPLDoc, error))
func SetValidateInvariantsFunc(f func(doc *types.IMPLDoc) error)
```

**Field 3 — Interfaces to call**

- `github.com/blackwell-systems/scout-and-wave-go/pkg/types`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/protocol`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/worktree`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/agent`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend/api`
- `github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend/cli`
- `github.com/blackwell-systems/scout-and-wave-go/internal/git`

**Field 4 — What to implement**

**Step 1: Copy orchestrator package**
Read all files in `/Users/dayna.blackwell/code/scout-and-wave-web/pkg/orchestrator/`.
Create each file in `pkg/orchestrator/` in your worktree.
Replace all `scout-and-wave-web` import prefixes with `scout-and-wave-go`.

**Step 2: Wire protocol functions**
In `pkg/orchestrator/orchestrator.go`, add an `init()` that wires:
```go
func init() {
    SetParseIMPLDocFunc(protocol.ParseIMPLDoc)
    SetValidateInvariantsFunc(protocol.ValidateInvariants)
}
```

**Step 3: Copy pkg/git/activity.go**
Read `/Users/dayna.blackwell/code/scout-and-wave-web/pkg/git/activity.go`.
Create `pkg/git/activity.go` in your worktree.
Replace import of `internal/git` with `scout-and-wave-go/internal/git`.

**Step 4: Implement engine/runner.go**
The scaffold created `pkg/engine/engine.go` with stub bodies. Create `pkg/engine/runner.go`
with the real implementations:

- `RunScout`: construct a CLI backend, an agent.Runner, build a scout prompt from the
  scout.md file at `sawRepoPath/implementations/claude-code/prompts/scout.md` (with fallback inline prompt),
  call `runner.ExecuteStreaming`.

- `StartWave`: create an `orchestrator.New(opts.RepoPath, opts.IMPLPath)`, wire
  `SetEventPublisher` mapping `OrchestratorEvent → Event`, call `RunScaffold` first,
  then loop through waves calling `RunWave → MergeWave → RunVerification → UpdateIMPLStatus`.

- `RunScaffold`: copy logic from `runScaffoldIfNeeded` in `scout-and-wave-web/pkg/api/wave_runner.go`.

- `ParseIMPLDoc`, `ParseCompletionReport`, `UpdateIMPLStatus`, `ValidateInvariants`: thin
  delegates to `pkg/protocol`.

**Field 5 — Tests to write**

Create `pkg/engine/runner_test.go` with:
- `TestRunScoutMissingFeature` — verify error when `opts.Feature == ""`
- `TestStartWaveEmptyIMPL` — verify error when IMPL path does not exist
- `TestParseIMPLDocDelegate` — write a minimal IMPL doc, verify `ParseIMPLDoc` returns non-nil

Create `pkg/orchestrator/orchestrator_test.go` (port from `scout-and-wave-web`):
- `TestOrchestratorNew` — verify New returns valid orchestrator
- `TestRunWaveNilDoc` — verify error when no waves are defined

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-F
go build ./...
go vet ./...
go test ./pkg/engine/ -run "TestRun|TestParse|TestStart" -v -timeout 120s
go test ./pkg/orchestrator/ -run "TestOrchestrator|TestRunWave" -v -timeout 120s
go test ./pkg/git/ -v -timeout 60s
```

**Field 7 — Constraints**

- Do NOT modify `go.mod` in `scout-and-wave-go` — the Scaffold Agent and Agent H own module files.
- Do NOT touch any file in `scout-and-wave-web`.
- The `pkg/engine/engine.go` file (created by Scaffold Agent with stubs) should be updated
  to remove stub bodies and delegate to `runner.go`. Alternatively, implement all functions
  in `runner.go` and leave `engine.go` as the interface/types-only file.

**Field 8 — Completion report**

```yaml
## Agent F Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-F
branch: wave2-agent-F
commit: <git rev-parse HEAD>
files_changed:
  - pkg/engine/engine.go
files_created:
  - pkg/orchestrator/orchestrator.go
  - pkg/orchestrator/events.go
  - pkg/orchestrator/merge.go
  - pkg/orchestrator/verification.go
  - pkg/orchestrator/transitions.go
  - pkg/orchestrator/state.go
  - pkg/orchestrator/setters.go
  - pkg/git/activity.go
  - pkg/engine/runner.go
  - pkg/engine/runner_test.go
  - pkg/orchestrator/orchestrator_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestRunScoutMissingFeature
  - TestStartWaveEmptyIMPL
  - TestParseIMPLDocDelegate
  - TestOrchestratorNew
  - TestRunWaveNilDoc
verification: "go build ./... && go vet ./... && go test ./pkg/engine/ && go test ./pkg/orchestrator/ — all pass"
```
```

---

### Agent G - Rewire pkg/api HTTP handlers + cmd/saw CLI (scout-and-wave-web)

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-G
BRANCH: wave2-agent-G
REPO: scout-and-wave-web

cd /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-G
git branch --show-current     # must print: wave2-agent-G

Verify go.mod has the engine require (added by Agent H in parallel worktree):
  grep "scout-and-wave-go" go.mod 2>/dev/null || echo "NOTE: go.mod not yet updated (Agent H is parallel)"

IMPORTANT: Agent H is updating go.mod in a parallel worktree. Your worktree branches from
the same base commit as Agent H. You will see the OLD go.mod (without the engine require).
To compile against the engine package, you have two options:
  OPTION A (preferred): Add a temporary local replace directive to go.mod in your worktree:
    go mod edit -replace github.com/blackwell-systems/scout-and-wave-go=/Users/dayna.blackwell/code/scout-and-wave-go
    go get github.com/blackwell-systems/scout-and-wave-go@v0.0.0
  OPTION B: Write the handler code without compiling (stubs that will compile once H is merged).
Use OPTION A. It works because scout-and-wave-go already has its go.mod.
```

**Field 1 — File ownership**

You own exclusively (all in `scout-and-wave-web` worktree):
- `pkg/api/wave_runner.go`
- `pkg/api/scout.go`
- `pkg/api/impl_edit.go`
- `pkg/api/git_activity.go`
- `cmd/saw/commands.go`
- `cmd/saw/merge_cmd.go`

You must NOT touch `go.mod` or `go.sum` (owned by Agent H), `pkg/api/server.go`,
`pkg/api/types.go`, `pkg/api/wave.go`, `pkg/api/embed.go`, `cmd/saw/main.go`,
`cmd/saw/serve_cmd.go`, or any `*_test.go` files you did not create.

**Field 2 — Interfaces to implement**

The HTTP handler signatures remain unchanged (they are methods on `*Server`):

```go
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request)
func (s *Server) handleWaveGateProceed(w http.ResponseWriter, r *http.Request)
func (s *Server) handleWaveAgentRerun(w http.ResponseWriter, r *http.Request)
func (s *Server) handleScoutRun(w http.ResponseWriter, r *http.Request)
func (s *Server) handleScoutEvents(w http.ResponseWriter, r *http.Request)
func (s *Server) handleScoutCancel(w http.ResponseWriter, r *http.Request)
func (s *Server) handleGetImplRaw(w http.ResponseWriter, r *http.Request)
func (s *Server) handlePutImplRaw(w http.ResponseWriter, r *http.Request)
func (s *Server) handleImplRevise(w http.ResponseWriter, r *http.Request)
func (s *Server) handleImplReviseEvents(w http.ResponseWriter, r *http.Request)
func (s *Server) handleImplReviseCancel(w http.ResponseWriter, r *http.Request)
func (s *Server) handleGitActivity(w http.ResponseWriter, r *http.Request)
```

The SSE event bridge function:

```go
// makeEnginePublisher converts engine.Event to api.SSEEvent and publishes to the broker.
func (s *Server) makeEnginePublisher(slug string) func(engine.Event) {
    return func(ev engine.Event) {
        s.broker.Publish(slug, SSEEvent{Event: ev.Event, Data: ev.Data})
    }
}
```

**Field 3 — Interfaces to call**

- `github.com/blackwell-systems/scout-and-wave-go/pkg/engine` — all engine functions
- Existing `pkg/api` types (`sseBroker`, `SSEEvent`, `Server`) — unchanged

**Field 4 — What to implement**

For each handler file, replace internal engine logic with calls to the engine package:

**wave_runner.go:**
- Remove imports of `pkg/orchestrator`, `pkg/agent`, `pkg/agent/backend`, `pkg/agent/backend/cli`, `pkg/protocol`, `pkg/types`, `pkg/worktree`
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/engine`
- Rewrite `runWaveLoop` to call `engine.StartWave(ctx, engine.RunWaveOpts{...}, makeEnginePublisher(slug))`
- Remove `runScaffoldIfNeeded` (now inside engine)
- Keep `handleWaveStart`, `handleWaveGateProceed`, `handleWaveAgentRerun` handler bodies unchanged
- Keep `gateChannels` sync.Map and gate logic unchanged (wave gate is a UI/HTTP concern)

Note on gate channels: The gate wait logic (`gateChannels`, the 30-minute timeout, the
`wave_gate_pending` / `wave_gate_resolved` events) must remain in `wave_runner.go` because
it is transport logic (HTTP gate proceed endpoint) not engine logic. `engine.StartWave`
should NOT implement gates — the HTTP layer pauses and resumes the engine. One approach:
`engine.StartWave` returns after each wave; the HTTP layer decides whether to proceed.
Refactor `runWaveLoop` to call `engine.StartWave` in a loop (one wave at a time) with the
gate logic between iterations. Read the existing implementation carefully before designing
the loop.

**scout.go:**
- Remove imports of `pkg/agent`, `pkg/agent/backend`, `pkg/agent/backend/cli`, `pkg/types`
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/engine`
- Rewrite `runScoutAgent` to call `engine.RunScout(ctx, engine.RunScoutOpts{...}, onChunk)`
- Keep all HTTP handler bodies unchanged

**impl_edit.go:**
- Remove imports of `pkg/agent`, `pkg/agent/backend`, `pkg/agent/backend/cli`, `pkg/types`
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/engine`
- Rewrite `runImplReviseAgent` to call `engine.RunScout` with a revise prompt (or add a
  `engine.RunRevise` — if `RunRevise` is not in the engine interface, use `engine.RunScout`
  with a custom prompt passed via `RunScoutOpts`; or keep the CLI runner inline for revise
  and add a note as interface deviation)

**git_activity.go:**
- Remove import of `pkg/git` (the web-repo's `pkg/git/activity.go`)
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/git`
- Update `git.NewPoller` call to use the engine repo's package

**cmd/saw/commands.go:**
- Read the existing file carefully before editing — the `waveOrchestrator` interface and `orchestratorNewFunc` seam exist for testing; replace the seam with an engine-based equivalent
- Remove all imports of `pkg/orchestrator`, `pkg/agent`, `pkg/agent/backend`, `pkg/agent/backend/api`, `pkg/agent/backend/cli`, `pkg/protocol`, `pkg/types`
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/engine`
- `runWave`: replace `orchestratorNewFunc` seam with a direct engine-based wave loop. Call `engine.RunSingleWave` for each wave, `engine.MergeWave` to merge, `engine.RunVerification` to verify. Keep the inter-wave prompt logic (`--auto` flag, `bufio.NewReader` prompt) between iterations.
- `runScout`: replace `agent.NewRunner` + `runner.Execute` with `engine.RunScout(ctx, engine.RunScoutOpts{Feature: *feature, RepoPath: repoRoot, SAWRepoPath: sawRepo, IMPLOutPath: implOut}, func(s string) { fmt.Print(s) })`
- `runScaffold`: replace `agent.NewRunner` + `runner.Execute` with `engine.RunScaffold(ctx, absImpl, repoRoot, sawRepo, func(ev engine.Event) { fmt.Println(ev.Event) })`
- `runStatus`: replace `protocol.ParseIMPLDoc`, `protocol.ParseCompletionReport`, `protocol.ErrReportNotFound` with `engine.ParseIMPLDoc`, `engine.ParseCompletionReport`, `engine.ErrReportNotFound`
- The `init()` block that calls `orchestrator.SetValidateInvariantsFunc` and `orchestrator.SetParseIMPLDocFunc` is deleted — the engine handles that wiring internally
- `resolveBackend` helper is deleted — backend selection is now internal to the engine

**cmd/saw/merge_cmd.go:**
- Remove imports of `pkg/orchestrator`, `pkg/types`
- Add import of `github.com/blackwell-systems/scout-and-wave-go/pkg/engine`
- `runMerge`: replace `orchestrator.New` + state machine transitions + `MergeWave` with a single `engine.MergeWave(ctx, engine.RunMergeOpts{IMPLPath: *implPath, RepoPath: repoPath, WaveNum: *waveNum})` call

**Field 5 — Tests to write**

The existing `pkg/api/wave_runner_test.go`, `pkg/api/server_test.go`, `cmd/saw/commands_test.go`,
`cmd/saw/wave_loop_test.go`, and `cmd/saw/merge_cmd_test.go` must still pass.
Read these test files before editing their source files — understand the seams they use.
If tests use `orchestratorNewFunc` or a `waveOrchestrator` fake, replace the seam with an
`engine`-based equivalent that tests can inject.

Create `pkg/api/engine_bridge_test.go` with:
- `TestMakeEnginePublisher` — verify the publisher correctly maps engine.Event to SSEEvent

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-G
go build ./pkg/api/ ./cmd/saw/
go vet ./pkg/api/ ./cmd/saw/
go test ./pkg/api/ -run "TestHandleWave|TestHandleScout|TestMakeEngine|TestHandle" -v -timeout 120s
go test ./cmd/saw/ -run "TestRunWave|TestRunMerge|TestRunScout|TestRunStatus" -v -timeout 120s -skip 'TestDoctorHelpIncludesFixNote'
```

**Field 7 — Constraints**

- The `pkg/api/server.go`, `pkg/api/types.go`, `pkg/api/wave.go`, `pkg/api/embed.go` files
  must NOT be modified — they are NOT in your file ownership list.
- Do NOT remove the `gateChannels` sync.Map or inter-wave gate logic.
- If `engine.StartWave` needs to be refactored to support per-wave invocation (for gate logic),
  note this as an interface deviation with `downstream_action_required: false`.
- Do NOT touch `go.mod` — owned by Agent H.
- Do NOT remove the `init()` in the current `wave_runner.go` that wires `orchestrator.SetParseIMPLDocFunc`
  — instead, delete it since the engine handles that wiring internally.

**Field 8 — Completion report**

```yaml
## Agent G Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-G
branch: wave2-agent-G
commit: <git rev-parse HEAD>
files_changed:
  - pkg/api/wave_runner.go
  - pkg/api/scout.go
  - pkg/api/impl_edit.go
  - pkg/api/git_activity.go
  - cmd/saw/commands.go
  - cmd/saw/merge_cmd.go
files_created:
  - pkg/api/engine_bridge_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestMakeEnginePublisher
verification: "go build ./pkg/api/ && go vet ./pkg/api/ && go test ./pkg/api/ — all pass"
```
```

---

### Agent H - Update go.mod + go.sum (scout-and-wave-web)

**Field 0 — Isolation verification**

```
WORKTREE: /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-H
BRANCH: wave2-agent-H
REPO: scout-and-wave-web

cd /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-H
git branch --show-current     # must print: wave2-agent-H

Verify scout-and-wave-go exists and has go.mod:
  ls /Users/dayna.blackwell/code/scout-and-wave-go/go.mod   # must exist

If go.mod does not exist in scout-and-wave-go, STOP and report status: blocked.
```

**Field 1 — File ownership**

You own exclusively (in `scout-and-wave-web` worktree):
- `go.mod`
- `go.sum`

You must NOT touch any `.go` source file.

**Field 2 — Interfaces to implement**

The updated `go.mod` must contain:

```
require (
    github.com/blackwell-systems/scout-and-wave-go v0.0.0
    ... (existing requires unchanged)
)

replace github.com/blackwell-systems/scout-and-wave-go => /Users/dayna.blackwell/code/scout-and-wave-go
```

**Field 3 — Interfaces to call**

Go toolchain commands:
```
go mod edit -require github.com/blackwell-systems/scout-and-wave-go@v0.0.0
go mod edit -replace github.com/blackwell-systems/scout-and-wave-go=/Users/dayna.blackwell/code/scout-and-wave-go
go mod tidy
```

**Field 4 — What to implement**

1. Read the current `go.mod`.
2. Run `go mod edit` to add the require and replace directives.
3. Run `go mod tidy` to update `go.sum`.
4. Verify the directives are correct: `cat go.mod | grep scout-and-wave-go`

Note: At this point `pkg/api/*.go` in your worktree still has the OLD imports (Agent G is
in a parallel worktree). `go mod tidy` may complain that `scout-and-wave-go` is required
but not imported in any `.go` file. If so, add a blank import file:

```go
// file: internal/engine_import_anchor.go
// Package anchor ensures scout-and-wave-go is included in go.sum.
package internal

import _ "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
```

This file will be deleted post-merge once Agent G's imports pull in the package naturally.

**Field 5 — Tests to write**

No test files to write. Verification is `go build ./...` to confirm the module resolves.

**Field 6 — Verification gate**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-H
go mod tidy
go build ./...   # should succeed with the replace directive
go vet ./...
```

**Field 7 — Constraints**

- Do NOT modify any `.go` source files.
- The `replace` directive must use an absolute path (`/Users/dayna.blackwell/code/scout-and-wave-go`).
- The anchor file `internal/engine_import_anchor.go` (if created) must be committed and
  noted in `files_created`; it will be deleted by the orchestrator post-merge cleanup step.

**Field 8 — Completion report**

```yaml
## Agent H Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-web/.claude/worktrees/wave2-agent-H
branch: wave2-agent-H
commit: <git rev-parse HEAD>
files_changed:
  - go.mod
  - go.sum
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: "go mod tidy && go build ./... && go vet ./... — all pass"
```
```

---

## Wave Execution Loop

After each wave completes, the orchestrator works through this checklist in order.

**Cross-repo merge order:** Because scout-and-wave-go agents and scout-and-wave-web agents
are in different repos, merge them in this sequence:
1. Merge all scout-and-wave-go agent branches → `main` of scout-and-wave-go
2. Merge all scout-and-wave-web agent branches → current branch of scout-and-wave-web

### Orchestrator Post-Merge Checklist

**After Wave 1 completes (scout-and-wave-go agents A, B, C, D, E):**

- [ ] Read all agent completion reports — confirm all `status: complete`; if any `partial` or `blocked`, stop
- [ ] Cross-reference `files_changed` and `files_created` from all reports; flag any file in >1 agent's list
- [ ] Review `interface_deviations` — update Agent F prompt if any item has `downstream_action_required: true`
- [ ] Check for stub files (marked `// BUILD STUB`) — these must be replaced by the real implementations in the merged worktree
- [ ] Merge each scout-and-wave-go agent branch into `main`:
  - [ ] `cd /Users/dayna.blackwell/code/scout-and-wave-go && git merge --no-ff wave1-agent-A -m "Merge wave1-agent-A: pkg/types"`
  - [ ] `git merge --no-ff wave1-agent-B -m "Merge wave1-agent-B: internal/git"`
  - [ ] `git merge --no-ff wave1-agent-C -m "Merge wave1-agent-C: pkg/protocol"`
  - [ ] `git merge --no-ff wave1-agent-D -m "Merge wave1-agent-D: pkg/worktree"`
  - [ ] `git merge --no-ff wave1-agent-E -m "Merge wave1-agent-E: pkg/agent"`
- [ ] Worktree cleanup for each merged agent:
  - [ ] `git worktree remove /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-{X}`
  - [ ] `git branch -d wave1-agent-{X}`
- [ ] Remove any `// BUILD STUB` files that have now been replaced by real merged files
- [ ] Post-merge verification (scout-and-wave-go):
  - [ ] Linter auto-fix: `cd /Users/dayna.blackwell/code/scout-and-wave-go && go fmt ./...`
  - [ ] `go build ./... && go vet ./... && go test ./...`
- [ ] Fix any cascade failures
- [ ] Tick status checkboxes in this IMPL doc for completed agents
- [ ] Feature-specific steps:
  - [ ] Verify `pkg/engine/engine.go` stub bodies are still stubs (Agent F will fill them in Wave 2)
  - [ ] Verify no `// BUILD STUB` files remain after merge
- [ ] Commit: `git commit -m "wave1: merge agents A-E — foundation packages in scout-and-wave-go"`
- [ ] Launch Wave 2

**After Wave 2 completes (scout-and-wave-go: Agent F; scout-and-wave-web: Agents G, H):**

- [ ] Read all agent completion reports — confirm all `status: complete`
- [ ] Review `interface_deviations` — propagate any with `downstream_action_required: true`
- [ ] Merge scout-and-wave-go Wave 2 agent first:
  - [ ] `cd /Users/dayna.blackwell/code/scout-and-wave-go && git merge --no-ff wave2-agent-F -m "Merge wave2-agent-F: engine facade + orchestrator"`
  - [ ] `go build ./... && go vet ./... && go test ./...`
- [ ] Merge scout-and-wave-web Wave 2 agents:
  - [ ] `cd /Users/dayna.blackwell/code/scout-and-wave-web && git merge --no-ff wave2-agent-H -m "Merge wave2-agent-H: go.mod + replace directive"`
  - [ ] `git merge --no-ff wave2-agent-G -m "Merge wave2-agent-G: rewire pkg/api HTTP handlers"`
- [ ] Delete anchor import file if Agent H created `internal/engine_import_anchor.go`:
  - [ ] `rm internal/engine_import_anchor.go && git add -u && git commit -m "chore: remove engine import anchor (no longer needed)"`
- [ ] Worktree cleanup for all Wave 2 agents
- [ ] Post-merge verification (scout-and-wave-web):
  - [ ] Linter auto-fix: `go fmt ./...`
  - [ ] `go build ./... && go vet ./... && go test ./...`
- [ ] Smoke test: `./saw serve &` — verify server starts on :7432 and routes respond
- [ ] Feature-specific steps:
  - [ ] Verify `pkg/api/` no longer imports `pkg/orchestrator`, `pkg/agent`, or `pkg/worktree` directly
  - [ ] Verify `cmd/saw/` no longer imports `pkg/orchestrator`, `pkg/agent`, `pkg/protocol`, or `pkg/types` directly
  - [ ] Verify the `replace` directive in `go.mod` points to the correct absolute path
  - [ ] Delete old packages from scout-and-wave-web (now fully superseded by the engine module):
    ```bash
    cd /Users/dayna.blackwell/code/scout-and-wave-web
    rm -rf pkg/orchestrator pkg/agent pkg/protocol pkg/worktree internal/git pkg/git pkg/types
    go build ./... && go vet ./...   # must pass with no imports of deleted packages
    git add -A && git commit -m "chore: delete superseded packages (moved to scout-and-wave-go engine)"
    ```
- [ ] Final smoke test: `./saw serve &` — verify server starts on :7432 and all routes respond
- [ ] CLI smoke test: `./saw status --impl docs/IMPL/IMPL-engine-extraction.md` — verify output
- [ ] Commit: `git commit -m "wave2: merge agents F, G, H — engine extraction complete"`
- [ ] Mark IMPL doc complete: add `<!-- SAW:COMPLETE 2026-03-08 -->` tag

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| — | Scaffold | go.mod init + pkg/types + pkg/engine stubs in scout-and-wave-go | TO-DO |
| 1 | A | Copy pkg/types into scout-and-wave-go | TO-DO |
| 1 | B | Copy internal/git into scout-and-wave-go | TO-DO |
| 1 | C | Copy pkg/protocol into scout-and-wave-go | TO-DO |
| 1 | D | Copy pkg/worktree into scout-and-wave-go | TO-DO |
| 1 | E | Copy pkg/agent + backends into scout-and-wave-go | TO-DO |
| 2 | F | Build engine facade + orchestrator in scout-and-wave-go | TO-DO |
| 2 | G | Rewire pkg/api HTTP handlers + cmd/saw CLI in scout-and-wave-web | TO-DO |
| 2 | H | Update go.mod + go.sum in scout-and-wave-web | TO-DO |
| — | Orch | Post-merge integration + binary smoke test | TO-DO |

### Agent A - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: ac59e815af6449d98eb05a916648a0f4df3b0f5f
files_changed:
  - pkg/types/types.go
files_created:
  - pkg/types/types_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestStateString
  - TestCompletionStatusConstants
verification: PASS
```

### Agent B - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: 18140c5b6a478f909afe62833aa904d8cd3917aa
files_changed: []
files_created:
  - internal/git/commands.go
  - internal/git/commands_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestRunInvalidDir
  - TestRevParseHEAD
verification: PASS
```

### Agent D - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-D
branch: wave1-agent-D
commit: 2a88aa54389a041d112ecf45798956cb8c03d4a3
files_changed: []
files_created:
  - pkg/worktree/manager.go
  - pkg/worktree/manager_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestManagerNew
  - TestManagerCreateRemoveRoundtrip
verification: PASS
```

Copied manager.go verbatim from scout-and-wave-web, updating only the import path from `scout-and-wave-web/internal/git` to `scout-and-wave-go/internal/git`. Created a build stub at `internal/git/commands.go` (not committed) to allow `go build` and `go test` to pass in isolation while Agent B's real implementation is in a parallel worktree. Both tests pass. The stub file was not staged or committed — only `pkg/worktree/` was committed.

The scaffold copy of `pkg/types/types.go` was already an exact match of `scout-and-wave-web/pkg/types/types.go` — no changes were needed to the types file itself. All 13 required types are present: `State`, `CompletionStatus`, `IMPLDoc`, `FileOwnershipInfo`, `Wave`, `AgentSpec`, `CompletionReport`, `InterfaceDeviation`, `KnownIssue`, `ScaffoldFile`, `PreMortemRow`, `PreMortem`, `ValidationError`. The `State.String()` method covers all 11 state values plus an "Unknown" default. Tests verify both `String()` and the three `CompletionStatus` constants. Build, vet, and tests all pass cleanly.
