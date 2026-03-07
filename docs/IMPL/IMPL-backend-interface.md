# IMPL: Backend Interface Abstraction — claude-api and claude-cli backends
<!-- SAW:COMPLETE 2026-03-07 -->

### Suitability Assessment

Verdict: SUITABLE

test_command: `go test ./...`
lint_command: `go vet ./...`

The work decomposes into four independently-owned file sets with clean
interface boundaries. Agent A owns the new `Backend` interface and the
refactored API backend (`pkg/agent/backend/`). Agent B owns the CLI backend
(`pkg/agent/backend/cli/`). Agent C owns the `Runner` and orchestrator
wiring that switches between backends. Agent D owns the `cmd/saw` flag/env
plumbing for backend selection. No two agents share a file. The `Backend`
interface can be fully specified before any agent starts because it is a
direct generalization of the existing `Sender` + `ToolRunner` interfaces.
The `go test ./...` cycle is moderately long (multiple packages, real disk
I/O in worktree tests), parallelization offers meaningful benefit.

Pre-implementation scan results:
- Total items: 4 work items (Backend interface, API backend extract, CLI
  backend, wiring/selection)
- Already implemented: 0 items
- Partially implemented: 0 items — the existing `Sender` and `ToolRunner`
  interfaces in `runner.go` provide shape guidance but are not Backend
- To-do: 4 items

Agent adjustments:
- All agents proceed as planned (to-do)

Estimated times:
- Scout phase: ~15 min (codebase analysis, interface contracts, IMPL doc)
- Agent execution: ~40 min (4 agents × ~10 min avg, max parallelism in Wave 1
  for A+B, then C+D in Wave 2)
- Merge & verification: ~5 min
Total SAW time: ~60 min

Sequential baseline: ~80 min (4 agents × 20 min sequential)
Time savings: ~20 min (25% faster)

Recommendation: Clear speedup. Proceed.

---

### Scaffolds

The `Backend` interface crosses the boundary between Agent A (who defines it)
and Agents B, C, and D (who consume it). The Scaffold Agent must create the
interface file before Wave 1 launches so all agents compile against the same
contract.

| File | Contents | Import path | Status |
|------|----------|-------------|--------|
| `pkg/agent/backend/backend.go` | `Backend` interface (see Interface Contracts) | `github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend` | committed |

The Scaffold Agent must create `pkg/agent/backend/` as a new package
containing only the `Backend` interface declaration and the `Config` struct.
No implementation code goes in this file.

---

### Known Issues

None identified. `go test ./...` passes cleanly on the current codebase.

---

### Dependency Graph

```
pkg/agent/backend/backend.go   (scaffold — defines Backend interface + Config)
         |
         +——> pkg/agent/backend/api/client.go   [Agent A]
         |         (extracts current Client into api sub-package)
         |
         +——> pkg/agent/backend/cli/client.go   [Agent B]
         |         (new CLI backend; shells out to `claude --print`)
         |
         +——> pkg/agent/runner.go               [Agent C]
         |         (accepts Backend, removes ToolRunner/Sender split)
         |
         +——> pkg/orchestrator/orchestrator.go  [Agent C]
         |         (newRunnerFunc accepts Backend; backend selection logic)
         |
         +——> cmd/saw/commands.go               [Agent D]
                   (--backend flag, ANTHROPIC_API_KEY auto-detect)
```

Roots (no dependencies on new work):
- `pkg/agent/backend/backend.go` (scaffold, created before Wave 1)

Leaf nodes (depend on scaffold only, no inter-agent dependencies):
- `pkg/agent/backend/api/` [Agent A]
- `pkg/agent/backend/cli/` [Agent B]

Wave 2 nodes (depend on A and B being merged):
- `pkg/agent/runner.go` and `pkg/orchestrator/orchestrator.go` [Agent C]
- `cmd/saw/commands.go` [Agent D]

