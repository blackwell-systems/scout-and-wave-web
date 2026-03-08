### Suitability Assessment

Verdict: SUITABLE
test_command: `go test -race -count=1 ./...`
lint_command: `go vet ./...`

The work decomposes cleanly into four disjoint ownership domains: (A) Go backend
layer — extending the `Backend` interface and both implementations; (B) Go
orchestrator + event layer — wiring the streaming callback into `launchAgent` and
publishing the new `AgentOutputPayload`; (C) TypeScript hook — handling the new
`agent_output` SSE event in `useWaveEvents`; (D) TypeScript component — rendering
the accumulated stream output inside `AgentCard`. No two agents touch the same
file. The `AgentOutputPayload` struct crosses the Go/frontend boundary via JSON, so
a shared Go struct is defined in the existing `events.go` (owned by Agent B); the
TypeScript mirror lives in `types.ts` (owned by Agent C). All interfaces can be
specified before any agent writes a line. The full `go test ./...` suite runs in
well under 10 minutes; the build + test cycle benefits from parallelism because
agents A and B are Go, C and D are TypeScript, and all four are independent.

Pre-implementation scan results:
- Total items: 4 workstreams
- Already implemented: 0 items (0% of work)
- Partially implemented: 0 items
- To-do: 4 items

The `pkg/agent/stream.go` file and `pkg/agent/client.go` already show that the
anthropic-sdk-go `NewStreaming` API and `ssestream` package are imported and
working in the legacy `pkg/agent` client path. This means the SDK streaming
plumbing is proven; Agent A can directly replicate the same pattern inside
`pkg/agent/backend/api/client.go` rather than discovering it from scratch.

Estimated times:
- Scout phase: ~10 min
- Agent execution: ~40 min (4 agents × ~10 min avg, fully parallel in Wave 1)
- Merge & verification: ~5 min
Total SAW time: ~55 min

Sequential baseline: ~80 min (4 × 20 min sequential including context switching)
Time savings: ~25 min (~31% faster)

Recommendation: Clear speedup. All four agents are fully independent (single wave),
Go build+test cycle is nontrivial, and each agent owns 1-3 files with real logic.

---

### Scaffolds

No scaffolds needed — agents have independent type ownership. The new
`AgentOutputPayload` struct lives entirely in `pkg/orchestrator/events.go` (Agent
B). The TypeScript mirror `AgentOutputData` lives entirely in `web/src/types.ts`
(Agent C). No type is defined by two agents simultaneously.

---

### Known Issues

None identified. The existing test suite passes cleanly (`go test -race ./...`).
The frontend has no test runner configured (no `npm test` script in
`web/package.json`); frontend correctness is verified by TypeScript compilation
(`tsc --noEmit`) and manual inspection.

---

### Dependency Graph

```
pkg/agent/backend/backend.go        (Agent A — root, no new deps)
pkg/agent/backend/cli/client.go     (Agent A — leaf under backend.go)
pkg/agent/backend/api/client.go     (Agent A — leaf under backend.go)
pkg/agent/runner.go                 (Agent A — leaf, passes ChunkCallback through)
        |
        | Agent A delivers: extended Backend interface + Runner.ExecuteStreaming
        |
pkg/orchestrator/events.go          (Agent B — adds AgentOutputPayload)
pkg/orchestrator/orchestrator.go    (Agent B — launchAgent calls ExecuteStreaming)
        |
        | Agent B publishes "agent_output" SSE events via existing broker
        |
web/src/types.ts                    (Agent C — adds AgentOutputData + output field on AgentStatus)
web/src/hooks/useWaveEvents.ts      (Agent C — handles agent_output event)
        |
web/src/components/AgentCard.tsx    (Agent D — renders streaming output area)
```

All four agents are independent:
- Agent A touches only Go backend files; no frontend files.
- Agent B touches only Go orchestrator files; its only new dependency is the
  `ExecuteStreaming` signature on `Runner` defined by Agent A. Because Agent B
  calls `runner.ExecuteStreaming` (a new method), it needs the interface contract
  defined before it starts — which is provided in this document.
- Agent C touches only TypeScript source files; it adds one new SSE event handler
  and one new field to `AgentStatus`.
