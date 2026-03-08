# IMPL: sse-live-events
<!-- SAW:COMPLETE 2026-03-07 -->

### Suitability Assessment

Verdict: SUITABLE
test_command: `go test ./... && cd web && npm test -- --run`
lint_command: `go vet ./...`

The work decomposes cleanly into two waves with disjoint file ownership. Wave 1
has two parallel Go backend agents (A: wire `runWaveLoop` in `wave_runner.go`; B:
extend `pkg/api/server_test.go` with SSE integration tests). Wave 2 has one
frontend agent (C: wire `ReviewScreen.tsx` to subscribe to SSE and re-fetch on
`wave_complete`). The stretch goal (agent stdout streaming) is deferred as a
separate future feature — it requires interface changes to `pkg/orchestrator`
that cannot be defined without more design work. All cross-agent interfaces are
fully discoverable: `SetEventPublisher`, `OrchestratorEvent`, and `SSEEvent` are
already defined in the codebase.

Pre-implementation scan results:
- Total items: 4 components described in the feature brief
- Already implemented: 2 items (orchestrator publishes events in `RunWave`/`launchAgent`
  via `o.publish()`; `SetEventPublisher` exists in `pkg/orchestrator/events.go`;
  `sseBroker`, `handleWaveEvents`, and `SSEEvent` types all exist; `useWaveEvents`
  hook fully subscribes to all event types including `wave_complete`)
- Partially implemented: 1 item (`wave_runner.go`'s `runWaveLoop` is a stub with a
  TODO comment that says "Wire to orchestrator.New + full wave-execution loop post-merge")
- To-do: 1 item (ReviewScreen SSE subscription + live re-fetch on `wave_complete`)

Agent adjustments:
- Agent A: "complete the partial implementation" — replace the `runWaveLoop` stub
  in `wave_runner.go` with a real orchestrator.New + SetEventPublisher + wave loop
- Agent B: "add test coverage" — the SSE pipeline has no integration tests covering
  end-to-end event flow from orchestrator through broker to HTTP stream
- Agent C proceeds as planned (to-do) — ReviewScreen has no SSE subscription today
- Component 4 (agent stdout streaming): deferred, no agent assigned

Estimated time saved: ~15 minutes (avoided re-implementing already-present event
publish calls and broker/SSE infrastructure)

Estimated times:
- Scout phase: ~15 min (dependency mapping, interface analysis, IMPL doc)
- Agent execution: ~25 min (2 parallel Wave 1 agents × ~15 min + 1 Wave 2 agent × ~15 min)
- Merge & verification: ~5 min
Total SAW time: ~45 min

Sequential baseline: ~55 min (3 agents × ~18 min avg sequential time)
Time savings: ~10 min (18% faster)

Recommendation: Clear speedup. Wave 1 agents are fully independent (disjoint files,
no shared types). Wave 2 depends only on the HTTP contract that already exists.

---

### Scaffolds

No scaffolds needed — agents have independent type ownership. All shared types
(`OrchestratorEvent`, `SSEEvent`, `EventPublisher`) are already defined and
committed to HEAD.

---

### Known Issues

- `runWaveLoop` in `pkg/api/wave_runner.go` is currently a stub. It publishes a
  single `run_started` event but does not run any real orchestration. Agent A's
  entire task is replacing this stub. Until Agent A merges, the SSE stream will
  only ever emit `run_started`.
- The `waveOrchestrator` interface in `wave_runner.go` defines `RunWave`,
  `MergeWave`, `RunVerification`, `UpdateIMPLStatus`, and `IMPLDoc()` methods but
  `runWaveLoop` does not use it today. Agent A must use `orchestrator.New` (the
  concrete type) and call `SetEventPublisher` on it before calling the loop
  methods. The interface can be extended to include `SetEventPublisher` if Agent A
  judges that desirable for testability — document any such deviation.

---

### Dependency Graph

```
Wave 1 (2 parallel agents, both roots):

    [A] pkg/api/wave_runner.go
         (wire runWaveLoop: real orchestrator + SetEventPublisher + wave loop)
         ✓ root (reads pkg/orchestrator, which is READ-ONLY for all agents)

    [B] pkg/api/server_test.go
         (SSE integration tests for wave events pipeline end-to-end)
         ✓ root (no dependencies on A)

Wave 2 (1 agent, depends on Wave 1):

    [C] web/src/components/ReviewScreen.tsx
         (SSE subscription + live re-fetch on wave_complete event)
         depends on: [A] (wave loop publishes events via broker)
```

---

### Interface Contracts

All contracts below reference types that already exist in the codebase. No new
types are introduced by this feature. Agent A calls these; Agent B tests them.