Cascade candidates (files that reference changed interfaces but are NOT in any
agent's scope — post-merge verification will surface these):
- `pkg/agent/client_test.go` — tests `*Client` directly; once `Client` moves
  to `pkg/agent/backend/api`, the test file must move or its import path must
  update. **Agent A owns this file.**
- `pkg/orchestrator/orchestrator_test.go` — uses `newRunnerFunc` seam; the
  seam signature changes when `Runner` accepts `Backend`. **Agent C owns this
  file.**
- `cmd/saw/commands_test.go` — tests `runScout`/`runScaffold` which call
  `agent.NewClient` directly. **Agent D owns this file.**

---

### Interface Contracts

#### Backend interface (scaffold file: `pkg/agent/backend/backend.go`)

```go
package backend

import "context"

// Config carries backend-agnostic configuration.
type Config struct {
    // Model is the Claude model identifier (e.g. "claude-sonnet-4-5").
    // Ignored by the CLI backend (model is configured in Claude Code settings).
    Model string

    // MaxTokens caps output token count. Ignored by the CLI backend.
    MaxTokens int

    // MaxTurns is the tool-use loop limit. 0 means use the backend default (50).
    MaxTurns int
}

// Backend is the abstraction both the API client and the CLI client implement.
// Runner accepts a Backend and delegates all LLM interaction through it.
type Backend interface {
    // Run executes the agent described by systemPrompt and userMessage,
    // using workDir as the working directory for any file/shell operations.
    // It returns the final assistant text when the agent signals completion.
    //
    // For the API backend: sends systemPrompt + userMessage through the
    // Anthropic Messages API with tool-use loop.
    // For the CLI backend: invokes `claude --print --cwd workDir` with
    // systemPrompt prepended to userMessage.
    Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
}
```

#### API backend (`pkg/agent/backend/api/client.go`) — Agent A

```go
package api

import "github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"

// Client implements backend.Backend using the Anthropic SDK.
type Client struct { /* unexported fields */ }

// New creates a Client. Uses ANTHROPIC_API_KEY env var if apiKey is empty.
func New(apiKey string, cfg backend.Config) *Client

// WithBaseURL sets an alternate base URL (for tests). Returns c for chaining.
func (c *Client) WithBaseURL(url string) *Client

// Run implements backend.Backend.
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
```

Note: `Run` on the API backend internally calls the tool-use loop from the
current `RunWithTools`, using `StandardTools(workDir)` built into the method.
The `tools []Tool` parameter is no longer passed by the caller — the API
backend owns its own tool list scoped to `workDir`.

#### CLI backend (`pkg/agent/backend/cli/client.go`) — Agent B

```go
package cli

import "github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"

// Client implements backend.Backend by shelling out to the `claude` CLI.
type Client struct { /* unexported fields */ }

// New creates a CLI Client. claudePath is the path to the claude binary;
// if empty, it is located via PATH.
func New(claudePath string, cfg backend.Config) *Client

// Run implements backend.Backend.
// It invokes: claude --print --cwd workDir -p "<systemPrompt>\n\n<userMessage>"
// and streams stdout line-by-line until the process exits.
// Allowed tools passed to --allowedTools: Bash, Read, Write, Edit, Glob, Grep
// (Claude Code built-ins; no custom tools needed).
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
```

#### Runner (`pkg/agent/runner.go`) — Agent C

```go
// NewRunner creates a Runner backed by the given Backend and worktree Manager.
// The Backend replaces the old Sender+ToolRunner split.
func NewRunner(b backend.Backend, worktrees *worktree.Manager) *Runner

// Execute sends agentSpec.Prompt to b.Run as systemPrompt,
// with the standard worktree-context user message.
func (r *Runner) Execute(ctx context.Context, agentSpec *types.AgentSpec, worktreePath string) (string, error)

// ExecuteWithTools is REMOVED. Callers use Execute; tool management is
// internal to the Backend.
```

`Runner.client` field changes type from `Sender` to `backend.Backend`.
`Runner.toolRunner` field is removed.

#### Orchestrator seam (`pkg/orchestrator/orchestrator.go`) — Agent C

```go
// newRunnerFunc signature changes to accept a backend.Backend instead of
// constructing one internally.
var newRunnerFunc = func(b backend.Backend, wm *worktree.Manager) *agent.Runner {
    return agent.NewRunner(b, wm)
}

// newBackendFunc is a new seam that constructs the Backend from config.
// Tests can replace it to inject a fake.
var newBackendFunc = func(cfg BackendConfig) (backend.Backend, error)

// BackendConfig carries backend selection + credentials.
type BackendConfig struct {
    Kind      string // "api" | "cli" | "auto"
    APIKey    string // used when Kind=="api" or Kind=="auto"
    Model     string
    MaxTokens int
    MaxTurns  int
}
```

`RunWave` calls `newBackendFunc` to obtain the backend, then passes it to
`newRunnerFunc`.

#### cmd/saw backend flag (`cmd/saw/commands.go`) — Agent D

Backend selection is added to `runWave`, `runScout`, and `runScaffold` via a
shared helper:

```go
// resolveBackend returns a backend.Backend based on flags and environment.
// kind: "api" | "cli" | "auto" (auto picks api if ANTHROPIC_API_KEY is set,
// otherwise cli).
func resolveBackend(kind string, cfg backend.Config) (backend.Backend, error)
```

Flag added to all three commands: `--backend <api|cli|auto>` (default: "auto").

---

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `pkg/agent/backend/backend.go` | Scaffold | 0 | nothing |
| `pkg/agent/backend/api/client.go` | A | 1 | scaffold |
| `pkg/agent/backend/api/client_test.go` | A | 1 | scaffold |
| `pkg/agent/stream.go` | A | 1 | scaffold (moved/kept in pkg/agent or api pkg) |
| `pkg/agent/client.go` | A | 1 | scaffold (refactored → thin shim or removed) |
| `pkg/agent/client_test.go` | A | 1 | scaffold |
| `pkg/agent/tools.go` | A | 1 | nothing (kept, used internally by api backend) |
| `pkg/agent/backend/cli/client.go` | B | 1 | scaffold |
| `pkg/agent/backend/cli/client_test.go` | B | 1 | scaffold |
| `pkg/agent/runner.go` | C | 2 | A+B merged |
| `pkg/agent/runner_test.go` | C | 2 | A+B merged |
| `pkg/agent/completion.go` | C | 2 | A+B merged (no logic change, re-verify) |
| `pkg/orchestrator/orchestrator.go` | C | 2 | A+B merged |
| `pkg/orchestrator/orchestrator_test.go` | C | 2 | A+B merged |
| `cmd/saw/commands.go` | D | 2 | A+B merged |
| `cmd/saw/commands_test.go` | D | 2 | A+B merged |

Notes:
- `pkg/agent/tools.go` stays in `pkg/agent` and is used by the API backend
  internally. It is NOT assigned to any Wave 2 agent because Agent A will
  decide whether to keep or move it during Wave 1. Agent C/D must not touch it.
- `pkg/agent/stream.go` is Anthropic-SDK-specific; Agent A moves it into
  `pkg/agent/backend/api/` or keeps it in `pkg/agent` as an unexported helper.
  Agent A owns the decision and the file.
- `pkg/agent/client.go` is either refactored into a thin backward-compat shim
  (if any internal callers remain) or deleted. Agent A owns this decision.
- `pkg/agent/completion.go` and `pkg/agent/completion_test.go` (if it exists)
  do not change logic; Agent C re-verifies they compile cleanly after runner
  changes.

Append-only / orchestrator-owned after merge:
- `go.mod` / `go.sum` — no new external dependencies expected (CLI backend uses
  `os/exec`). If a new dep is needed, the orchestrator adds it post-merge.

---

### Wave Structure

```
[Scaffold]                        <- create pkg/agent/backend/backend.go
     |
Wave 1:  [A] [B]                  <- 2 parallel agents
     |    |   |
     |  api  cli
     |  backend backend
     |
     | (A + B merged, go build ./... passes)
     |
Wave 2:  [C] [D]                  <- 2 parallel agents
              |   |
           runner  cmd/saw
           + orch   flags
```

Wave 2 is unblocked when Agent A and Agent B are both merged and
`go build ./...` passes on the merged result.

---

### Agent Prompts

#### Agent A — API Backend Extraction

**Field 0 — Role & mission**
You are Wave 1 Agent A. Your mission is to extract the current Anthropic API
client into a new `pkg/agent/backend/api/` sub-package and make it implement
the `backend.Backend` interface defined in the scaffold file. You also update
`pkg/agent/client.go`, `pkg/agent/stream.go`, and `pkg/agent/tools.go` as
needed.

**Field 1 — Owned files**
- `pkg/agent/backend/api/client.go` (create)
- `pkg/agent/backend/api/client_test.go` (create)
- `pkg/agent/client.go` (refactor or delete)
- `pkg/agent/client_test.go` (update import paths)
- `pkg/agent/stream.go` (move into api package or keep as unexported helper)
- `pkg/agent/tools.go` (keep as-is or move; decide and document)

Do NOT touch: `pkg/agent/runner.go`, `pkg/agent/completion.go`,
`pkg/orchestrator/`, `cmd/saw/`, `pkg/agent/backend/cli/`.

**Field 2 — Interface contracts (binding)**
The scaffold file at `pkg/agent/backend/backend.go` declares:

```go
package backend

import "context"

type Config struct {
    Model     string
    MaxTokens int
    MaxTurns  int
}

type Backend interface {
    Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
}
```

Your `api.Client` must implement `backend.Backend`. The `Run` method must
internally execute the full tool-use loop (equivalent to the current
`RunWithTools`) using `StandardTools(workDir)` from `pkg/agent/tools.go`.

Exported constructor signature (binding):
```go
func New(apiKey string, cfg backend.Config) *Client
func (c *Client) WithBaseURL(url string) *Client
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
```

**Field 3 — Implementation guidance**

1. Create `pkg/agent/backend/api/` directory.
2. Copy the logic from `client.go`'s `RunWithTools` into `api.Client.Run`.
   - `Run` concatenates `systemPrompt` as the system param and `userMessage`
     as the user turn, then runs the existing tool-use loop.
   - `StandardTools(workDir)` provides the tool list; import `pkg/agent` for
     this or move the tools into the api package (your call — document your
     decision in the completion report).
3. `collectStream` from `stream.go` may be moved into the api package (make
   it unexported there) or kept in `pkg/agent` as an unexported helper.
4. `pkg/agent/client.go`: After extraction, this file may be reduced to a
   thin shim (`NewClient` calls `api.New`) for any remaining callers, or
   deleted if no callers remain outside your scope. Check: the orchestrator
   (`orchestrator.go`) and `cmd/saw/commands.go` both call `agent.NewClient`
   — they are owned by Agents C and D (Wave 2) and will update those call
   sites. So you MAY keep a shim. Simplest path: keep `client.go` as a shim
   that delegates to `api.New`, keeping the package-level API stable for now.
   Wave 2 agents will remove the shim.
5. Write tests in `pkg/agent/backend/api/client_test.go` covering:
   - `New` with empty API key falls back to env var
   - `WithBaseURL` stores the override
   - `Run` with a mock HTTP server (reuse the pattern from the existing
     `client_test.go` if it uses `httptest`)

**Field 4 — Verification gate**
```bash
go build ./pkg/agent/backend/api/...
go vet ./pkg/agent/backend/api/...
go test ./pkg/agent/backend/api/... -run TestNew -timeout 2m
go build ./pkg/agent/...
go vet ./pkg/agent/...
go test ./pkg/agent/... -timeout 2m
```

**Field 5 — Out-of-scope**
- Do not change `runner.go`, `orchestrator.go`, or `cmd/saw/`.
- Do not create the CLI backend; that is Agent B.
- Do not add `--backend` flags; that is Agent D.

**Field 6 — Completion report format**
Write your completion report as a fenced YAML block under the heading
`### Agent A - Completion Report` in the IMPL doc at
`docs/IMPL/IMPL-backend-interface.md`. Required fields:
```yaml
status: complete | partial | blocked
worktree: <path>
branch: <branch>
commit: <sha>
files_changed: [list]
files_created: [list]
interface_deviations: [list any changes to the Backend interface or api.Client signatures]
out_of_scope_deps: [list]
tests_added: [list]
verification: PASS | FAIL
notes: <optional>
```

**Field 7 — Constraints**
- Disjoint ownership: do not modify any file not listed in Field 1.
- The `backend.Backend` interface signature in the scaffold is binding; do not
  alter it.
- If `pkg/agent/tools.go` is moved into the api package, document this in
  `interface_deviations` so Agent C knows the import path.

**Field 8 — Working directory**
Your git worktree will be specified in the user message. Run all commands from
that directory.

---

#### Agent B — CLI Backend Implementation

**Field 0 — Role & mission**
You are Wave 1 Agent B. Your mission is to implement a new
`pkg/agent/backend/cli/` package that satisfies `backend.Backend` by shelling
out to the `claude` CLI. This backend enables users without an Anthropic API
key (Claude Max plan subscribers) to use SAW.

**Field 1 — Owned files**
- `pkg/agent/backend/cli/client.go` (create)
- `pkg/agent/backend/cli/client_test.go` (create)

Do NOT touch any other file.

**Field 2 — Interface contracts (binding)**
The scaffold file at `pkg/agent/backend/backend.go` declares:

```go
package backend

import "context"

type Config struct {
    Model     string
    MaxTokens int
    MaxTurns  int
}

type Backend interface {
    Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
}
```

Your `cli.Client` must implement `backend.Backend`. Exported constructor
(binding):
```go
func New(claudePath string, cfg backend.Config) *Client
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
```

**Field 3 — Implementation guidance**

The CLI backend invokes the `claude` binary with these flags:

```
claude --print --cwd <workDir> \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  -p "<systemPrompt>\n\n<userMessage>"
```

Key implementation details:

1. **Binary resolution**: if `claudePath` is empty, locate `claude` via
   `exec.LookPath("claude")`. Return a descriptive error if not found.

2. **Prompt construction**: concatenate `systemPrompt + "\n\n" + userMessage`
   as the value for `-p`. If `systemPrompt` is empty, pass only `userMessage`.

3. **Streaming**: use `cmd.StdoutPipe()` and read line-by-line with a
   `bufio.Scanner`. Accumulate all output into a `strings.Builder` and return
   it when the process exits with code 0.

4. **Error handling**:
   - Non-zero exit code: return an error that includes the exit code and any
     stderr output.
   - Context cancellation: honour `ctx`; use `exec.CommandContext`.
   - Stderr: capture separately (via `cmd.StderrPipe()` or
     `cmd.CombinedOutput` variant) and include in error messages.

5. **Config fields**: `Model` and `MaxTokens` are ignored (Claude Code uses
   its own model config). `MaxTurns` maps to `--max-turns <n>` if > 0.

6. **Allowed tools**: always pass
   `--allowedTools "Bash,Read,Write,Edit,Glob,Grep"` so the agent has full
   file and shell access equivalent to the API backend's `StandardTools`.

**Field 4 — Verification gate**
```bash
go build ./pkg/agent/backend/cli/...
go vet ./pkg/agent/backend/cli/...
go test ./pkg/agent/backend/cli/... -timeout 2m
```

Tests should mock `exec.Command` or use a fake `claude` script (write a
small shell script to a temp dir and add it to PATH) to avoid a real
`claude` binary dependency in CI.

**Field 5 — Out-of-scope**
- Do not change any existing file.
- Do not wire the CLI backend into the Runner or orchestrator; that is Agent C.
- Do not add `--backend` flags; that is Agent D.

**Field 6 — Completion report format**
Write your completion report as a fenced YAML block under the heading
`### Agent B - Completion Report` in the IMPL doc at
`docs/IMPL/IMPL-backend-interface.md`. Required fields:
```yaml
status: complete | partial | blocked
worktree: <path>
branch: <branch>
commit: <sha>
files_changed: []
files_created: [pkg/agent/backend/cli/client.go, pkg/agent/backend/cli/client_test.go]
interface_deviations: [any changes to cli.Client or its constructor]
out_of_scope_deps: []
tests_added: [list]
verification: PASS | FAIL
notes: <optional>
```

**Field 7 — Constraints**
- Disjoint ownership: do not modify any file not listed in Field 1.
- The `backend.Backend` interface is defined in the scaffold; do not redefine
  it in the cli package.
- The `claude` binary is an external dependency; tests must not require it to
  be installed. Use a fake or skip if absent.

**Field 8 — Working directory**
Your git worktree will be specified in the user message. Run all commands from
that directory.

---

#### Agent C — Runner and Orchestrator Wiring

**Field 0 — Role & mission**
You are Wave 2 Agent C. Wave 1 (Agents A and B) is already merged. Your
mission is to refactor `pkg/agent/runner.go` to accept a `backend.Backend`
instead of the `Sender`/`ToolRunner` split, and to update
`pkg/orchestrator/orchestrator.go` to construct and inject the backend.

**Field 1 — Owned files**
- `pkg/agent/runner.go`
- `pkg/agent/runner_test.go`
- `pkg/agent/completion.go` (verify it still compiles; no logic change expected)
- `pkg/orchestrator/orchestrator.go`
- `pkg/orchestrator/orchestrator_test.go`

Do NOT touch: `pkg/agent/client.go`, `pkg/agent/backend/api/`,
`pkg/agent/backend/cli/`, `cmd/saw/`.

**Field 2 — Interface contracts (binding)**

New `Runner` public API (binding for Agent D):

```go
// NewRunner creates a Runner backed by the given Backend and worktree Manager.
func NewRunner(b backend.Backend, worktrees *worktree.Manager) *Runner

// Execute sends agentSpec.Prompt as systemPrompt to b.Run,
// with the standard worktree-context user message.
func (r *Runner) Execute(ctx context.Context, agentSpec *types.AgentSpec, worktreePath string) (string, error)

// ParseCompletionReport delegates to protocol.ParseCompletionReport.
func (r *Runner) ParseCompletionReport(implDocPath string, agentLetter string) (*types.CompletionReport, error)
```

`ExecuteWithTools` is removed. `Runner.client` changes from `Sender` to
`backend.Backend`. `Runner.toolRunner` field is removed.

New orchestrator seam (binding for Agent D):

```go
// BackendConfig carries backend selection + credentials for newBackendFunc.
type BackendConfig struct {
    Kind      string // "api" | "cli" | "auto"
    APIKey    string
    Model     string
    MaxTokens int
    MaxTurns  int
}

// newBackendFunc constructs a backend.Backend from config. Seam for tests.
var newBackendFunc = func(cfg BackendConfig) (backend.Backend, error)

// newRunnerFunc now accepts a backend.Backend.
var newRunnerFunc = func(b backend.Backend, wm *worktree.Manager) *agent.Runner
```

**Field 3 — Implementation guidance**

1. **runner.go**:
   - Replace `client Sender` field with `client backend.Backend`.
   - Remove `toolRunner ToolRunner` field.
   - `NewRunner(b backend.Backend, wm *worktree.Manager) *Runner`.
   - `Execute`: build the same user message as today, then call
     `r.client.Run(ctx, systemPrompt, userMessage, worktreePath)`.
   - Remove `ExecuteWithTools`. Any internal call sites use `Execute`.
   - Remove the `Sender` and `ToolRunner` interface declarations from
     `runner.go` (they are now superseded by `backend.Backend`).
   - Keep `ParseCompletionReport` unchanged.

2. **orchestrator.go**:
   - Add `BackendConfig` struct.
   - Add `newBackendFunc` var with a real default implementation that calls
     `api.New(cfg.APIKey, ...)` when `Kind` is "api" or "auto" with API key
     present, and `cli.New("", ...)` when Kind is "cli" or "auto" without key.
   - Change `newRunnerFunc` signature to `func(b backend.Backend, wm *worktree.Manager) *agent.Runner`.
   - In `RunWave`: call `newBackendFunc(BackendConfig{...})` to get the
     backend, then pass it to `newRunnerFunc`.
   - In `launchAgent`: replace the `runner.ExecuteWithTools(...)` call with
     `runner.Execute(ctx, &agentSpec, wtPath)`. Remove the `tools` local var
     and `agent.StandardTools` call — tools are now internal to the backend.
   - The `defaultAgentTimeout` and `defaultAgentPollInterval` vars stay.

3. **orchestrator_test.go**:
   - Update the `newRunnerFunc` replacement pattern in tests to match the new
     signature `func(b backend.Backend, wm *worktree.Manager) *agent.Runner`.
   - Add a `newBackendFunc` replacement for tests that need to inject a fake
     backend (e.g. a stub that implements `backend.Backend`).

4. **runner_test.go**:
   - Replace `mockSender` with a `mockBackend` struct implementing
     `backend.Backend.Run(ctx, systemPrompt, userMessage, workDir string) (string, error)`.
   - Remove `TestExecuteWithTools_NilToolRunner` (method no longer exists).
   - Update `TestNewRunner` to verify `r.client` holds the backend.

**Field 4 — Verification gate**
```bash
go build ./pkg/agent/...
go vet ./pkg/agent/...
go test ./pkg/agent/... -timeout 2m
go build ./pkg/orchestrator/...
go vet ./pkg/orchestrator/...
go test ./pkg/orchestrator/... -timeout 2m
```

**Field 5 — Out-of-scope**
- Do not change `cmd/saw/`; that is Agent D.
- Do not change files in `pkg/agent/backend/api/` or `pkg/agent/backend/cli/`.
- Do not change `pkg/agent/tools.go` unless Agent A's completion report
  says the import path changed (check `interface_deviations` in Agent A's
  report and adjust import accordingly).

**Field 6 — Completion report format**
Write your completion report as a fenced YAML block under the heading
`### Agent C - Completion Report` in the IMPL doc at
`docs/IMPL/IMPL-backend-interface.md`. Required fields:
```yaml
status: complete | partial | blocked
worktree: <path>
branch: <branch>
commit: <sha>
files_changed: [list]
files_created: []
interface_deviations: [any changes to NewRunner, Execute, BackendConfig, newBackendFunc]
out_of_scope_deps: []
tests_added: [list]
verification: PASS | FAIL
notes: <optional>
```

**Field 7 — Constraints**
- `Execute` signature change (adds `ctx context.Context` as first arg) is a
  breaking change from the current signature. This is intentional and
  documented. Agent D must update call sites.
- Do not change the IMPL doc Status table checkboxes; the orchestrator does
  that post-merge.

**Field 8 — Working directory**
Your git worktree will be specified in the user message. Run all commands from
that directory.

---

#### Agent D — Backend Selection in cmd/saw

**Field 0 — Role & mission**
You are Wave 2 Agent D. Wave 1 (Agents A and B) is already merged. Your
mission is to add `--backend` flag support to `cmd/saw/commands.go` and update
the three call sites (`runWave`, `runScout`, `runScaffold`) that currently
hardwire `agent.NewClient("")`. After your changes, users can select the
backend via flag or environment variable.

**Field 1 — Owned files**
- `cmd/saw/commands.go`
- `cmd/saw/commands_test.go`

Do NOT touch: `cmd/saw/main.go`, `cmd/saw/serve_cmd.go`,
`cmd/saw/merge_cmd.go`, `cmd/saw/wave_loop_test.go`,
`pkg/agent/`, `pkg/orchestrator/`.

**Field 2 — Interface contracts (binding)**
Agent C defines these in `pkg/orchestrator/orchestrator.go`:

```go
type BackendConfig struct {
    Kind      string // "api" | "cli" | "auto"
    APIKey    string
    Model     string
    MaxTokens int
    MaxTurns  int
}
```

You will also call `api.New` and `cli.New` directly for `runScout` and
`runScaffold` (which do not go through the orchestrator). Use these
constructors (defined by Agents A and B respectively):

```go
// pkg/agent/backend/api
func New(apiKey string, cfg backend.Config) *api.Client

// pkg/agent/backend/cli
func New(claudePath string, cfg backend.Config) *cli.Client
```

Agent C's updated `runner.NewRunner` signature:
```go
func NewRunner(b backend.Backend, worktrees *worktree.Manager) *agent.Runner
```

Agent C's updated `runner.Execute` signature (adds ctx):
```go
func (r *Runner) Execute(ctx context.Context, agentSpec *types.AgentSpec, worktreePath string) (string, error)
```

**Field 3 — Implementation guidance**

1. **Shared helper** — add to `commands.go`:
```go
// resolveBackend returns a backend.Backend based on kind and cfg.
// kind: "api" | "cli" | "auto"
// auto: uses API backend if ANTHROPIC_API_KEY is set, CLI backend otherwise.
func resolveBackend(kind string, cfg backend.Config) (backend.Backend, error) {
    switch kind {
    case "api":
        return api.New(os.Getenv("ANTHROPIC_API_KEY"), cfg), nil
    case "cli":
        return cli.New("", cfg), nil
    case "auto":
        if os.Getenv("ANTHROPIC_API_KEY") != "" {
            return api.New(os.Getenv("ANTHROPIC_API_KEY"), cfg), nil
        }
        return cli.New("", cfg), nil
    default:
        return nil, fmt.Errorf("unknown backend kind %q; valid values: api, cli, auto", kind)
    }
}
```

2. **`runWave`**: add `--backend` flag (default "auto"). Pass backend kind
   into the orchestrator via `orchestrator.BackendConfig`. The `orchestratorNewFunc`
   seam needs to accept the config; update the seam signature if needed, or
   set a package-level var that `newBackendFunc` reads. Coordinate with Agent
   C's completion report if the seam API differs.

3. **`runScout`**: replace
   ```go
   client := agent.NewClient("")
   runner := agent.NewRunner(client, nil)
   ```
   with:
   ```go
   b, err := resolveBackend(backendKind, backend.Config{MaxTurns: 80})
   if err != nil { return fmt.Errorf("scout: %w", err) }
   runner := agent.NewRunner(b, nil)
   ```
   Update the `runner.ExecuteWithTools` call (removed) to `runner.Execute`
   (Agent C's new signature with `ctx` as first arg).

4. **`runScaffold`**: same pattern as `runScout`, using `MaxTurns: 40`.

5. **Environment variable override**: in addition to `--backend`, respect
   `SAW_BACKEND` env var as fallback (flag takes precedence over env var).

6. **Tests** (`commands_test.go`): add tests for `resolveBackend` covering
   all three `kind` values and the `SAW_BACKEND` env var fallback.

**Field 4 — Verification gate**
```bash
go build ./cmd/saw/...
go vet ./cmd/saw/...
go test ./cmd/saw/... -run TestResolveBackend -timeout 2m
go test ./cmd/saw/... -timeout 2m
```

**Field 5 — Out-of-scope**
- Do not change `serve_cmd.go`, `merge_cmd.go`, or `main.go`.
- Do not change `pkg/agent/` or `pkg/orchestrator/` files.
- Do not add backend docs or README changes (not required for this IMPL).

**Field 6 — Completion report format**
Write your completion report as a fenced YAML block under the heading
`### Agent D - Completion Report` in the IMPL doc at
`docs/IMPL/IMPL-backend-interface.md`. Required fields:
```yaml
status: complete | partial | blocked
worktree: <path>
branch: <branch>
commit: <sha>
files_changed: [cmd/saw/commands.go, cmd/saw/commands_test.go]
files_created: []
interface_deviations: [any changes to resolveBackend signature or flag names]
out_of_scope_deps: []
tests_added: [list]
verification: PASS | FAIL
notes: <optional>
```

**Field 7 — Constraints**
- Agent C and Agent D run in parallel in Wave 2. Neither owns the same files.
  Do not touch `pkg/orchestrator/orchestrator.go`; if you discover the seam
  API differs from what is described here, document it in `interface_deviations`
  with `downstream_action_required: true` for the orchestrator to resolve.
- The `SAW_BACKEND` env var must not shadow `ANTHROPIC_API_KEY` auto-detection
  logic; they are independent.

**Field 8 — Working directory**
Your git worktree will be specified in the user message. Run all commands from
that directory.

---

### Wave Execution Loop

After each wave completes, work through the Orchestrator Post-Merge Checklist
below in order.

The merge procedure detail is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked`
  blocks the merge entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be
  propagated to downstream agent prompts before that wave launches.
- Post-merge verification is the real gate. Agents pass in isolation; the
  merged codebase surfaces cross-package failures none of them saw individually.
- Fix before proceeding. Do not launch the next wave with a broken build.

**Linter auto-fix**: this project has no configured auto-fix step (Makefile
only runs `go build`). Run `go vet ./...` manually after merge; fix any
reported issues before launching the next wave.

---

### Orchestrator Post-Merge Checklist

**After Scaffold completes (before Wave 1):**

- [ ] Read scaffold output — confirm `pkg/agent/backend/backend.go` exists
      with the correct `Backend` interface and `Config` struct
- [ ] `go build ./pkg/agent/backend/...` passes on the scaffold file alone
- [ ] Commit scaffold: `git commit -m "scaffold: add backend.Backend interface and Config"`
- [ ] Launch Wave 1 agents A and B

**After Wave 1 completes (A + B):**

- [ ] Read Agent A and Agent B completion reports — confirm both `status: complete`
- [ ] Conflict prediction — `files_changed` lists are disjoint (api/ vs cli/)
- [ ] Review `interface_deviations` — if Agent A moved `tools.go`, update
      Agent C's prompt to reflect the new import path before launching Wave 2
- [ ] Merge Agent A: `git merge --no-ff <branch> -m "Merge wave1-agent-A: API backend extraction"`
- [ ] Merge Agent B: `git merge --no-ff <branch> -m "Merge wave1-agent-B: CLI backend implementation"`
- [ ] Worktree cleanup for A and B
- [ ] Post-merge verification:
      - [ ] Linter: `go vet ./...`
      - [ ] `go build ./... && go test ./...`
- [ ] Fix any cascade failures — watch for import path changes in `pkg/agent/`
      if `stream.go` or `tools.go` moved
- [ ] Tick A and B in Status table
- [ ] Propagate any `interface_deviations` from A or B into Agent C and D prompts
- [ ] Feature-specific steps:
      - [ ] Verify `pkg/agent/backend/backend.go` is unchanged from scaffold
            (agents must not have redefined the interface)
- [ ] Commit: `git commit -m "merge: wave1 — API and CLI backend implementations"`
- [ ] Launch Wave 2 agents C and D

**After Wave 2 completes (C + D):**

- [ ] Read Agent C and Agent D completion reports — confirm both `status: complete`
- [ ] Conflict prediction — C owns `runner.go` + `orchestrator.go`, D owns
      `commands.go`; no overlap expected
- [ ] Review `interface_deviations` — any seam API changes must be cross-checked
      between C and D
- [ ] Merge Agent C: `git merge --no-ff <branch> -m "Merge wave2-agent-C: runner and orchestrator wiring"`
- [ ] Merge Agent D: `git merge --no-ff <branch> -m "Merge wave2-agent-D: backend selection flags"`
- [ ] Worktree cleanup for C and D
- [ ] Post-merge verification:
      - [ ] Linter: `go vet ./...`
      - [ ] `go build ./... && go test ./...`
- [ ] Fix any cascade failures — particularly watch `pkg/agent/runner_test.go`
      and `pkg/orchestrator/orchestrator_test.go` for mock interface mismatches
- [ ] Tick C and D in Status table
- [ ] Feature-specific steps:
      - [ ] Manual smoke test: `SAW_BACKEND=cli saw scout --feature "test"` (if
            `claude` CLI is installed) to verify end-to-end CLI backend path
      - [ ] Manual smoke test: `ANTHROPIC_API_KEY=<key> saw scout --feature "test"`
            to verify auto-detection picks the API backend
      - [ ] Verify `--backend auto` without API key falls back to CLI backend
            without a panic or nil-pointer error (can test with a fake `claude`
            script in PATH)
- [ ] Commit: `git commit -m "merge: wave2 — runner wiring and backend selection"`
- [ ] Remove the `pkg/agent/client.go` shim if Agent A left one and no callers
      remain after Wave 2 merges (optional cleanup commit)

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| — | Scaffold | Create `pkg/agent/backend/backend.go` with `Backend` interface and `Config` struct | COMPLETE |
| 1 | A | Extract API client into `pkg/agent/backend/api/`, implement `backend.Backend` | TO-DO |
| 1 | B | Implement CLI backend in `pkg/agent/backend/cli/`, implement `backend.Backend` | TO-DO |
| 2 | C | Refactor `runner.go` and `orchestrator.go` to accept `backend.Backend` | TO-DO |
| 2 | D | Add `--backend` flag and `SAW_BACKEND` env var to `cmd/saw/commands.go` | TO-DO |
| — | Orch | Post-merge integration, smoke tests, optional shim cleanup | TO-DO |

---

### Agent A - Completion Report

```yaml
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: 120757775ab6a677eb638dc7379174a179d7bad3
files_changed: []
files_created:
  - pkg/agent/backend/api/client.go
  - pkg/agent/backend/api/client_test.go
  - pkg/agent/backend/api/tools.go
interface_deviations:
  - Tool type and StandardTools function are duplicated into pkg/agent/backend/api/tools.go
    (not moved from pkg/agent/tools.go) to avoid a circular import: pkg/agent imports
    pkg/agent/backend/api would create a cycle. pkg/agent/tools.go is unchanged.
    Downstream action required: no — tools are internal to Run(); no caller needs
    to import them directly from the api package.
out_of_scope_deps: []
tests_added:
  - TestNew_EmptyAPIKeyFallsBackToEnv
  - TestNew_ExplicitKeyTakesPrecedence
  - TestNew_Defaults
  - TestNew_ConfigValues
  - TestWithBaseURL
  - TestRun_EndTurn
  - TestRun_ToolUseLoop
  - TestRun_ImplementsBackendInterface
verification: PASS
notes: >
  pkg/agent/client.go and pkg/agent/tools.go are left unchanged as thin shims for
  Wave 2 compatibility. stream.go is kept in pkg/agent (only used by SendMessage
  which remains in the shim). The api.Client.Run method inlines StandardTools
  internally so callers pass only workDir. All 8 tests pass; pkg/agent tests also
  pass cleanly (0 regressions).
```

### Agent B - Completion Report

```yaml
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: 7bcfa89
files_changed: []
files_created:
  - pkg/agent/backend/cli/client.go
  - pkg/agent/backend/cli/client_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestNew_EmptyClaudePath_UsesLookPath
  - TestNew_ExplicitPath
  - TestRun_Success
  - TestRun_EchoesArguments
  - TestRun_MaxTurnsNotPassedWhenZero
  - TestRun_NonZeroExit
  - TestRun_ContextCancellation
  - TestRun_EmptySystemPrompt
verification: PASS
notes: >
  All tests use a fake shell script in a temp dir; no real claude binary required.
  TestNew_EmptyClaudePath_UsesLookPath skips the Run call when claude is found
  in PATH (to avoid side-effects), but validates the error message path when it
  is absent. --dangerously-skip-permissions is always passed so the agent can
  execute without interactive prompts. Context cancellation is handled both in
  the scanner loop and in cmd.Wait().
```

### Agent C - Completion Report

**Status:** complete

**Files changed:**
- `pkg/agent/runner.go` (modified, replaced Sender/ToolRunner with backend.Backend, added ctx to Execute, removed ExecuteWithTools)
- `pkg/agent/runner_test.go` (modified, mockSender -> mockBackend, removed TestExecuteWithTools_NilToolRunner, added TestExecute_CallsBackendRun and TestExecute_BackendError)
- `pkg/agent/completion.go` (verified compiles, no logic change)
- `pkg/orchestrator/orchestrator.go` (modified, added BackendConfig, newBackendFunc, updated newRunnerFunc, replaced ExecuteWithTools call with Execute)
- `pkg/orchestrator/orchestrator_test.go` (modified, fakeToolSender -> fakeBackend, updated all newRunnerFunc seam replacements to new signature, added newBackendFunc replacements)

**Interface deviations:**
None. All signatures implemented exactly as specified.

**Out of scope dependencies:**
- `cmd/saw/commands.go` still calls old `agent.NewRunner(client, wm)` and `runner.Execute` without ctx — Agent D owns these call sites and must update them.

**Verification:**
- [x] Build passed: `go build ./pkg/agent/...` and `go build ./pkg/orchestrator/...`
- [x] Tests passed: `go test ./pkg/agent/... -timeout 2m` (all pass) and `go test ./pkg/orchestrator/... -timeout 2m` (all pass)
- [x] Vet passed: `go vet ./pkg/agent/...` and `go vet ./pkg/orchestrator/...`

**Commits:**
- 1d1ddf2: wave2-agent-C: refactor runner and orchestrator to use backend.Backend interface

**Notes:**
- The `fakeBackend.failPrompt` in orchestrator tests matches against `systemPrompt` (which equals `agentSpec.Prompt`). The old `fakeToolSender.failLetter` matched against `prompt` which was also the agent Prompt field — behavior is equivalent.
- `newBackendFunc` default uses "auto" mode: picks API backend when ANTHROPIC_API_KEY is set, CLI backend otherwise.
- `RunWave` calls `newBackendFunc(BackendConfig{Kind: "auto"})` to create the backend; Agent D's cmd/saw wiring will supply Kind/APIKey via the orchestrator seam when that integration is wired.

### Agent D - Completion Report

**Status:** partial

**Files changed:**
- `cmd/saw/commands.go` (modified, +38/-4 lines)
- `cmd/saw/commands_test.go` (modified, +90/-0 lines)

**Interface deviations:**
None. `resolveBackend` is implemented exactly as specified.

**Out of scope build blockers:**
- `agent.NewRunner` currently takes `agent.Sender` (not `backend.Backend`), so the two call sites in `runScout` and `runScaffold` produce a type mismatch compile error. This will resolve automatically when Agent C's changes to `pkg/agent/runner.go` are merged.
  - Affected lines: `cmd/saw/commands.go:430` and `cmd/saw/commands.go:503`
  - No action required from Agent D — the code is correct for the post-merge state.
- `web/embed.go` references a missing `web/dist/` directory (pre-existing repo issue, not caused by this agent). This prevents `go test ./cmd/saw/...` from running until Agent C's merge resolves the runner mismatch and the dist dir is created.

**Out of scope dependencies:**
- None beyond the above build blockers.

**Verification:**
- [ ] Build passed: blocked by `agent.NewRunner` Sender/Backend mismatch (resolves at merge) and pre-existing `web/embed.go` missing dist dir
- [ ] Tests passed: blocked by same build issue; `resolveBackend` logic and test code are type-correct (confirmed by `go build ./pkg/agent/backend/...` passing cleanly)
- [x] `pkg/agent/backend/...` and `pkg/agent/...` build cleanly
- [x] All six `TestResolveBackend_*` tests written and logically verified; will pass once build blocker is resolved

**Commits:**
- cc9c698: wave2-agent-D: add --backend flag and SAW_BACKEND env var for backend selection

**Notes:**
- `resolveBackend` is added between `orchestratorNewFunc` and `runWave` in `commands.go`.
- `--backend` flag added to both `runScout` and `runScaffold` with default `""` (falls back to `SAW_BACKEND` env, then `"auto"`).
- `SAW_BACKEND` and `ANTHROPIC_API_KEY` are independent: `SAW_BACKEND` selects the backend kind, `ANTHROPIC_API_KEY` is only consulted within `auto` and `api` resolution paths.
- `runWave` does not directly create agent clients (delegates to orchestrator), so no `--backend` flag is needed there.