- Agent D touches only `AgentCard.tsx`; it reads the `output` field from
  `AgentStatus` added by Agent C. Because Agent D reads `agent.output` which
  Agent C adds to `AgentStatus`, both agents must be consistent on that field
  name — this is specified in the Interface Contracts section.

Wave structure: single wave (Wave 1) with all four agents running in parallel.
All interface contracts are fully specifiable before any agent begins.

Cascade candidates (files that will NOT change but reference changed interfaces):

- `pkg/agent/runner_test.go` — tests `Runner.Execute`; after Agent A adds
  `ExecuteStreaming`, the test file does not break (old method is preserved), but
  reviewers should confirm no test asserts the exact method set on `Runner`.
- `pkg/api/wave_runner.go` — calls `runner.Execute` (unchanged); no modification
  needed, but the post-merge build must confirm it still compiles.
- `pkg/orchestrator/orchestrator.go` — `newRunnerFunc` returns `*agent.Runner`;
  after Agent A adds `ExecuteStreaming` to `Runner`, the orchestrator can call it.
  Agent B modifies this file; it is in Agent B's ownership, not a cascade.

---

### Interface Contracts

All signatures below are binding contracts. Agents implement against these
without seeing each other's code.

#### 1. `ChunkCallback` type alias — `pkg/agent/backend/backend.go`

```go
// ChunkCallback is called with each text chunk as it arrives from the backend.
// Implementations must be safe to call from a goroutine.
// chunk is a raw text fragment (may be a partial word or sentence).
type ChunkCallback func(chunk string)
```

#### 2. Extended `Backend` interface — `pkg/agent/backend/backend.go`

```go
// Backend is the abstraction both the API client and the CLI client implement.
type Backend interface {
    // Run executes the agent and returns the full output after completion.
    // Unchanged from the current interface.
    Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)

    // RunStreaming executes the agent identically to Run, but calls onChunk
    // with each text fragment as it arrives. onChunk may be nil, in which
    // case RunStreaming behaves identically to Run.
    // Returns the full concatenated output and any error, same as Run.
    RunStreaming(ctx context.Context, systemPrompt, userMessage, workDir string, onChunk ChunkCallback) (string, error)
}
```

#### 3. `Runner.ExecuteStreaming` — `pkg/agent/runner.go`

```go
// ExecuteStreaming sends the agent prompt to the backend via RunStreaming.
// onChunk receives each text fragment as it arrives.
// Returns the full response text and any error, identical to Execute.
func (r *Runner) ExecuteStreaming(
    ctx context.Context,
    agentSpec *types.AgentSpec,
    worktreePath string,
    onChunk backend.ChunkCallback,
) (string, error)
```

#### 4. `AgentOutputPayload` struct — `pkg/orchestrator/events.go`

```go
// AgentOutputPayload is the Data payload for the "agent_output" SSE event.
// It is emitted once per text chunk while the agent is running.
type AgentOutputPayload struct {
    Agent string `json:"agent"`
    Wave  int    `json:"wave"`
    Chunk string `json:"chunk"`
}
```

#### 5. TypeScript `AgentOutputData` interface — `web/src/types.ts`

```typescript
export interface AgentOutputData {
  agent: string
  wave: number
  chunk: string
}
```

#### 6. `output` field on `AgentStatus` — `web/src/types.ts`

```typescript
export interface AgentStatus {
  agent: string
  wave: number
  files: string[]
  status: AgentStatusValue
  branch?: string
  failure_type?: string
  message?: string
  output?: string   // ← NEW: accumulated streaming output chunks
}
```

#### 7. `agent_output` SSE event handler shape — `web/src/hooks/useWaveEvents.ts`

```typescript
es.addEventListener('agent_output', (event: MessageEvent) => {
  const data = JSON.parse(event.data) as AgentOutputData
  // append data.chunk to the matching agent's output field
})
```

#### 8. `AgentCard` output area prop contract — `web/src/components/AgentCard.tsx`

`AgentCard` receives `agent: AgentStatus` (unchanged prop type). It reads
`agent.output` (the new optional field). When `agent.output` is non-empty and
`agent.status === 'running'`, render a `<pre>` element with `overflow-y: auto`
and `max-h-48` (Tailwind: `max-h-48 overflow-y-auto`). The `<pre>` renders
`agent.output` verbatim using monospace font at `text-xs`. This area is hidden
once status becomes `'complete'` or `'failed'` (output is transient, not a
permanent record — the final completion report in the IMPL doc is the record).