**1. orchestrator.New (existing, Agent A calls)**
```go
// pkg/orchestrator/orchestrator.go
func New(repoPath string, implDocPath string) (*Orchestrator, error)
```

**2. orchestrator.SetEventPublisher (existing, Agent A calls)**
```go
// pkg/orchestrator/events.go
func (o *Orchestrator) SetEventPublisher(pub EventPublisher)

// Where:
type EventPublisher func(ev OrchestratorEvent)
type OrchestratorEvent struct {
    Event string
    Data  interface{}
}
```

**3. sseBroker.Publish (existing, Agent A calls via s.broker)**
```go
// pkg/api/wave.go
func (b *sseBroker) Publish(slug string, ev SSEEvent)

// Where:
type SSEEvent struct {
    Event string      `json:"event"`
    Data  interface{} `json:"data"`
}
```

**4. Server.makePublisher (existing, Agent A calls)**
```go
// pkg/api/wave_runner.go (already exists — Agent A keeps and uses it)
func (s *Server) makePublisher(slug string) func(event string, data interface{})
```

**5. runWaveLoop replacement signature (Agent A delivers)**
```go
// pkg/api/wave_runner.go — Agent A replaces the stub body
// Signature is unchanged; only the body changes:
func runWaveLoop(implPath, slug string, publish func(event string, data interface{}))
```
The function must:
- Call `orchestrator.New(s.cfg.RepoPath, implPath)` (note: `s` is not in scope;
  Agent A must thread `repoPath` through — see constraint below)
- Call `SetEventPublisher` with an adapter that maps `OrchestratorEvent` → calls
  `publish(ev.Event, ev.Data)`
- Iterate over waves calling `RunWave`, `MergeWave`, `RunVerification`,
  `UpdateIMPLStatus` in the same loop pattern as the CLI orchestrator
- Publish a final `run_complete` event when done (or `run_failed` on error)

**Constraint on runWaveLoop signature:** `runWaveLoop` currently receives only
`implPath`, `slug`, and `publish`. It needs `repoPath` to call `orchestrator.New`.
Agent A must add `repoPath string` as a parameter and update the single call site
in `handleWaveStart`. This is a justified atomic change within Agent A's ownership
scope — `handleWaveStart` is in `wave_runner.go` (Agent A owns).