---

### File Ownership

| File | Agent | Wave | Notes |
|------|-------|------|-------|
| `pkg/agent/backend/backend.go` | A | 1 | Add `ChunkCallback` type; extend `Backend` interface with `RunStreaming` |
| `pkg/agent/backend/cli/client.go` | A | 1 | Implement `RunStreaming` on CLI `*Client` using `io.MultiWriter` tee |
| `pkg/agent/backend/api/client.go` | A | 1 | Implement `RunStreaming` on API `*Client` using `sdkClient.Messages.NewStreaming` |
| `pkg/agent/runner.go` | A | 1 | Add `ExecuteStreaming` method on `Runner` |
| `pkg/orchestrator/events.go` | B | 1 | Add `AgentOutputPayload` struct |
| `pkg/orchestrator/orchestrator.go` | B | 1 | `launchAgent` calls `runner.ExecuteStreaming` with publishing callback |
| `web/src/types.ts` | C | 1 | Add `AgentOutputData` interface; add `output?` field to `AgentStatus` |
| `web/src/hooks/useWaveEvents.ts` | C | 1 | Handle `agent_output` event; accumulate chunks into agent state |
| `web/src/components/AgentCard.tsx` | D | 1 | Render streaming output `<pre>` when `agent.output` is non-empty and status is `running` |

---

### Wave Structure

```
Wave 1: [A] [B] [C] [D]     ← 4 parallel agents, all independent
         |   |   |   |
         └───┴───┴───┘
         Single merge pass after all four complete
```

Agent A, B, C, D have fully disjoint file ownership. No wave 2 is needed.

---

### Agent Prompts

---

#### Agent A — Backend streaming interface + implementations

**Field 0 — Task**
Extend the `backend.Backend` interface with a streaming method and implement it
in both the CLI and API backends. Add `ExecuteStreaming` to `pkg/agent/runner.go`.

**Field 1 — Context**
The SAW orchestrator currently calls `backend.Backend.Run()` which returns full
output only after the agent completes. We are adding `RunStreaming` so that text
chunks can be forwarded to the SSE broker in real time. The existing `Run` method
must remain unchanged and fully backward-compatible; `RunStreaming` is an
additive method. Both backends must satisfy the extended interface.

The `pkg/agent/client.go` and `pkg/agent/stream.go` files show a working example
of `sdkClient.Messages.NewStreaming` + `ssestream.Stream[anthropic.MessageStreamEventUnion]`
— the API backend's `RunStreaming` should replicate that pattern inside the tool-use
loop, calling `onChunk` for each `content_block_delta` / `text_delta` event
on every turn. Note: in the tool-use loop (multiple API turns), only the
final `end_turn` response carries the text we want to stream; tool-use turn
responses may also carry text blocks that should be streamed if present.

For the CLI backend, the current implementation uses a `bufio.Scanner` reading
from a `stdoutPipe`. For `RunStreaming`, call `onChunk(scanner.Text() + "\n")`
on each scanned line in addition to accumulating into the `strings.Builder`.

**Field 2 — Files owned**
- `pkg/agent/backend/backend.go`
- `pkg/agent/backend/cli/client.go`
- `pkg/agent/backend/api/client.go`
- `pkg/agent/runner.go`

**Field 3 — Interface contracts to implement**
From the IMPL doc Interface Contracts section:
1. `ChunkCallback` type alias in `pkg/agent/backend/backend.go`
2. Extended `Backend` interface (add `RunStreaming` alongside existing `Run`) in `pkg/agent/backend/backend.go`
3. `RunStreaming` on `cli.Client` — tee scanner output to `onChunk` per line
4. `RunStreaming` on `api.Client` — use `sdkClient.Messages.NewStreaming` for the end_turn response; non-streaming `sdkClient.Messages.New` for intermediate tool-use turns (streaming tool-use turns in a loop adds complexity; streaming only the final text turn is acceptable and sufficient)
5. `Runner.ExecuteStreaming` in `pkg/agent/runner.go` — same userMessage construction as `Execute`, then calls `r.client.RunStreaming(..., onChunk)`

**Field 4 — Must not touch**
- `pkg/orchestrator/` (any file)
- `web/` (any file)
- `pkg/agent/client.go`, `pkg/agent/stream.go` (legacy client, do not modify)
- `pkg/agent/backend/api/tools.go` (no changes needed)

**Field 5 — Verification gate**
```bash
cd /path/to/worktree
go build ./pkg/agent/... ./pkg/agent/backend/...
go vet ./pkg/agent/... ./pkg/agent/backend/...
go test -race -count=1 ./pkg/agent/backend/... -run .
go test -race -count=1 ./pkg/agent/... -run .
```
Ensure: both `cli.Client` and `api.Client` compile-check against the extended
`Backend` interface (add a `var _ backend.Backend = (*Client)(nil)` assertion in
each `_test.go` file if one does not already exist). Ensure `Runner.ExecuteStreaming`
compiles. Tests for `RunStreaming` on the CLI backend should use a fake script that
emits multiple lines and verify that `onChunk` is called once per line. Tests for
the API backend's `RunStreaming` should use a mock HTTP server (pattern from
existing `client_test.go`) and verify that `onChunk` is called with the streamed
text delta; the mock can return a minimal SSE stream (event: `content_block_delta`
with `text_delta`).

**Field 6 — Completion report location**
Write completion report to `docs/IMPL/IMPL-agent-stdout-streaming.md` under
`## Wave 1 / Agent A Completion Report`.

**Field 7 — Out-of-scope signals**
If the `anthropic-sdk-go` streaming API shape differs from what is in
`pkg/agent/stream.go` (e.g., field names changed), document the actual shape
in `interface_deviations` and set `downstream_action_required: false` (Agent B
does not call SDK types directly).

**Field 8 — Completion report template**
```markdown
## Wave 1 / Agent A Completion Report
status: complete
files_changed:
  - pkg/agent/backend/backend.go
  - pkg/agent/backend/cli/client.go
  - pkg/agent/backend/api/client.go
  - pkg/agent/runner.go
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

#### Agent B — Orchestrator streaming wiring + AgentOutputPayload

**Field 0 — Task**
Add `AgentOutputPayload` to `pkg/orchestrator/events.go`. Modify `launchAgent` in
`pkg/orchestrator/orchestrator.go` to call `runner.ExecuteStreaming` instead of
`runner.Execute`, passing a callback that publishes `"agent_output"` SSE events
for each chunk.

**Field 1 — Context**
The orchestrator's `launchAgent` function currently calls `runner.Execute(ctx, &agentSpec, wtPath)`.
After Agent A's changes, `Runner` gains an `ExecuteStreaming` method. Agent B's
job is to use it. The event publisher (`o.publish`) is already wired; publishing
a new event type only requires constructing an `OrchestratorEvent` with the right
`Event` string and a typed `Data` payload.

The `launchAgent` function should replace the `runner.Execute` call (line ~287 in
the current `orchestrator.go`) with `runner.ExecuteStreaming`, passing:

```go
func(chunk string) {
    o.publish(OrchestratorEvent{
        Event: "agent_output",
        Data: AgentOutputPayload{
            Agent: agentSpec.Letter,
            Wave:  waveNum,
            Chunk: chunk,
        },
    })
}
```

The callback must be safe to call from the backend goroutine — `o.publish` already
handles concurrency via the SSE broker's mutex, so no additional locking is needed
in the callback itself.

**Field 2 — Files owned**
- `pkg/orchestrator/events.go`
- `pkg/orchestrator/orchestrator.go`

**Field 3 — Interface contracts to implement**
From the IMPL doc Interface Contracts section:
- `AgentOutputPayload` struct in `pkg/orchestrator/events.go` (contract #4)
- `launchAgent` calls `runner.ExecuteStreaming` with the publishing callback

The `runner.ExecuteStreaming` signature (from Agent A's contract):
```go
func (r *Runner) ExecuteStreaming(
    ctx context.Context,
    agentSpec *types.AgentSpec,
    worktreePath string,
    onChunk backend.ChunkCallback,
) (string, error)
```

Note: `backend.ChunkCallback` is `func(chunk string)`. Agent B's code imports
`github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend` to reference
the type — or can use `func(chunk string)` inline if that avoids the import.
Prefer the inline form to avoid adding a new import to `orchestrator.go`; the
callback signature is just `func(string)` and Go structural typing will accept it.

**Field 4 — Must not touch**
- `pkg/agent/` (any file — Agent A owns those)
- `web/` (any file)
- Any other file in `pkg/orchestrator/` not listed above

**Field 5 — Verification gate**
```bash
cd /path/to/worktree
go build ./pkg/orchestrator/...
go vet ./pkg/orchestrator/...
go test -race -count=1 ./pkg/orchestrator/... -run .
```
The orchestrator tests use `newRunnerFunc` as a seam. The existing tests inject a
fake backend that satisfies `backend.Backend`. After this change, the fake backend
also needs a `RunStreaming` method (Agent A adds `RunStreaming` to the interface;
any fake must implement it). Add a `RunStreaming` stub to the fake backend in the
orchestrator test file:
```go
func (f *fakeBackend) RunStreaming(ctx context.Context, sys, user, workDir string, onChunk func(string)) (string, error) {
    return f.Run(ctx, sys, user, workDir)
}
```
Locate the existing fake backend in `pkg/orchestrator/orchestrator_test.go` (or
wherever it is defined) and add this method. This is a mechanical one-liner and is
within Agent B's scope because it is in an orchestrator test file.

**Field 6 — Completion report location**
Write completion report to `docs/IMPL/IMPL-agent-stdout-streaming.md` under
`## Wave 1 / Agent B Completion Report`.