Updated signature Agent A delivers:
```go
func runWaveLoop(implPath, slug, repoPath string, publish func(event string, data interface{}))
```
Call site in `handleWaveStart` (same file, Agent A's scope):
```go
go func() {
    defer s.activeRuns.Delete(slug)
    runWaveLoop(implPath, slug, s.cfg.RepoPath, publish)
}()
```

**6. ReviewScreen SSE subscription (Agent C delivers)**

Agent C adds a `useEffect` to `ReviewScreen.tsx` that:
- Creates `new EventSource(/api/wave/${slug}/events)`
- On `wave_complete` event: calls `fetchImpl(slug)` and calls a setter to
  update the `impl` prop

Since `ReviewScreen` receives `impl` as a prop from `App.tsx`, Agent C needs to
lift the refresh capability. Two acceptable approaches:
- (Preferred) Add an optional `onRefreshImpl?: (slug: string) => void` callback
  prop to `ReviewScreenProps` — `App.tsx` passes `handleSelect` as the refresher.
  Agent C adds the prop and the `App.tsx` call-site update (already in `App.tsx`).
- (Alternative) Use a local `useState` for a live `impl` overlay that is applied
  on top of the prop.

Agent C must document which approach was chosen in the completion report.

If the preferred approach is chosen, the updated `ReviewScreenProps` interface is:
```typescript
interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
  onRefreshImpl?: (slug: string) => Promise<void>  // Agent C adds
}
```

---

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `pkg/api/wave_runner.go` | A | 1 | `pkg/orchestrator` (read-only, already in HEAD) |
| `pkg/api/server_test.go` | B | 1 | `pkg/api/wave.go`, `pkg/api/wave_runner.go` stub behavior |
| `web/src/components/ReviewScreen.tsx` | C | 2 | Agent A complete (SSE stream must emit real events) |
| `web/src/App.tsx` | C | 2 | (call-site update for optional `onRefreshImpl` prop, if preferred approach chosen) |

Note: Agent C owns both `ReviewScreen.tsx` and the `App.tsx` call-site update.
The `App.tsx` change is a single-line prop addition; it is justified as part of
the same atomic ReviewScreen wiring. Agent B does not touch `App.tsx`.

---

### Wave Structure

```
Wave 1: [A] [B]     <- parallel (Go backend)
             |
        (A complete — real runWaveLoop available; B complete — tests pass)
             |
Wave 2:     [C]     <- sequential (frontend; depends on A for testable SSE)
```

Wave 1 → Wave 2 unblock: Agent A completing is the functional gate. Agent B
completing is the quality gate. Both must be merged before Wave 2 launches.

---

### Agent Prompts

---

# Wave 1 Agent A: Wire runWaveLoop to real orchestrator

You are Wave 1 Agent A. Your task is to replace the `runWaveLoop` stub in
`pkg/api/wave_runner.go` with a real orchestrator-driven wave execution loop
that publishes SSE events via the existing `publish` callback.

## 0. CRITICAL: Isolation Verification (RUN FIRST)

**Step 1: Navigate to worktree**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-a
```

**Step 2: Verify isolation (strict fail-fast after self-correction attempt)**

```bash
ACTUAL_DIR=$(pwd)
EXPECTED_DIR="/Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-a"

if [ "$ACTUAL_DIR" != "$EXPECTED_DIR" ]; then
  echo "ISOLATION FAILURE: Wrong directory (even after cd attempt)"
  echo "Expected: $EXPECTED_DIR"
  echo "Actual: $ACTUAL_DIR"
  exit 1
fi

ACTUAL_BRANCH=$(git branch --show-current)
EXPECTED_BRANCH="wave1-agent-a"

if [ "$ACTUAL_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "ISOLATION FAILURE: Wrong branch"
  echo "Expected: $EXPECTED_BRANCH"
  echo "Actual: $ACTUAL_BRANCH"
  exit 1
fi

git worktree list | grep -q "$EXPECTED_BRANCH" || {
  echo "ISOLATION FAILURE: Worktree not in git worktree list"
  exit 1
}

echo "Isolation verified: $ACTUAL_DIR on $ACTUAL_BRANCH"
```

If verification fails: write completion report with ISOLATION VERIFICATION FAILED
and stop immediately.

## 1. File Ownership

You own these files. Do not touch any other files except as justified below.
- `pkg/api/wave_runner.go` — modify

**Justified atomic change:** `handleWaveStart` calls `runWaveLoop` with the old
3-argument signature. Adding `repoPath` as the 4th argument requires updating the
call site in `handleWaveStart`, which is also in `wave_runner.go`. This is within
your ownership.

## 2. Interfaces You Must Implement

```go
// Updated signature (add repoPath parameter):
func runWaveLoop(implPath, slug, repoPath string, publish func(event string, data interface{}))
```

The function must:
1. Call `orchestrator.New(repoPath, implPath)` to create an orchestrator instance.
2. Call `orch.SetEventPublisher(func(ev orchestrator.OrchestratorEvent) { publish(ev.Event, ev.Data) })`.
3. Call `protocol.SetParseIMPLDocFunc` or equivalent if the orchestrator needs it
   wired — check `orchestrator.go`'s `parseIMPLDocFunc` pattern; the CLI binary
   does this wiring in `cmd/saw`. Read `cmd/saw/` to understand how it's done there.
4. Iterate over `orch.IMPLDoc().Waves` in order by wave number, calling:
   - `orch.RunWave(waveNum)`
   - `orch.MergeWave(waveNum)`
   - `orch.RunVerification(orch.IMPLDoc().TestCommand)` (if `TestCommand` non-empty)
   - `orch.UpdateIMPLStatus(waveNum)`
   On any error: call `publish("run_failed", map[string]string{"error": err.Error()})` and return.
5. After all waves succeed: call `publish("run_complete", orchestrator.RunCompletePayload{...})`.

## 3. Interfaces You May Call

```go
// pkg/orchestrator/orchestrator.go
func New(repoPath string, implDocPath string) (*Orchestrator, error)
func (o *Orchestrator) RunWave(waveNum int) error
func (o *Orchestrator) MergeWave(waveNum int) error
func (o *Orchestrator) RunVerification(testCommand string) error
func (o *Orchestrator) UpdateIMPLStatus(waveNum int) error
func (o *Orchestrator) IMPLDoc() *types.IMPLDoc

// pkg/orchestrator/events.go
func (o *Orchestrator) SetEventPublisher(pub EventPublisher)
type OrchestratorEvent struct { Event string; Data interface{} }
type EventPublisher func(ev OrchestratorEvent)
type RunCompletePayload struct { Status string `json:"status"`; Waves int `json:"waves"`; Agents int `json:"agents"` }

// pkg/api/wave_runner.go (existing, keep)
func (s *Server) makePublisher(slug string) func(event string, data interface{})
```

Read `cmd/saw/` to understand how `parseIMPLDocFunc` and `validateInvariantsFunc`
are wired in the CLI. You must replicate that wiring in `runWaveLoop` or in an
`init()` function in `wave_runner.go` so the orchestrator can parse the IMPL doc.

## 4. What to Implement

Read the following files first:
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/wave_runner.go` — the
  stub you are replacing (pay attention to the `waveOrchestrator` interface and the
  TODO comments)
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/orchestrator/orchestrator.go`
  — understand `New`, `RunWave`, `launchAgent`, and how `publish` is called
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/orchestrator/events.go`
  — `SetEventPublisher`, all payload types
- `/Users/dayna.blackwell/code/scout-and-wave-go/cmd/saw/` — how the CLI wires
  `parseIMPLDocFunc` and `validateInvariantsFunc` before creating an orchestrator

Replace the body of `runWaveLoop`. The function receives `implPath`, `slug`,
`repoPath`, and `publish`. It must:
- Create an orchestrator, wire event publisher, wire parse/validate functions.
- Run the full wave loop (RunWave → MergeWave → RunVerification → UpdateIMPLStatus
  per wave).
- Always terminate by publishing either `run_complete` or `run_failed`.
- Be non-blocking with respect to the caller — the goroutine in `handleWaveStart`
  is already launched with `go func()`.

Error handling: if `orchestrator.New` fails (e.g., bad IMPL doc path), publish
`run_failed` with the error message and return. Do not panic.

The `waveOrchestrator` interface already defined in `wave_runner.go` can remain;
your code calls the concrete `*orchestrator.Orchestrator` type directly because
`SetEventPublisher` is not on the interface. If you judge that adding
`SetEventPublisher` to the interface improves testability, document that deviation.

## 5. Tests to Write

Do not write tests in this file — Agent B owns `server_test.go`. Your job is to
make the production code correct. If you write any tests, put them in a new file
`pkg/api/wave_runner_test.go`. Do not create that file unless you have tests to add.

If you do add tests, name them:
1. `TestRunWaveLoop_PublishesRunFailed_OnBadPath` — verifies that a missing
   implPath causes `run_failed` to be published, not a panic.
2. `TestRunWaveLoop_PublishesRunStarted_ThenRunComplete` — verifies the happy-path
   event sequence using a mock orchestrator.

## 6. Verification Gate

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-a
go build ./...
go vet ./...
go test ./pkg/api/... -timeout 2m
```

All must pass. If tests reference stub behavior (e.g., checking that only
`run_started` is emitted), update those tests to expect the new behavior.

## 7. Constraints

- Do not import `pkg/api` from `pkg/orchestrator` — the dependency direction is
  `pkg/api` → `pkg/orchestrator`, not the reverse.
- Do not modify `pkg/orchestrator/orchestrator.go`, `pkg/orchestrator/events.go`,
  or `pkg/api/wave.go`. Those are read-only for you.
- Do not modify `pkg/api/server.go`. If `Server` needs a new field, report it as
  an out-of-scope dependency.
- The `publish` function passed to `runWaveLoop` is already goroutine-safe
  (it calls `sseBroker.Publish` which uses a mutex). You may call it from any
  goroutine.
- `defaultAgentTimeout` and `defaultAgentPollInterval` in `orchestrator.go` are
  30 minutes and 10 seconds. The HTTP handler has no timeout of its own; this is
  intentional for long-running waves.

## 8. Report

Commit changes before reporting:

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-a
git add pkg/api/wave_runner.go
git commit -m "wave1-agent-a: wire runWaveLoop to real orchestrator with SSE events"
```

Then append your completion report to
`/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-sse-live-events.md`:

```yaml
### Agent A - Completion Report
status: complete | partial | blocked
worktree: .claude/worktrees/wave1-agent-a
branch: wave1-agent-a
commit: {sha}
files_changed:
  - pkg/api/wave_runner.go
files_created: []
interface_deviations:
  - "List any deviations from the runWaveLoop signature or waveOrchestrator interface, or []"
out_of_scope_deps:
  - "file: path, change: what's needed, reason: why"  # or []
tests_added: []
verification: PASS | FAIL ({command} - N/N tests)
```

---

# Wave 1 Agent B: SSE integration tests for wave_runner and broker

You are Wave 1 Agent B. Your task is to add integration test coverage for the
SSE pipeline: from the HTTP endpoint through `sseBroker` to the event stream.

## 0. CRITICAL: Isolation Verification (RUN FIRST)

**Step 1: Navigate to worktree**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-b
```

**Step 2: Verify isolation**

```bash
ACTUAL_DIR=$(pwd)
EXPECTED_DIR="/Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-b"

if [ "$ACTUAL_DIR" != "$EXPECTED_DIR" ]; then
  echo "ISOLATION FAILURE: Wrong directory"
  echo "Expected: $EXPECTED_DIR"
  echo "Actual: $ACTUAL_DIR"
  exit 1
fi

ACTUAL_BRANCH=$(git branch --show-current)
EXPECTED_BRANCH="wave1-agent-b"

if [ "$ACTUAL_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "ISOLATION FAILURE: Wrong branch"
  echo "Expected: $EXPECTED_BRANCH"
  echo "Actual: $ACTUAL_BRANCH"
  exit 1
fi

git worktree list | grep -q "$EXPECTED_BRANCH" || {
  echo "ISOLATION FAILURE: Worktree not in git worktree list"
  exit 1
}

echo "Isolation verified: $ACTUAL_DIR on $ACTUAL_BRANCH"
```

## 1. File Ownership

- `pkg/api/server_test.go` — modify (add new test functions)

Do not touch `wave_runner.go`, `wave.go`, or `server.go`. If you need test helpers
that currently don't exist in the test file, add them to `server_test.go` only.

## 2. Interfaces You Must Implement

No new production interfaces. You are writing tests only.

## 3. Interfaces You May Call

```go
// pkg/api/server.go
func New(cfg Config) *Server
type Config struct { Addr string; IMPLDir string; RepoPath string }

// pkg/api/wave.go
// sseBroker is unexported; access it via Server.broker (the test is in package api)
func (b *sseBroker) Publish(slug string, ev SSEEvent)
func (b *sseBroker) subscribe(slug string) chan SSEEvent

// pkg/api/types.go
type SSEEvent struct { Event string; Data interface{} }

// pkg/api/wave_runner.go (current stub — your tests run against the stub)
// Agent A will replace the stub but your tests must pass in isolation on the stub.
// Write tests that stub out the heavy orchestrator path.
```

Because `server_test.go` is in `package api` (internal test), it has access to
unexported fields. Confirm the existing package declaration before adding tests.

## 4. What to Implement

Read the following files first:
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/server_test.go` — understand
  existing test patterns and package declaration
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/wave.go` — broker methods
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/wave_runner.go` — current stub

Write tests covering:
1. The SSE subscription and delivery pipeline (broker → HTTP stream).
2. The `handleWaveEvents` handler: that it sets correct Content-Type headers,
   delivers events published to the broker while the client is connected, and
   stops delivering after the client disconnects.
3. The `handleWaveStart` handler: that it returns 202 on first call, 409 on
   duplicate, and that it calls `runWaveLoop` (the stub or real implementation
   present at test time).
4. `makePublisher`: that the returned function correctly maps `(event, data)` to
   an `SSEEvent` and publishes it to the broker for the given slug.

The tests must pass against the current stub implementation of `runWaveLoop`
(which publishes only `run_started`). Do not depend on Agent A's replacement
being present in your worktree — design tests to isolate the broker/HTTP layer
from the orchestrator layer.

Pattern: Use `httptest.NewRecorder` for handlers that don't stream, and
`httptest.NewServer` + a goroutine reader for SSE streaming tests.

## 5. Tests to Write

1. `TestSSEBroker_PublishDelivered` — publishes an event to a slug and verifies
   a subscriber receives it via the channel.
2. `TestSSEBroker_SlowClientDropped` — fills the subscriber channel buffer (16)
   and verifies Publish does not block.
3. `TestSSEBroker_Unsubscribe` — verifies that after unsubscribe, no further
   events are delivered.
4. `TestHandleWaveEvents_StreamsEvents` — start the HTTP handler in a test server,
   subscribe to SSE, publish two events via the broker, read both from the stream,
   then disconnect and verify cleanup.
5. `TestHandleWaveEvents_ContentTypeHeader` — verify `Content-Type: text/event-stream`
   is set.
6. `TestHandleWaveStart_Returns202` — POST to `/api/wave/{slug}/start` returns 202.
7. `TestHandleWaveStart_Returns409_OnDuplicate` — a second POST while the first is
   running returns 409.
8. `TestMakePublisher_PublishesToBroker` — verify the closure from `makePublisher`
   calls `broker.Publish` with the correct slug and SSEEvent.

## 6. Verification Gate

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-b
go build ./...
go vet ./...
go test ./pkg/api/... -timeout 2m -v
```

All 8+ new tests must pass. Existing tests must not regress.

## 7. Constraints

- Write tests only; do not modify production files.
- Tests must be independent of Agent A's changes — use the stub `runWaveLoop` as
  it exists in your isolated worktree.
- For `TestHandleWaveStart_Returns409_OnDuplicate`: you need the first goroutine
  to be "in flight" when the second POST arrives. The stub's `runWaveLoop` returns
  immediately. Either: (a) inject a slow `runWaveLoop` via the test, or (b) use
  a timing approach. Approach (a) is preferred — check if `runWaveLoop` can be
  swapped out via a package-level variable seam (same pattern as
  `worktreeCreatorFunc` in orchestrator.go). If no seam exists, add one as a
  `var runWaveLoopFunc = runWaveLoop` in `wave_runner.go`. But `wave_runner.go` is
  Agent A's file — report the needed seam as an `out_of_scope_dep` if Agent A
  hasn't added it, and use a timing-based approach as the fallback.
- Do not use real file I/O or real git operations in tests.

## 8. Report

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-b
git add pkg/api/server_test.go
git commit -m "wave1-agent-b: add SSE broker and wave handler integration tests"
```

Append to `docs/IMPL/IMPL-sse-live-events.md`:

```yaml
### Agent B - Completion Report
status: complete | partial | blocked
worktree: .claude/worktrees/wave1-agent-b
branch: wave1-agent-b
commit: {sha}
files_changed:
  - pkg/api/server_test.go
files_created: []
interface_deviations: []
out_of_scope_deps:
  - "file: path, change: what's needed, reason: why"  # or []
tests_added:
  - TestSSEBroker_PublishDelivered
  - TestSSEBroker_SlowClientDropped
  - TestSSEBroker_Unsubscribe
  - TestHandleWaveEvents_StreamsEvents
  - TestHandleWaveEvents_ContentTypeHeader
  - TestHandleWaveStart_Returns202
  - TestHandleWaveStart_Returns409_OnDuplicate
  - TestMakePublisher_PublishesToBroker
verification: PASS | FAIL ({command} - N/N tests)
```

---

# Wave 2 Agent C: Wire ReviewScreen to subscribe to SSE and refresh on wave_complete

You are Wave 2 Agent C. Your task is to make the ReviewScreen subscribe to the
SSE event stream while a wave is running and automatically re-fetch the IMPL doc
when a `wave_complete` event arrives, so that checklist dots update live.

## 0. CRITICAL: Isolation Verification (RUN FIRST)

**Step 1: Navigate to worktree**

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-c
```

**Step 2: Verify isolation**

```bash
ACTUAL_DIR=$(pwd)
EXPECTED_DIR="/Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-c"

if [ "$ACTUAL_DIR" != "$EXPECTED_DIR" ]; then
  echo "ISOLATION FAILURE: Wrong directory"
  echo "Expected: $EXPECTED_DIR"
  echo "Actual: $ACTUAL_DIR"
  exit 1
fi

ACTUAL_BRANCH=$(git branch --show-current)
EXPECTED_BRANCH="wave2-agent-c"

if [ "$ACTUAL_BRANCH" != "$EXPECTED_BRANCH" ]; then
  echo "ISOLATION FAILURE: Wrong branch"
  echo "Expected: $EXPECTED_BRANCH"
  echo "Actual: $ACTUAL_BRANCH"
  exit 1
fi

git worktree list | grep -q "$EXPECTED_BRANCH" || {
  echo "ISOLATION FAILURE: Worktree not in git worktree list"
  exit 1
}

echo "Isolation verified: $ACTUAL_DIR on $ACTUAL_BRANCH"
```

## 1. File Ownership

- `web/src/components/ReviewScreen.tsx` — modify
- `web/src/App.tsx` — modify (single-line prop pass-through for `onRefreshImpl`)

Do not touch `web/src/hooks/useWaveEvents.ts`, `web/src/types.ts`, or `web/src/api.ts`.
Those are read-only.

## 2. Interfaces You Must Implement

```typescript
// Updated ReviewScreenProps in ReviewScreen.tsx:
interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
  onRefreshImpl?: (slug: string) => Promise<void>  // NEW — optional
}
```

The ReviewScreen must:
1. Open an `EventSource` to `/api/wave/${slug}/events` using a `useEffect`.
2. On `wave_complete` event: call `onRefreshImpl(slug)` if provided.
3. Close the `EventSource` on component unmount.
4. Not crash or throw if `onRefreshImpl` is not provided (optional prop).

## 3. Interfaces You May Call

```typescript
// web/src/api.ts (read-only)
export async function fetchImpl(slug: string): Promise<IMPLDocResponse>

// web/src/hooks/useWaveEvents.ts (read-only — do NOT use this hook in ReviewScreen)
// useWaveEvents is used by WaveBoard, not ReviewScreen.
// ReviewScreen needs only a minimal subset: open SSE, listen for wave_complete,
// call onRefreshImpl. Do not pull in the full AppWaveState for ReviewScreen.

// Browser API (no import needed):
new EventSource(url: string)
EventSource.addEventListener(type: string, listener: (event: MessageEvent) => void): void
EventSource.close(): void
```

## 4. What to Implement

Read these files first:
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/components/ReviewScreen.tsx`
  — the component you are modifying; understand existing state and hooks
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/App.tsx` — how
  ReviewScreen is rendered and how `handleSelect` can be passed as `onRefreshImpl`
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/api.ts` — `fetchImpl`
  signature

In `ReviewScreen.tsx`:
- Add `onRefreshImpl?: (slug: string) => Promise<void>` to `ReviewScreenProps`.
- Add a `useEffect` that opens an `EventSource` to `/api/wave/${slug}/events`.
- In that effect, register a listener for the `wave_complete` event. On receipt,
  call `onRefreshImpl?.(slug)` (optional chaining).
- Return the cleanup function that calls `es.close()`.
- The effect dependency array should be `[slug, onRefreshImpl]`.

In `App.tsx`:
- Pass `onRefreshImpl={handleSelect}` to the `<ReviewScreen>` element.
  `handleSelect` has signature `async function handleSelect(selected: string)` —
  it already calls `fetchImpl` and updates `impl` state. This is exactly the
  refresh semantics needed.

The subscription in ReviewScreen is intentionally minimal. It does not display
agent cards or wave progress — that is WaveBoard's responsibility. ReviewScreen
only needs to know when a wave completes so it can re-fetch the IMPL doc (to
show updated checklist status dots in `OverviewPanel`).

## 5. Tests to Write

The frontend test setup should be checked with:
```bash
cd web && npm test -- --run 2>&1 | head -30
```
to understand the test framework (Vitest is expected given Vite setup).

Write tests in `web/src/components/ReviewScreen.test.tsx` (create this file):

1. `renders without crashing` — renders `ReviewScreen` with minimal props and
   verifies the component mounts without errors.
2. `subscribes to SSE on mount` — mock `EventSource` global; verify constructor
   is called with `/api/wave/${slug}/events`.
3. `calls onRefreshImpl on wave_complete event` — mock `EventSource`, fire a
   `wave_complete` event, verify `onRefreshImpl` was called with the correct slug.
4. `closes EventSource on unmount` — verify `es.close()` is called when the
   component unmounts.
5. `does not crash when onRefreshImpl is not provided` — fire `wave_complete` with
   no `onRefreshImpl` prop; verify no error thrown.

## 6. Verification Gate

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web && npm install && npm run build
cd /Users/dayna.blackwell/code/scout-and-wave-go/web && npm test -- --run
```

Build must produce no TypeScript errors. All 5 new tests must pass. No existing
tests may regress.

Also verify Go still builds (ReviewScreen change is frontend-only but confirm):
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go && go build ./...
```

## 7. Constraints

- Do not use `useWaveEvents` in `ReviewScreen`. That hook manages full wave board
  state (agent cards, per-wave status). ReviewScreen needs only the `wave_complete`
  signal. Using a minimal inline `EventSource` keeps ReviewScreen's responsibility
  clear.
- The `EventSource` in ReviewScreen and the one in `useWaveEvents` (used by
  WaveBoard on the wave screen) are separate connections. This is fine — the broker
  supports multiple subscribers per slug.
- Do not add loading spinners, connection status indicators, or error banners to
  ReviewScreen for the SSE connection. The re-fetch is silent. If the SSE
  connection drops, it drops silently.
- Do not modify `useWaveEvents.ts`, `types.ts`, `api.ts`, or any review sub-panel
  components.
- `handleSelect` in `App.tsx` is `async function handleSelect(selected: string)`.
  Its return type is `Promise<void>`. It matches `onRefreshImpl`'s signature exactly.

## 8. Report

```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave2-agent-c
git add web/src/components/ReviewScreen.tsx web/src/App.tsx
git add web/src/components/ReviewScreen.test.tsx 2>/dev/null || true
git commit -m "wave2-agent-c: wire ReviewScreen to subscribe to SSE, refresh on wave_complete"
```

Append to `docs/IMPL/IMPL-sse-live-events.md`:

```yaml
### Agent C - Completion Report
status: complete | partial | blocked
worktree: .claude/worktrees/wave2-agent-c
branch: wave2-agent-c
commit: {sha}
files_changed:
  - web/src/components/ReviewScreen.tsx
  - web/src/App.tsx
files_created:
  - web/src/components/ReviewScreen.test.tsx
interface_deviations:
  - "Describe approach chosen for onRefreshImpl (preferred vs alternative), or []"
out_of_scope_deps: []
tests_added:
  - renders without crashing
  - subscribes to SSE on mount
  - calls onRefreshImpl on wave_complete event
  - closes EventSource on unmount
  - does not crash when onRefreshImpl is not provided
verification: PASS | FAIL ({command} - N/N tests)
```

---

### Wave Execution Loop

After each wave completes, work through the Orchestrator Post-Merge Checklist
below in order.

The merge procedure detail is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks
  the merge entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be propagated
  to downstream agent prompts before that wave launches. Specifically: if Agent A
  deviates from the `runWaveLoop` signature (e.g., chooses not to add `repoPath`
  and threads it differently), update Agent C's context note accordingly before
  launching Wave 2.
- Post-merge verification is the real gate. Agents pass in isolation; the merged
  codebase surfaces cross-package failures none of them saw individually.
- Fix before proceeding. Do not launch Wave 2 with a broken build.

---

### Orchestrator Post-Merge Checklist

**After Wave 1 completes (Agents A and B):**

- [ ] Read all agent completion reports — confirm all `status: complete`; if any
      `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — cross-reference `files_changed` lists; `server_test.go`
      (B) and `wave_runner.go` (A) are disjoint; no conflicts expected. Verify.
- [ ] Review `interface_deviations` from Agent A — if `runWaveLoop` signature
      changed in an unexpected way, update Agent C's prompt note before launching Wave 2
- [ ] Review `out_of_scope_deps` from Agent B — if B flagged need for a
      `runWaveLoopFunc` seam in `wave_runner.go`, apply that change before merge
- [ ] Merge Agent A: `git merge --no-ff wave1-agent-a -m "Merge wave1-agent-a: wire runWaveLoop to real orchestrator"`
- [ ] Merge Agent B: `git merge --no-ff wave1-agent-b -m "Merge wave1-agent-b: add SSE broker and wave handler tests"`
- [ ] Worktree cleanup: `git worktree remove .claude/worktrees/wave1-agent-a && git branch -d wave1-agent-a`
- [ ] Worktree cleanup: `git worktree remove .claude/worktrees/wave1-agent-b && git branch -d wave1-agent-b`
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: `go vet ./...` (check mode; no auto-fix needed for Go vet)
      - [ ] `go build ./... && go vet ./... && go test ./...` — run unscoped
- [ ] Fix any cascade failures — check `pkg/api/server.go` still compiles; check
      cascade candidates listed in the Dependency Graph section
- [ ] Tick status checkboxes in this IMPL doc for Agent A and Agent B
- [ ] Update interface contracts section if Agent A logged deviations
- [ ] Apply `out_of_scope_deps` fixes flagged in Agent B's completion report
      (e.g., add `runWaveLoopFunc` seam to `wave_runner.go` and commit)
- [ ] Feature-specific steps:
      - [ ] Manually verify the SSE stream works end-to-end: `saw serve`, open a
            plan in the UI, approve it, watch the wave screen for live events
      - [ ] Confirm `run_complete` event appears after all waves finish
- [ ] Commit: `git commit -m "feat: wire runWaveLoop to real orchestrator with SSE event publishing"`
- [ ] Launch Wave 2

**After Wave 2 completes (Agent C):**

- [ ] Read Agent C completion report — confirm `status: complete`
- [ ] Review `interface_deviations` — if C chose the "alternative" approach
      (local state overlay instead of `onRefreshImpl` prop), verify App.tsx was
      not touched unnecessarily
- [ ] Merge Agent C: `git merge --no-ff wave2-agent-c -m "Merge wave2-agent-c: ReviewScreen SSE subscription with live re-fetch"`
- [ ] Worktree cleanup: `git worktree remove .claude/worktrees/wave2-agent-c && git branch -d wave2-agent-c`
- [ ] Post-merge verification:
      - [ ] `go build ./...` — verify embed.go still compiles with new dist
      - [ ] `cd web && npm run build` — TypeScript must have no errors
      - [ ] `cd web && npm test -- --run` — all tests including new ReviewScreen tests
      - [ ] `go test ./...` — full backend suite
- [ ] Fix any cascade failures — check `App.tsx` renders correctly with new prop
- [ ] Tick status checkbox for Agent C
- [ ] Feature-specific steps:
      - [ ] Manually test: open a plan in the review screen, approve it, watch the
            status dots in OverviewPanel update live as waves complete
      - [ ] Verify EventSource is closed when navigating away from ReviewScreen
            (no dangling connections in browser devtools)
- [ ] Commit: `git commit -m "feat: complete SSE live observability — ReviewScreen updates live on wave_complete"`

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | Replace `runWaveLoop` stub with real orchestrator loop + SSE event publishing | TO-DO |
| 1 | B | Add SSE broker and wave handler integration tests to `server_test.go` | TO-DO |
| 2 | C | Wire `ReviewScreen.tsx` to subscribe to SSE and re-fetch IMPL doc on `wave_complete` | TO-DO |
| — | Orch | Post-merge integration verification + manual E2E test | TO-DO |