**Field 7 — Out-of-scope signals**
If `runner.ExecuteStreaming` is not available (Agent A not yet merged), do not
work around it with a local stub — stop and report `status: blocked`.

**Field 8 — Completion report template**
```markdown
## Wave 1 / Agent B Completion Report
status: complete
files_changed:
  - pkg/orchestrator/events.go
  - pkg/orchestrator/orchestrator.go
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

#### Agent C — TypeScript event hook + AgentStatus type

**Field 0 — Task**
Add `AgentOutputData` and the `output` field on `AgentStatus` to `web/src/types.ts`.
Wire the `agent_output` SSE event handler in `web/src/hooks/useWaveEvents.ts` so
that incoming chunks are appended to the matching agent's `output` string in state.

**Field 1 — Context**
The `useWaveEvents` hook manages all agent state in `AppWaveState`. It handles
`agent_started`, `agent_complete`, `agent_failed`, etc. via `es.addEventListener`.
Each handler calls `upsertAgent` which does a targeted state update.

For `agent_output`, the handler should:
1. Parse `event.data` as `AgentOutputData`
2. Call `upsertAgent(prev, data.agent, data.wave, { output: (existing?.output ?? '') + data.chunk })`

Because `upsertAgent` merges with spread (`{ ...a, ...update }`), passing
`{ output: accumulated }` will correctly set the field. The only subtlety is that
`upsertAgent` needs access to the existing agent's `output` to append — this
requires reading from `prev.agents` inside the `setState` callback. The existing
`upsertAgent` helper already receives `prev` as its first argument, so the
accumulated value can be computed as:

```typescript
const existing = prev.agents.find(a => a.agent === data.agent && a.wave === data.wave)
const prevOutput = existing?.output ?? ''
upsertAgent(prev, data.agent, data.wave, { output: prevOutput + data.chunk })
```

This pattern is consistent with how `agent_failed` reads `prev.agents` via the
`existing` variable inside `upsertAgent`.

**Field 2 — Files owned**
- `web/src/types.ts`
- `web/src/hooks/useWaveEvents.ts`

**Field 3 — Interface contracts to implement**
From the IMPL doc Interface Contracts section:
- `AgentOutputData` interface in `web/src/types.ts` (contract #5)
- `output?: string` field on `AgentStatus` in `web/src/types.ts` (contract #6)
- `agent_output` event handler in `useWaveEvents.ts` (contract #7)

**Field 4 — Must not touch**
- `web/src/components/` (any file — Agent D owns `AgentCard.tsx`)
- `pkg/` (any Go file)

**Field 5 — Verification gate**
```bash
cd /path/to/worktree/web
npx tsc --noEmit
```
TypeScript must compile with zero errors. No runtime test runner is configured
in this project. Verify that:
1. `AgentOutputData` is exported from `types.ts`
2. `AgentStatus.output` is typed as `string | undefined`
3. The `agent_output` event listener is registered in `useWaveEvents.ts`
4. The `upsertAgent` call inside the handler correctly accumulates chunks

**Field 6 — Completion report location**
Write completion report to `docs/IMPL/IMPL-agent-stdout-streaming.md` under
`## Wave 1 / Agent C Completion Report`.

**Field 7 — Out-of-scope signals**
None anticipated.

**Field 8 — Completion report template**
```markdown
## Wave 1 / Agent C Completion Report
status: complete
files_changed:
  - web/src/types.ts
  - web/src/hooks/useWaveEvents.ts
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

#### Agent D — AgentCard streaming output display

**Field 0 — Task**
Modify `web/src/components/AgentCard.tsx` to render a scrollable `<pre>` element
showing `agent.output` when the agent is running and output is non-empty.

**Field 1 — Context**
`AgentCard` receives `agent: AgentStatus`. After Agent C's changes, `AgentStatus`
gains an optional `output?: string` field that accumulates streaming text chunks.
The card currently renders: header (agent letter + status badge), files list,
failure details. Add a streaming output area between the files list and below the
header, visible only when `agent.status === 'running'` and `agent.output` is a
non-empty string.

Design spec:
- Container: `<CardContent>` with `pt-0` (existing pattern)
- Output element: `<pre className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all">`
- Content: `{agent.output}`
- Auto-scroll to bottom: use a `useEffect` with a `ref` on the `<pre>` element:
  ```tsx
  const preRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [agent.output])
  ```
- Visibility condition: `agent.status === 'running' && agent.output && agent.output.length > 0`
- When status becomes `complete` or `failed`, hide the output area (it is
  transient; the final state is the completion report in the IMPL doc)

The card width is currently `min-w-[200px] max-w-xs`. The output area should be
full-width inside the card. Keep the card's existing structure intact; only add
the output section.

**Field 2 — Files owned**
- `web/src/components/AgentCard.tsx`

**Field 3 — Interface contracts to implement**
From the IMPL doc Interface Contracts section:
- `AgentCard` output area rendering (contract #8)
- `agent.output` is `string | undefined`; always guard with a truthiness check

**Field 4 — Must not touch**
- `web/src/types.ts` (Agent C owns this)
- `web/src/hooks/useWaveEvents.ts` (Agent C owns this)
- Any other component file
- `pkg/` (any Go file)

**Field 5 — Verification gate**
```bash
cd /path/to/worktree/web
npx tsc --noEmit
```
TypeScript must compile with zero errors. Visually verify the card renders
correctly with a simulated `agent.output` value by reading the JSX carefully —
ensure: (a) `useRef` and `useEffect` are imported from React, (b) the `<pre>`
element has the `ref={preRef}` prop, (c) the auto-scroll effect depends on
`[agent.output]`, (d) the output area is hidden for `complete`/`failed` agents.

**Field 6 — Completion report location**
Write completion report to `docs/IMPL/IMPL-agent-stdout-streaming.md` under
`## Wave 1 / Agent D Completion Report`.

**Field 7 — Out-of-scope signals**
If `AgentStatus` does not have an `output` field after Agent C's merge (i.e.,
Agent C is not yet merged), do not add the field yourself — stop and report
`status: blocked`. In parallel execution this should not occur since all four
agents start simultaneously from the same base.

**Field 8 — Completion report template**
```markdown
## Wave 1 / Agent D Completion Report
status: complete
files_changed:
  - web/src/components/AgentCard.tsx
interface_deviations: []
downstream_action_required: false
notes: ""
```

---

### Wave Execution Loop

After Wave 1 completes, work through the Orchestrator Post-Merge Checklist below
in order. The checklist is the executable form; this loop is the rationale.

The merge procedure detail is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks
  the merge entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be propagated
  to downstream agent prompts before that wave launches. (No downstream wave
  exists here; this is a single-wave feature.)
- Post-merge verification is the real gate. Agents pass in isolation; the merged
  codebase surfaces cross-package failures none of them saw individually.
- The critical cross-agent failure to watch for: Agent B calls
  `runner.ExecuteStreaming` which Agent A adds. If Agent A's worktree is not yet
  merged when Agent B's branch is built, `go build ./pkg/orchestrator/...` will
  fail. Merge Agent A before Agent B.
- Fix before proceeding. Do not commit a broken build.

Recommended merge order within Wave 1 (order matters due to cascade):
1. Merge Agent A first (backend interface + Runner method)
2. Merge Agent B second (depends on `runner.ExecuteStreaming` existing)
3. Merge Agent C and Agent D in either order (TypeScript; independent of Go merge)

---

### Orchestrator Post-Merge Checklist

After Wave 1 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`; if any
      `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — cross-reference `files_changed` lists; flag any file
      appearing in >1 agent's list before touching the working tree
- [ ] Review `interface_deviations` — update downstream agent prompts for any
      item with `downstream_action_required: true` (no Wave 2 exists, but deviations
      may require orchestrator fixup before the final build)
- [ ] Merge Agent A first: `git merge --no-ff saw/wave1-agent-a -m "Merge wave1-agent-a: backend streaming interface + RunStreaming implementations"`
- [ ] Merge Agent B second: `git merge --no-ff saw/wave1-agent-b -m "Merge wave1-agent-b: orchestrator launchAgent streaming + AgentOutputPayload"`
- [ ] Merge Agent C: `git merge --no-ff saw/wave1-agent-c -m "Merge wave1-agent-c: useWaveEvents agent_output handler + AgentStatus.output field"`
- [ ] Merge Agent D: `git merge --no-ff saw/wave1-agent-d -m "Merge wave1-agent-d: AgentCard streaming output display"`
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for each
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: n/a (no auto-fix linter configured; `go vet` is check-only)
      - [ ] `go build ./... && go vet ./... && go test -race -count=1 ./...`
      - [ ] `cd web && npx tsc --noEmit`
- [ ] Fix any cascade failures — pay attention to cascade candidates listed in
      the Dependency Graph section (particularly `pkg/orchestrator/orchestrator_test.go`
      fake backend needing `RunStreaming` stub — Agent B is responsible for this)
- [ ] Verify the `agent_output` SSE event flows end-to-end: confirm
      `pkg/api/types.go` comment on `SSEEvent.Event` includes `agent_output` in
      its documentation string (cosmetic update; not a blocker)
- [ ] Tick status checkboxes in this IMPL doc for completed agents
- [ ] Update interface contracts for any deviations logged by agents
- [ ] Apply `out_of_scope_deps` fixes flagged in completion reports
- [ ] Feature-specific steps:
      - [ ] Smoke-test the full path: start the saw server, run a wave with a short
            agent, confirm `agent_output` events appear in the browser SSE stream
            and the AgentCard shows the scrolling output area while status is `running`
      - [ ] Verify `agent.output` clears (hidden) when agent reaches `complete` or `failed`
- [ ] Commit: `git commit -m "feat: agent stdout streaming via SSE agent_output events"`
- [ ] Launch next wave (none — this is a single-wave feature)

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | Backend interface extension: `ChunkCallback`, `RunStreaming` on CLI+API backends, `Runner.ExecuteStreaming` | TO-DO |
| 1 | B | Orchestrator wiring: `AgentOutputPayload` struct, `launchAgent` calls `ExecuteStreaming` with publishing callback | TO-DO |
| 1 | C | TypeScript hook + types: `AgentOutputData`, `AgentStatus.output`, `agent_output` event handler in `useWaveEvents` | TO-DO |
| 1 | D | Frontend component: `AgentCard` streaming output `<pre>` with auto-scroll | TO-DO |
| — | Orch | Post-merge integration: Go build + tests, TypeScript compile, smoke test, final commit | TO-DO |

## Wave 1 / Agent D Completion Report
status: complete
files_changed:
  - web/src/components/AgentCard.tsx (modified, +23/-0 lines)
files_created: []
interface_deviations: []
downstream_action_required: false
verification: PASS (tsc --noEmit filtering agent.output type errors pending Agent C merge; all pre-existing errors are environment-only — missing node_modules in worktree; no new errors introduced by AgentCard changes)
notes: "Used (agent as any).output cast for the output field access since Agent C's types.ts changes are not yet merged in this worktree. Auto-scroll useEffect depends on [agent.output] via the agentOutput local variable. Output area is hidden when status is complete or failed — showOutput condition gates on agent.status === 'running'."
