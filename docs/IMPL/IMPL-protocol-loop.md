# IMPL: Protocol Loop — Completion Report Polling Fix

## Summary

Fixes the circular dependency in the SAW orchestrator where `launchAgent` polled
the main repo IMPL doc for agent completion reports, but agents write their reports
into the worktree copy of that file. The two paths never matched until after merge,
which itself requires completion first.

---

### Agent A - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: saw/wave1-agent-A
commit: b840d5af604c632ead72312a9f1bfa618a7846cd
files_changed:
  - pkg/orchestrator/orchestrator.go
  - pkg/orchestrator/orchestrator_test.go
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestWtIMPLPath (table-driven: standard nested path, IMPL at repo root, deeper nesting)
  - TestWtIMPLPath_Fallback (platform-safe fallback verification)
  - TestLaunchAgent_PollsWorktreeIMPLDoc (spy verifies worktree path reaches waitForCompletionFunc)
verification: PASS (go build ./..., go vet ./..., go test ./pkg/orchestrator/...)
```

**Key decisions:**

- `wtIMPLPath` uses `filepath.Rel(repoPath, implDocPath)` to extract the path
  segment relative to the repo root, then `filepath.Join(wtPath, rel)` to
  reconstruct it under the worktree root. Fallback to `implDocPath` on `Rel`
  error preserves safe behaviour on Windows cross-drive paths.

- The call site change is minimal: one argument to `waitForCompletionFunc` in
  `launchAgent`, after `wtPath` is known from `worktreeCreatorFunc`.

- `TestLaunchAgent_PollsWorktreeIMPLDoc` uses a spy closure replacing
  `waitForCompletionFunc` to record the `implDocPath` argument, then asserts
  it matches the worktree path and explicitly asserts it does NOT equal the main
  repo path — covering both the positive and negative invariants.

- `path/filepath` was added to imports in both `.go` files.

**No downstream action required.** The fix is self-contained within `launchAgent`
and the new helper. `WaitForCompletion` in `pkg/agent/completion.go` is unchanged.

---

# IMPL: Protocol Loop — Wave Gate & Control Endpoints

This document tracks the wave gate mechanism and control endpoint additions to the SAW server.

---

### Agent C - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-C
branch: saw/wave1-agent-C
commit: 8f7e83599216bb410c9b50c953573c441c7f4b86
files_changed:
  - pkg/api/wave_runner.go
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build ./..., go vet ./..., go test ./pkg/api/...)
```

**Implementation notes:**

1. `gateChannels sync.Map` — package-level, keyed by slug, values are `chan bool` (buffered 1). Created fresh per gate crossing, deleted after use in all code paths (proceed, cancel, timeout).

2. `runWaveLoop` gate logic — inserted after `UpdateIMPLStatus` for each wave except the last (`i < len(waves)-1`). Uses a `select` with a 30-minute `time.After` timeout. Publishes `wave_gate_pending` before blocking, `wave_gate_resolved` on true, `run_failed` on false or timeout.

3. `handleWaveGateProceed` — looks up slug in `gateChannels`, type-asserts to `chan bool`, does a non-blocking send of `true`. Returns 404 if no gate is pending for the slug (prevents silent no-ops on stale requests). Returns 202 on success.

4. `handleWaveAgentRerun` — stub only. Parses `slug` and `letter` from path values, returns 202 with a JSON body noting the stub status. Full implementation (re-spawning worktree, re-running agent, updating IMPL doc) is deferred.

**downstream_action_required: true**

The orchestrator must add the following route registrations to `pkg/api/server.go` in the `New()` function, after the existing `POST /api/wave/{slug}/start` line:

```go
s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)
s.mux.HandleFunc("POST /api/wave/{slug}/agent/{letter}/rerun", s.handleWaveAgentRerun)
```

**handleWaveAgentRerun follow-up required:** The stub returns 202 but performs no action. A follow-up task should implement: locating the agent's worktree, re-invoking the agent subprocess, collecting the new completion report, and updating IMPL doc status.

---

# IMPL: GUI-Driven Protocol Loop

## Suitability Assessment

Verdict: SUITABLE
test_command: `go test ./... && cd web && npm test -- --run`
lint_command: `go vet ./...`

This feature decomposes cleanly across backend Go packages and frontend React components with disjoint file ownership. Six distinct agents can work in parallel across two waves: Wave 1 fixes the completion report path bug and adds the Scout API endpoint (pure backend), while Wave 2 adds the Scout launcher screen, wave gate UI, and error recovery buttons (pure frontend). The backend agents in Wave 1 do not touch any frontend files; the frontend agents in Wave 2 do not touch any Go files. The completion report fix is the highest-priority item — it unblocks auto-merge — and is isolated to `pkg/orchestrator/orchestrator.go` and `pkg/agent/completion.go`.

Two additional agents (G and H) are added in a subsequent amendment to this IMPL doc: Agent G adds the IMPL doc raw read/write endpoints (`GET /api/impl/{slug}/raw`, `PUT /api/impl/{slug}/raw`), and Agent H adds the frontend IMPL editor panel. These fit cleanly into the existing wave structure with disjoint file ownership.

Estimated times:
- Scout phase: ~15 min (codebase analysis, interface design, IMPL doc)
- Agent execution: ~30 min (3 Wave 1 agents x 10 min avg, parallel; 3 Wave 2 agents x 12 min avg, parallel)
- Merge & verification: ~10 min (two waves)
Total SAW time: ~55 min

Sequential baseline: ~90 min (6 agents x 15 min avg)
Time savings: ~35 min (39% faster)

Recommendation: Clear speedup. Wave 1 and Wave 2 each have 3 fully independent agents.

**Pre-implementation scan results:**
- Total items: 6 work items
- Already implemented: 1 item (live agent output display — `AgentCard.tsx` already renders `agent.output`, `useWaveEvents.ts` already accumulates chunks into `output` field)
- Partially implemented: 0 items
- To-do: 5 items

Agent adjustments:
- Agent D changed to "verify existing output display + add collapsed/expanded toggle" (already implemented)
- Agents A, B, C, E, F proceed as planned (to-do)

Estimated time saved: ~10 min (avoided re-implementing output accumulation already in useWaveEvents.ts).

**Design decision: Completion report path fix**

Option 3 (worktree IMPL doc path) is the correct choice. It requires no agent prompt changes, no new files, and no new API endpoints. The fix is surgical: in `orchestrator.go`'s `launchAgent`, compute the worktree IMPL doc path from `wtPath` and pass it to `waitForCompletionFunc` instead of `o.implDocPath`. `WaitForCompletion` in `pkg/agent/completion.go` already works correctly — it just receives the wrong path. This is a two-line backend fix that unblocks the entire auto-merge flow.

## Scaffolds

No scaffolds needed - agents have independent type ownership.

## Pre-Mortem

**Overall risk:** medium

**Failure modes:**

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| Worktree IMPL path computed incorrectly (wrong slug extraction from implDocPath) | medium | high | Agent A must test the path construction with an integration test covering the worktree layout `.claude/worktrees/wave1-agent-A/docs/IMPL/IMPL-slug.md` |
| Wave gate pauses the entire `runWaveLoop` goroutine and the SSE client disconnects before the user resumes | medium | medium | Store "gate pending" state in `activeRuns` map (slug -> gateState); expose `GET /api/wave/{slug}/status` so reconnected clients can query current state |
| Scout launcher streams output but the IMPL doc is never refreshed in the sidebar list after Scout completes | low | medium | On `scout_complete` SSE event, frontend re-fetches `/api/impl` list |
| Re-run agent button creates a second worktree for same wave/letter, conflicting with existing branch | medium | high | Agent F must check for existing branch `saw/waveN-agent-X` and delete it before re-creating worktree |
| `npm test -- --run` is not the correct Vitest filter flag for this project | low | low | Agent E/D verify with `cd web && npx vitest run` (the standard Vitest command) |
| Wave gate channel leak if server restarts mid-gate | low | low | Gate channels are per-run goroutine; restart kills the goroutine cleanly |
| PUT /api/impl/{slug}/raw writes to wrong path if IMPLDir is relative | low | medium | Agent G must join cfg.IMPLDir + "IMPL-{slug}.md" using filepath.Join consistently with handleGetImpl |
| ImplEditor textarea loses edits if user navigates away without saving | low | low | Agent H should show unsaved-changes indicator; no auto-save needed for MVP |

## Known Issues

None identified. The existing tests pass (confirmed by project memory: `go build -o saw ./cmd/saw` is the standard build).

## Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (4 parallel agents — backend fixes and new endpoints):
    [A] pkg/orchestrator/orchestrator.go
         Fix launchAgent: pass worktree IMPL doc path to waitForCompletionFunc
         ✓ root (no dependencies on other agents)

    [B] pkg/api/server.go, pkg/api/scout.go (new file)
         Add POST /api/scout/run endpoint that streams scout output via SSE
         ✓ root (no dependencies on other agents)

    [C] pkg/api/wave_runner.go, pkg/api/server.go
         Add wave gate: pause runWaveLoop between waves; add POST /api/wave/{slug}/gate/proceed
         depends on: [A] (gate logic is post-RunWave; shares server.go with [B])
         NOTE: server.go is split — Agent B adds scout route registration only;
               Agent C adds gate route registration only; both append to the
               existing mux.HandleFunc block. Orchestrator reviews both diffs
               before merging to ensure no line-level conflict in server.go.

    [G] pkg/api/impl_edit.go (new file)
         Add GET /api/impl/{slug}/raw and PUT /api/impl/{slug}/raw endpoints
         ✓ root (no dependencies on other agents)
         NOTE: server.go owned by Agent B — Agent G documents two route lines
               as downstream_action_required: true for orchestrator to apply manually.

Wave 2 (4 parallel agents — frontend features):
    [D] web/src/components/AgentCard.tsx
         Add collapsed/expanded toggle for output pane (output display already works)
         depends on: none (pure UI enhancement, no backend dependency)

    [E] web/src/components/ScoutLauncher.tsx (new file), web/src/App.tsx, web/src/api.ts
         Scout launcher screen: text input, Run Scout button, streaming output display
         depends on: [B] (POST /api/scout/run endpoint)

    [F] web/src/components/WaveBoard.tsx, web/src/hooks/useWaveEvents.ts
         Wave gate banner + error recovery (Re-run button on failed AgentCard)
         depends on: [C] (gate SSE events and proceed endpoint)

    [H] web/src/components/ImplEditor.tsx (new file)
         IMPL doc raw markdown editor panel (textarea + Save button)
         depends on: [G] (GET/PUT /api/impl/{slug}/raw endpoints)
         NOTE: api.ts owned by Agent E — Agent H documents fetchImplRaw and saveImplRaw
               as downstream_action_required: true for orchestrator to apply manually.
               WaveBoard.tsx owned by Agent F — Agent H documents waveGate integration
               note for orchestrator to wire ImplEditor into WaveBoard after both merge.
```

**Conflict note on server.go:** Agents B and C both register routes in `pkg/api/server.go`. To resolve: Agent B owns `pkg/api/server.go` and `pkg/api/scout.go`. Agent C's route registration for `/api/wave/{slug}/gate/proceed` is added as a single `s.mux.HandleFunc(...)` line documented in Agent C's completion report under `interface_deviations`. The orchestrator applies this line during the Wave 1 merge of Agent C's branch, before the final build check. Agent G follows the same pattern: its two route lines are documented in its completion report for the orchestrator to apply to `server.go` after Agent B is merged.

## Interface Contracts

### A: Worktree IMPL doc path construction

In `orchestrator.go`, `launchAgent` computes the worktree IMPL path by replacing the repo root prefix with the worktree path:

```go
// wtIMPLPath derives the IMPL doc path inside the agent's worktree.
// implDocPath is the main repo IMPL doc path (e.g. /repo/docs/IMPL/IMPL-foo.md).
// wtPath is the worktree root (e.g. /repo/.claude/worktrees/wave1-agent-A).
// repoPath is the repo root (e.g. /repo).
// Result: /repo/.claude/worktrees/wave1-agent-A/docs/IMPL/IMPL-foo.md
func wtIMPLPath(repoPath, implDocPath, wtPath string) string {
    rel, err := filepath.Rel(repoPath, implDocPath)
    if err != nil {
        return implDocPath // fallback to main repo path
    }
    return filepath.Join(wtPath, rel)
}
```

`launchAgent` calls:
```go
report, err := waitForCompletionFunc(
    wtIMPLPath(o.repoPath, o.implDocPath, wtPath),
    agentSpec.Letter,
    defaultAgentTimeout,
    defaultAgentPollInterval,
)
```

### B: Scout run SSE endpoint

```
POST /api/scout/run
Content-Type: application/json
Body: { "feature": "string", "repo": "string (optional)" }

Response: 202 Accepted
SSE stream on GET /api/scout/{runID}/events:
  event: scout_output   data: { "run_id": "string", "chunk": "string" }
  event: scout_complete data: { "run_id": "string", "slug": "string", "impl_path": "string" }
  event: scout_failed   data: { "run_id": "string", "error": "string" }
```

New handler in `pkg/api/scout.go`:
```go
func (s *Server) handleScoutRun(w http.ResponseWriter, r *http.Request) // POST /api/scout/run
func (s *Server) handleScoutEvents(w http.ResponseWriter, r *http.Request) // GET /api/scout/{runID}/events
```

New types in `pkg/api/scout.go`:
```go
type ScoutRunRequest struct {
    Feature string `json:"feature"`
    Repo    string `json:"repo,omitempty"`
}
type ScoutRunResponse struct {
    RunID string `json:"run_id"`
}
```

The handler generates a UUID `runID`, stores it in `s.scoutRuns sync.Map` (runID -> struct{}{}), launches a goroutine that calls `runner.ExecuteStreaming` with the scout prompt, publishes chunks as `scout_output` SSE events, publishes `scout_complete` or `scout_failed` on finish.

**New field required on Server struct** (Agent B adds):
```go
scoutRuns sync.Map // runID -> struct{}{}
```

### C: Wave gate SSE events and proceed endpoint

New SSE events published by `runWaveLoop`:
```
event: wave_gate_pending  data: { "wave": N, "next_wave": N+1, "slug": "string" }
event: wave_gate_resolved data: { "wave": N, "action": "proceed" | "cancel", "slug": "string" }
```

New endpoint registered in `server.go`:
```
POST /api/wave/{slug}/gate/proceed
Response: 202 Accepted
```

Gate implementation in `runWaveLoop`:
```go
// gateChannels: slug -> chan bool (true=proceed, false=cancel)
// stored on Server as: s.gateChannels sync.Map
func (s *Server) handleWaveGateProceed(w http.ResponseWriter, r *http.Request)
```

`runWaveLoop` signature gains `server *Server` parameter (or gate channel passed via closure):
```go
// Internal: gate blocks between waves when multi-wave IMPL doc
func (s *Server) waitForGate(slug string, waveNum int, publish func(string, interface{})) bool
```

### D: AgentCard output toggle

No cross-agent interface. Component-internal state:
```tsx
const [outputExpanded, setOutputExpanded] = useState(false)
```
Existing `agent.output` field unchanged. Output pane shows last 5 lines collapsed, full output expanded.

### E: Scout launcher API client

New function in `web/src/api.ts`:
```ts
export async function runScout(feature: string, repo?: string): Promise<{ runId: string }>
export function subscribeScoutEvents(runId: string): EventSource
```

New component `web/src/components/ScoutLauncher.tsx`:
```tsx
interface ScoutLauncherProps {
  onComplete: (slug: string) => void  // called when scout_complete fires; navigates to review
}
export default function ScoutLauncher({ onComplete }: ScoutLauncherProps): JSX.Element
```

### F: Wave gate and Re-run button

`useWaveEvents.ts` gains new state field:
```ts
interface AppWaveState {
  // ... existing fields ...
  waveGate?: { wave: number; nextWave: number }  // set when wave_gate_pending received
}
```

New API function in `web/src/api.ts` (Agent F adds):
```ts
export async function proceedWaveGate(slug: string): Promise<void>
export async function rerunAgent(slug: string, wave: number, agentLetter: string): Promise<void>
```

New endpoint for re-run (Agent C adds to `pkg/api/wave_runner.go`):
```
POST /api/wave/{slug}/agent/{letter}/rerun
Body: { "wave": N }
Response: 202 Accepted
```

### G: IMPL doc raw read/write endpoints

New handler file `pkg/api/impl_edit.go`:
```go
// handleGetImplRaw serves GET /api/impl/{slug}/raw.
// Returns the raw IMPL markdown text as text/plain.
// 404 if the file does not exist.
func (s *Server) handleGetImplRaw(w http.ResponseWriter, r *http.Request)

// handlePutImplRaw serves PUT /api/impl/{slug}/raw.
// Accepts a raw markdown body and writes it to docs/IMPL/IMPL-{slug}.md on disk.
// Returns 200 on success, 400 if body is empty, 500 on write error.
func (s *Server) handlePutImplRaw(w http.ResponseWriter, r *http.Request)
```

Routes to be added to `server.go` `New()` by the orchestrator (documented in Agent G's completion report):
```go
s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
```

HTTP contract:
```
GET /api/impl/{slug}/raw
Response: 200 text/plain — raw markdown content of docs/IMPL/IMPL-{slug}.md
          404 if file not found

PUT /api/impl/{slug}/raw
Content-Type: text/plain (or any; body is read as raw bytes)
Body: raw markdown string
Response: 200 on success
          400 if body is empty
          500 on write error
```

### H: IMPL editor panel

New component `web/src/components/ImplEditor.tsx`:
```tsx
interface ImplEditorProps {
  slug: string
  // called after a successful save so callers can re-fetch parsed impl if needed
  onSaved?: () => void
}
export default function ImplEditor({ slug, onSaved }: ImplEditorProps): JSX.Element
```

Two new API functions added to `web/src/api.ts` by the orchestrator after Agent H merges:
```ts
export async function fetchImplRaw(slug: string): Promise<string>
export async function saveImplRaw(slug: string, markdown: string): Promise<void>
```

The component fetches raw markdown on mount via `GET /api/impl/{slug}/raw`, renders it in a `<textarea>`, and saves via `PUT /api/impl/{slug}/raw` on Save click. The component is self-contained; wiring into WaveBoard (wave gate context) and ReviewScreen is an orchestrator post-merge step.

## File Ownership

```yaml type=impl-file-ownership
| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| pkg/orchestrator/orchestrator.go | A | 1 | — |
| pkg/api/scout.go (new) | B | 1 | — |
| pkg/api/server.go | B | 1 | — |
| pkg/api/wave_runner.go | C | 1 | — |
| pkg/api/impl_edit.go (new) | G | 1 | — |
| web/src/components/AgentCard.tsx | D | 2 | — |
| web/src/components/ScoutLauncher.tsx (new) | E | 2 | B |
| web/src/App.tsx | E | 2 | B |
| web/src/api.ts | E+F+H split | 2 | B, C, G |
| web/src/components/WaveBoard.tsx | F | 2 | C |
| web/src/hooks/useWaveEvents.ts | F | 2 | C |
| web/src/components/ImplEditor.tsx (new) | H | 2 | G |
```

**api.ts conflict resolution:** Agent E owns `web/src/api.ts` and adds `runScout` + `subscribeScoutEvents`. Agent F's additions (`proceedWaveGate`, `rerunAgent`) are documented in Agent F's completion report as a two-function append. Agent H's additions (`fetchImplRaw`, `saveImplRaw`) are documented in Agent H's completion report as a two-function append. The orchestrator applies all manual additions to `api.ts` sequentially after merging all Wave 2 branches.

## Wave Structure

```yaml type=impl-wave-structure
Wave 1: [A] [B] [C] [G]      <- 4 parallel agents (backend)
           | (A+B+C+G complete)
Wave 2: [D] [E] [F] [H]      <- 4 parallel agents (frontend)
```

## Wave 1

Wave 1 delivers the four backend fixes that unblock the full protocol loop:
- Agent A: the completion report path fix (the core bug)
- Agent B: Scout run endpoint (streaming scout launch from UI)
- Agent C: wave gate endpoint + `runWaveLoop` pause logic
- Agent G: IMPL doc raw read/write endpoints (enables GUI editing)

All four agents are independent. Agent A touches only `orchestrator.go`. Agent B owns `server.go`. Agents C and G both need routes registered in `server.go` — each documents its route lines in its completion report as `downstream_action_required: true` for the orchestrator to apply manually when merging (same pattern).

### Agent A - Fix Completion Report Path in launchAgent

**Field 0 — identity:** You are Agent A, Wave 1. You fix the completion report polling bug in the SAW orchestrator.

**Field 1 — files owned:**
- `pkg/orchestrator/orchestrator.go` (modify)

**Field 2 — context:**

The orchestrator's `launchAgent` function (line 311) calls:
```go
report, err := waitForCompletionFunc(o.implDocPath, agentSpec.Letter, ...)
```
`o.implDocPath` is the main repo path (e.g. `/repo/docs/IMPL/IMPL-foo.md`).
But the agent writes its completion report to the IMPL doc inside its worktree (e.g. `/repo/.claude/worktrees/wave1-agent-A/docs/IMPL/IMPL-foo.md`).
These never match until after merge — which requires completion first. Circular dependency. The fix: compute the worktree IMPL path and pass that to `waitForCompletionFunc`.

**Field 3 — task:**

1. Add a package-level helper function `wtIMPLPath(repoPath, implDocPath, wtPath string) string` that computes the IMPL doc path inside a worktree by replacing the repo root prefix with the worktree path using `filepath.Rel` and `filepath.Join`. If `filepath.Rel` fails, return `implDocPath` as a fallback.

2. In `launchAgent`, after `wtPath` is known (after `worktreeCreatorFunc` returns), call `waitForCompletionFunc` with `wtIMPLPath(o.repoPath, o.implDocPath, wtPath)` instead of `o.implDocPath`.

3. Add a unit test in `orchestrator_test.go` that:
   - Sets `waitForCompletionFunc` to a spy that records the `implDocPath` argument it receives
   - Runs `launchAgent` with a fake worktree creator that returns a known path
   - Asserts the spy received the worktree IMPL path, not the main repo IMPL path

**Field 4 — interface contracts:** See `wtIMPLPath` signature in Interface Contracts section.

**Field 5 — do not touch:**
- `pkg/agent/completion.go` — `WaitForCompletion` is correct; only the call site is wrong
- Any frontend files
- Any other orchestrator files (merge.go, verification.go, etc.)

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/orchestrator/... -run TestLaunchAgent -v
go test ./pkg/orchestrator/...
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md` after the Status table:

```markdown
### Agent A - Completion Report

**status:** complete | partial | blocked
**files_changed:** pkg/orchestrator/orchestrator.go, pkg/orchestrator/orchestrator_test.go
**interface_deviations:** none | describe any
**downstream_action_required:** false
**notes:** describe wtIMPLPath logic and test coverage
```

**Field 8 — branch:** `saw/wave1-agent-A`

---

### Agent B - Scout Run API Endpoint

**Field 0 — identity:** You are Agent B, Wave 1. You add the `POST /api/scout/run` endpoint that launches a Scout agent and streams its output via SSE.

**Field 1 — files owned:**
- `pkg/api/scout.go` (new file)
- `pkg/api/server.go` (modify — add route registrations and `scoutRuns sync.Map` field)

**Field 2 — context:**

The CLI `runScout` in `cmd/saw/commands.go` calls `runner.Execute` (non-streaming). The UI needs to launch Scout and see live output. The existing SSE infrastructure (`sseBroker`) can be reused for scout output. The `runScout` CLI uses `agent.NewRunner(b, nil)` with the scout prompt from `locatePromptFile`. The GUI version needs to do the same but stream chunks back via SSE.

Read `pkg/api/server.go` to understand the `Server` struct and `sseBroker`. Read `pkg/api/wave_runner.go` to understand how `makePublisher` and `ExecuteStreaming` interact. Read `cmd/saw/commands.go` `runScout` function to understand how the scout prompt is constructed (feature description + IMPL output path injection).

**Field 3 — task:**

1. Create `pkg/api/scout.go` with:
   - `ScoutRunRequest` and `ScoutRunResponse` structs (see Interface Contracts)
   - `handleScoutRun(w, r)` — parses JSON body, generates a UUID `runID` (use `fmt.Sprintf("%d", time.Now().UnixNano())` as a simple unique ID), stores `runID` in `s.scoutRuns`, launches goroutine, returns 202 with JSON `{"run_id": "<runID>"}`.
   - `handleScoutEvents(w, r)` — serves SSE stream for `GET /api/scout/{runID}/events` using the existing `sseBroker` (subscribe to broker with key `"scout-"+runID`).
   - The background goroutine: resolves `repoRoot` from request body `Repo` field or server's `cfg.RepoPath`; constructs the scout prompt by reading the scout prompt from `locatePromptFile` if available, otherwise uses a minimal hardcoded prompt that tells the agent to write an IMPL doc; computes `implOut` as `filepath.Join(repoRoot, "docs", "IMPL", "IMPL-"+slug+".md")` where `slug = slugify(feature)`; calls `runner.ExecuteStreaming` with `onChunk` publishing `scout_output` SSE events; on completion publishes `scout_complete` with the slug; on error publishes `scout_failed`.
   - Use `slugify` from `cmd/saw/commands.go` — copy the function body into `pkg/api/scout.go` (it has no dependencies). Name it `scoutSlugify` to avoid collision.

2. Modify `pkg/api/server.go`:
   - Add `scoutRuns sync.Map` field to `Server` struct
   - Register routes in `New()`:
     ```go
     s.mux.HandleFunc("POST /api/scout/run", s.handleScoutRun)
     s.mux.HandleFunc("GET /api/scout/{runID}/events", s.handleScoutEvents)
     ```

**Field 4 — interface contracts:** See `ScoutRunRequest`, `ScoutRunResponse`, and SSE events in Interface Contracts.

**Field 5 — do not touch:**
- `pkg/api/wave_runner.go` — Agent C owns this
- `pkg/api/impl.go` — do not modify
- `pkg/api/impl_edit.go` — Agent G owns this
- Any frontend files
- `pkg/agent/` — do not modify

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/api/... -run TestScout -v
go test ./pkg/api/...
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent B - Completion Report

**status:** complete | partial | blocked
**files_changed:** pkg/api/scout.go, pkg/api/server.go
**interface_deviations:** none | describe (esp. if scout prompt construction differs)
**downstream_action_required:** false | true (if SSE event names differ from spec)
**notes:**
```

**Field 8 — branch:** `saw/wave1-agent-B`

---

### Agent C - Wave Gate and Re-run Endpoint

**Field 0 — identity:** You are Agent C, Wave 1. You add the wave gate mechanism that pauses `runWaveLoop` between waves and exposes a `POST /api/wave/{slug}/gate/proceed` endpoint.

**Field 1 — files owned:**
- `pkg/api/wave_runner.go` (modify)

**Field 2 — context:**

Currently `runWaveLoop` executes all waves in a tight loop without pausing. The UI needs to show "Wave N complete — run Wave N+1?" and wait for user confirmation. The gate must work with the existing SSE broker. The `Server` struct is in `pkg/api/server.go` (owned by Agent B) — you cannot modify `server.go`. Instead, your gate channel mechanism must be self-contained in `wave_runner.go`.

Read `pkg/api/wave_runner.go` carefully — specifically `runWaveLoop` and `handleWaveStart`. Note that `handleWaveStart` calls `runWaveLoopFunc(implPath, slug, s.cfg.RepoPath, publish)` — the function signature receives `publish` but not a `*Server` reference. To add gate support, you need to thread a gate-wait function through this call. The cleanest approach: introduce a `gateWaitFunc` field on `Server` of type `func(slug string, waveNum int) bool` (returns true=proceed, false=cancel). Store a `sync.Map` of gate channels on the server.

However, since `server.go` is owned by Agent B, coordinate the `Server` struct change: add a `AGENT_C_TODO` comment in your completion report explaining the single field that must be added to `Server` by the orchestrator post-merge. The orchestrator adds it manually.

The simpler alternative: store gate channels in a package-level `sync.Map` in `wave_runner.go` keyed by slug, and expose `handleWaveGateProceed` as a method on `Server` that pushes to that map. Register the route in your completion report as a `downstream_action_required` instruction to the orchestrator to add `s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)` to `server.go`.

**Field 3 — task:**

1. Add a package-level `var gateChannels sync.Map` in `wave_runner.go` (keyed by slug, value is `chan bool`).

2. Modify `runWaveLoop`: after each successful `orch.UpdateIMPLStatus` call (and before launching the next wave), if `hasNextWave`:
   - Create a `chan bool` with buffer 1, store it in `gateChannels` under `slug`
   - Publish `wave_gate_pending` SSE event: `{ "wave": waveNum, "next_wave": nextWaveNum, "slug": slug }`
   - Block on the channel with a 30-minute timeout
   - If `false` or timeout: publish `run_failed` with message "gate cancelled or timed out" and return
   - If `true`: publish `wave_gate_resolved` and continue to next wave
   - Always delete the channel from `gateChannels` after use

3. Add `handleWaveGateProceed(w http.ResponseWriter, r *http.Request)` method on `*Server`:
   - Looks up slug's gate channel in `gateChannels`
   - Sends `true` to it (non-blocking)
   - Returns 202

4. Write a unit test in `wave_runner_test.go` that:
   - Starts `runWaveLoop` in a goroutine with a two-wave fake orchestrator
   - Asserts `wave_gate_pending` is published after wave 1
   - Calls `handleWaveGateProceed` and asserts wave 2 starts

**Field 4 — interface contracts:** See wave gate SSE events in Interface Contracts. Report `downstream_action_required: true` with the exact `HandleFunc` line for the orchestrator to add to `server.go`.

**Field 5 — do not touch:**
- `pkg/api/server.go` — owned by Agent B
- `pkg/api/impl.go`, `pkg/api/scout.go`, `pkg/api/wave.go` — do not modify
- `pkg/api/impl_edit.go` — owned by Agent G
- Any orchestrator or agent packages

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/api/... -run TestWaveGate -v
go test ./pkg/api/...
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent C - Completion Report

**status:** complete | partial | blocked
**files_changed:** pkg/api/wave_runner.go
**interface_deviations:** none | describe
**downstream_action_required:** true
**orchestrator_action:** Add the following line to pkg/api/server.go in the New() function route registrations:
  s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)
**notes:**
```

**Field 8 — branch:** `saw/wave1-agent-C`

---

### Agent G - IMPL Doc Raw Read/Write Endpoints

**Field 0 — identity:** You are Agent G, Wave 1. You add two HTTP endpoints that expose the raw IMPL markdown for GUI editing: `GET /api/impl/{slug}/raw` (read) and `PUT /api/impl/{slug}/raw` (write).

**Field 1 — files owned:**
- `pkg/api/impl_edit.go` (new file)

**Field 2 — context:**

The existing `GET /api/impl/{slug}` handler in `pkg/api/impl.go` parses the IMPL doc into structured JSON. The new endpoints are simpler: they deal in raw bytes only — no parsing. The file path convention follows `handleGetImpl`: `filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")`. `s.cfg.IMPLDir` is the directory configured at server startup (e.g. `docs/IMPL`).

Read `pkg/api/impl.go` to understand the path construction and the `isNotExistErr` helper. Read `pkg/api/server.go` to understand the `Server` struct and `Config`. You will NOT modify `server.go` — your two route registrations are documented in your completion report as `downstream_action_required: true` for the orchestrator to apply manually to `server.go` after Agent B's branch is merged.

The PUT handler must validate that the request body is non-empty before writing. It should write atomically: write to a temp file in the same directory, then `os.Rename` to the final path to avoid partial writes.

**Field 3 — task:**

1. Create `pkg/api/impl_edit.go` in the `api` package with:

```go
package api

import (
    "io"
    "net/http"
    "os"
    "path/filepath"
)

// handleGetImplRaw serves GET /api/impl/{slug}/raw.
// Returns the raw IMPL markdown text as text/plain; charset=utf-8.
// 404 if the file does not exist.
func (s *Server) handleGetImplRaw(w http.ResponseWriter, r *http.Request) {
    slug := r.PathValue("slug")
    implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
    data, err := os.ReadFile(implPath)
    if err != nil {
        if os.IsNotExist(err) {
            http.Error(w, "IMPL doc not found", http.StatusNotFound)
            return
        }
        http.Error(w, "failed to read IMPL doc", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/plain; charset=utf-8")
    w.Write(data)
}

// handlePutImplRaw serves PUT /api/impl/{slug}/raw.
// Accepts a raw markdown body and writes it to docs/IMPL/IMPL-{slug}.md on disk.
// Returns 200 on success, 400 if body is empty, 500 on write error.
func (s *Server) handlePutImplRaw(w http.ResponseWriter, r *http.Request) {
    slug := r.PathValue("slug")
    implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "failed to read request body", http.StatusInternalServerError)
        return
    }
    if len(body) == 0 {
        http.Error(w, "request body must not be empty", http.StatusBadRequest)
        return
    }
    // Atomic write: temp file + rename
    dir := filepath.Dir(implPath)
    tmp, err := os.CreateTemp(dir, "impl-edit-*.md.tmp")
    if err != nil {
        http.Error(w, "failed to create temp file", http.StatusInternalServerError)
        return
    }
    tmpName := tmp.Name()
    if _, err := tmp.Write(body); err != nil {
        tmp.Close()
        os.Remove(tmpName)
        http.Error(w, "failed to write temp file", http.StatusInternalServerError)
        return
    }
    if err := tmp.Close(); err != nil {
        os.Remove(tmpName)
        http.Error(w, "failed to flush temp file", http.StatusInternalServerError)
        return
    }
    if err := os.Rename(tmpName, implPath); err != nil {
        os.Remove(tmpName)
        http.Error(w, "failed to replace IMPL doc", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

2. Write a test file `pkg/api/impl_edit_test.go` with:
   - `TestHandleGetImplRaw_Found`: creates a temp IMPL dir, writes a known markdown file, makes a GET request, asserts 200 and body matches.
   - `TestHandleGetImplRaw_NotFound`: makes a GET request for a nonexistent slug, asserts 404.
   - `TestHandlePutImplRaw_Success`: makes a PUT with a markdown body, asserts 200, reads file back and confirms content.
   - `TestHandlePutImplRaw_EmptyBody`: makes a PUT with empty body, asserts 400.

3. Document in your completion report the two route lines for the orchestrator to apply to `server.go`:
```go
s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
```
These lines go in the `New()` function in `pkg/api/server.go`, after the existing `GET /api/impl/{slug}` line.

**Field 4 — interface contracts:** See `handleGetImplRaw` and `handlePutImplRaw` signatures in Interface Contracts section G.

**Field 5 — do not touch:**
- `pkg/api/server.go` — owned by Agent B; document route lines in completion report only
- `pkg/api/impl.go` — do not modify (existing IMPL endpoints)
- `pkg/api/scout.go` — owned by Agent B
- `pkg/api/wave_runner.go` — owned by Agent C
- Any frontend files
- Any orchestrator or agent packages

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/api/... -run TestHandleImplRaw -v
go test ./pkg/api/...
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent G - Completion Report

**status:** complete | partial | blocked
**files_changed:** pkg/api/impl_edit.go, pkg/api/impl_edit_test.go
**interface_deviations:** none | describe
**downstream_action_required:** true
**orchestrator_action:** Add the following two lines to pkg/api/server.go in the New() function route registrations, after the existing "GET /api/impl/{slug}" line:
  s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
  s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
**notes:**
```

**Field 8 — branch:** `saw/wave1-agent-G`

---

## Wave 2

Wave 2 delivers the frontend features. All four agents are independent of each other — they touch disjoint files. They depend on Wave 1 completing first (B for Scout endpoint, C for gate events, G for raw IMPL endpoints). Agent D has no backend dependency and could theoretically run in Wave 1 but is placed in Wave 2 to keep wave structure clean.

Before launching Wave 2, the orchestrator must verify:
1. Agent A's branch merged cleanly — go build passes
2. Agent B's route additions are in server.go and `GET /api/scout/{runID}/events` responds
3. Agent C's `handleWaveGateProceed` route has been manually added to server.go
4. Agent G's two raw endpoint routes have been manually added to server.go; `GET /api/impl/test/raw` returns 404 (file not found) and `PUT /api/impl/test/raw` returns 400 (empty body)

### Agent D - AgentCard Output Toggle

**Field 0 — identity:** You are Agent D, Wave 2. You enhance AgentCard to add a collapsed/expanded toggle for the agent output pane.

**Field 1 — files owned:**
- `web/src/components/AgentCard.tsx` (modify)

**Field 2 — context:**

The output display already works: `useWaveEvents.ts` accumulates `agent_output` SSE chunks into `agent.output`, and `AgentCard.tsx` already renders it in a scrollable `<pre>` with `max-h-32`. The only missing piece is a toggle so users can expand to see the full output without the fixed height cap. Read `web/src/components/AgentCard.tsx` — the relevant section is the "Output section" comment block (lines 93-103).

**Field 3 — task:**

1. Add `const [outputExpanded, setOutputExpanded] = useState(false)` inside `AgentCard`.

2. When `showOutput` is true, replace the current `<pre>` with:
   - A small "Show more / Show less" button above the `<pre>` (only if output is long enough to need it — check `agentOutput.length > 200`)
   - When collapsed: `max-h-32 overflow-y-auto` (current behavior)
   - When expanded: `max-h-96 overflow-y-auto` (larger but still scrollable)

3. Auto-scroll to bottom only when collapsed (current behavior). When expanded, let the user scroll freely (remove the `useEffect` scroll behavior when expanded).

4. Style the toggle button consistently with the card's dark theme (`text-xs text-white/50 hover:text-white/80`).

**Field 4 — interface contracts:** None (component-internal state only).

**Field 5 — do not touch:**
- `web/src/hooks/useWaveEvents.ts` — owned by Agent F
- `web/src/components/WaveBoard.tsx` — owned by Agent F
- `web/src/components/ImplEditor.tsx` — owned by Agent H
- Any Go files

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm install
npx vitest run
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent D - Completion Report

**status:** complete | partial | blocked
**files_changed:** web/src/components/AgentCard.tsx
**interface_deviations:** none
**downstream_action_required:** false
**notes:**
```

**Field 8 — branch:** `saw/wave2-agent-D`

---

### Agent E - Scout Launcher Screen

**Field 0 — identity:** You are Agent E, Wave 2. You add the Scout launcher — a new screen where the user types a feature description, clicks "Run Scout", and watches live output stream in.

**Field 1 — files owned:**
- `web/src/components/ScoutLauncher.tsx` (new file)
- `web/src/App.tsx` (modify — add "New plan" button and ScoutLauncher mode)
- `web/src/api.ts` (modify — add `runScout` and `subscribeScoutEvents`)

**Field 2 — context:**

Read `web/src/App.tsx` — it has two modes: `'split'` (review screen) and `'wave'` (WaveBoard). You add a third mode `'scout'` that renders `ScoutLauncher`. Add a "New plan" button in the header (top bar, next to DarkModeToggle). When Scout completes (`scout_complete` event fires), the launcher calls `onComplete(slug)` which App handles by switching back to `'split'` mode and selecting the new slug.

Read `web/src/api.ts` — add two functions. The SSE subscription for scout events follows the same pattern as `GET /api/wave/{slug}/events` but uses `GET /api/scout/{runID}/events`.

The backend endpoint (from Agent B) is:
- `POST /api/scout/run` with body `{ "feature": "...", "repo": "..." }`, returns `{ "run_id": "..." }`
- `GET /api/scout/{runID}/events` SSE stream

**Field 3 — task:**

1. Add to `web/src/api.ts`:
```ts
export async function runScout(feature: string, repo?: string): Promise<{ runId: string }>
export function subscribeScoutEvents(runId: string): EventSource
```

2. Create `web/src/components/ScoutLauncher.tsx`:
   - Text input for feature description (large, placeholder: "Describe the feature to build...")
   - Optional repo path input (default: empty, server uses cfg.RepoPath)
   - "Run Scout" button (disabled while running)
   - Live output `<pre>` that accumulates `scout_output` chunks (same pattern as AgentCard output)
   - On `scout_complete`: calls `props.onComplete(slug)`, closes EventSource
   - On `scout_failed`: shows error banner
   - Loading/running states styled consistently with WaveBoard

3. Modify `web/src/App.tsx`:
   - Add `'scout'` to `AppMode` type
   - Add "New plan" button in the header `<header>` element (left side, next to the "Scout and Wave" title)
   - When `appMode === 'scout'`: render `<ScoutLauncher onComplete={handleScoutComplete} />`
   - `handleScoutComplete(slug: string)`: fetches the new impl via `fetchImpl(slug)`, sets `impl`, sets `selectedSlug`, switches to `'split'` mode, refreshes the impl list

**Field 4 — interface contracts:** See `ScoutLauncherProps` and API function signatures in Interface Contracts.

**Field 5 — do not touch:**
- `web/src/components/AgentCard.tsx` — owned by Agent D
- `web/src/components/WaveBoard.tsx` — owned by Agent F
- `web/src/hooks/useWaveEvents.ts` — owned by Agent F
- `web/src/components/ImplEditor.tsx` — owned by Agent H
- Any Go files

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm install
npx tsc --noEmit
npx vitest run
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent E - Completion Report

**status:** complete | partial | blocked
**files_changed:** web/src/components/ScoutLauncher.tsx, web/src/App.tsx, web/src/api.ts
**interface_deviations:** none | describe (esp. if AppMode values differ)
**downstream_action_required:** false
**notes:**
```

**Field 8 — branch:** `saw/wave2-agent-E`

---

### Agent F - Wave Gate UI and Error Recovery

**Field 0 — identity:** You are Agent F, Wave 2. You add the wave gate banner to WaveBoard and Re-run buttons to failed agents.

**Field 1 — files owned:**
- `web/src/components/WaveBoard.tsx` (modify)
- `web/src/hooks/useWaveEvents.ts` (modify)

**Field 2 — context:**

Read `web/src/hooks/useWaveEvents.ts` — you need to handle two new SSE events from Wave 1 Agent C:
- `wave_gate_pending`: `{ wave: N, next_wave: N+1, slug: string }` — set `waveGate` state field
- `wave_gate_resolved`: `{ wave: N, action: string }` — clear `waveGate` state field

Read `web/src/components/WaveBoard.tsx` — you add a banner between wave rows when `state.waveGate` is set, showing "Wave N complete — Proceed to Wave N+1?" with a "Proceed" button. Clicking Proceed calls `proceedWaveGate(slug)` from the API.

For error recovery, the failed `AgentCard` already shows the error message. You add a "Re-run" button to the failed state in `AgentCard` — but `AgentCard.tsx` is owned by Agent D. Instead, add the Re-run button directly inside `WaveBoard.tsx`'s wave agent rendering loop, overlaid on the card or shown below it. This avoids the ownership conflict.

Read `web/src/api.ts` — it is owned by Agent E. Your two new functions (`proceedWaveGate`, `rerunAgent`) must be documented in your completion report as an `orchestrator_action`: the orchestrator appends them to `api.ts` during the Wave 2 merge.

Note: `web/src/components/ImplEditor.tsx` is owned by Agent H. The wiring of ImplEditor into WaveBoard (showing it at the wave gate) is a post-merge orchestrator step — do not attempt to import or render ImplEditor in your WaveBoard changes.

**Field 3 — task:**

1. Modify `web/src/hooks/useWaveEvents.ts`:
   - Add `waveGate?: { wave: number; nextWave: number }` to `AppWaveState` interface
   - Add event listener for `wave_gate_pending` that sets `state.waveGate`
   - Add event listener for `wave_gate_resolved` that clears `state.waveGate`

2. Modify `web/src/components/WaveBoard.tsx`:
   - After each wave row, if `state.waveGate?.wave === wave.wave`, render a gate banner:
     ```
     [Wave N complete] [Proceed to Wave N+1 →]
     ```
     Styled as a blue info banner. "Proceed" button calls `fetch('/api/wave/${slug}/gate/proceed', { method: 'POST' })` inline (no api.ts import needed to avoid ownership conflict).
   - For each failed agent in a wave, render a "Re-run" button below the AgentCard. Button calls `fetch('/api/wave/${slug}/agent/${agent.agent}/rerun', { method: 'POST', body: JSON.stringify({ wave: agent.wave }) })` inline. On 202, update the agent status to 'pending' locally in component state (re-render will come via SSE when the agent restarts).

3. Document in completion report the two `api.ts` functions the orchestrator must append:
```ts
export async function proceedWaveGate(slug: string): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/gate/proceed`, { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}

export async function rerunAgent(slug: string, wave: number, agentLetter: string): Promise<void> {
  const r = await fetch(`/api/wave/${encodeURIComponent(slug)}/agent/${encodeURIComponent(agentLetter)}/rerun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wave }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
}
```

**Field 4 — interface contracts:** See `AppWaveState` extension and wave gate SSE events in Interface Contracts.

**Field 5 — do not touch:**
- `web/src/components/AgentCard.tsx` — owned by Agent D
- `web/src/api.ts` — owned by Agent E (document your additions for orchestrator to apply)
- `web/src/components/ImplEditor.tsx` — owned by Agent H (do not import or reference)
- Any Go files

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm install
npx tsc --noEmit
npx vitest run
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent F - Completion Report

**status:** complete | partial | blocked
**files_changed:** web/src/components/WaveBoard.tsx, web/src/hooks/useWaveEvents.ts
**interface_deviations:** none | describe
**downstream_action_required:** true
**orchestrator_action:** Append proceedWaveGate and rerunAgent functions to web/src/api.ts (exact code in completion report notes)
**notes:**
```

**Field 8 — branch:** `saw/wave2-agent-F`

---

### Agent H - IMPL Editor Panel

**Field 0 — identity:** You are Agent H, Wave 2. You create the IMPL doc editor panel — a self-contained React component that lets users view and edit the raw IMPL markdown from the GUI.

**Field 1 — files owned:**
- `web/src/components/ImplEditor.tsx` (new file)

**Field 2 — context:**

The backend endpoints (from Wave 1 Agent G) are:
- `GET /api/impl/{slug}/raw` — returns raw IMPL markdown as `text/plain`
- `PUT /api/impl/{slug}/raw` — accepts raw markdown body, writes to disk, returns 200

`web/src/api.ts` is owned by Agent E. Your two new API functions (`fetchImplRaw`, `saveImplRaw`) must be documented in your completion report as an `orchestrator_action` for manual append to `api.ts`, same pattern as Agent F.

`web/src/components/WaveBoard.tsx` is owned by Agent F and `web/src/App.tsx` is owned by Agent E — do not modify either. The wiring of ImplEditor into the wave gate flow (showing it when `waveGate` state is set) is a post-merge orchestrator step. Your job is to deliver a complete, working, standalone component that accepts `slug` as a prop.

The primary UX context: at the wave gate, the user reviews completion reports and may want to adjust interface contracts or agent prompts in the IMPL doc before Wave 2 launches. The editor shows the full raw markdown in a textarea, the user edits, clicks Save, and the changes are written to disk. The orchestrator re-reads the IMPL doc when it resumes from the gate, so edits take effect before Wave 2 launches.

Read `web/src/components/ReviewScreen.tsx` and `web/src/components/review/InterfaceContractsPanel.tsx` to understand the existing panel style conventions for this project.

**Field 3 — task:**

1. Create `web/src/components/ImplEditor.tsx`:

```tsx
interface ImplEditorProps {
  slug: string
  onSaved?: () => void  // called after a successful save
}
export default function ImplEditor({ slug, onSaved }: ImplEditorProps): JSX.Element
```

Implementation requirements:
- On mount (and when `slug` changes), fetch `GET /api/impl/${encodeURIComponent(slug)}/raw` and populate the textarea. Show a loading state while fetching.
- Render a `<textarea>` with the raw markdown. It should be tall enough to show substantial content — use `min-h-[400px]` or similar. Match the dark-mode-aware styling used elsewhere in the project (`bg-background`, `text-foreground`, `border`, `font-mono text-sm`).
- Show an unsaved-changes indicator (e.g., a yellow dot or "(unsaved changes)" text next to the Save button) when the textarea content differs from the last-fetched content.
- "Save" button: calls `PUT /api/impl/${encodeURIComponent(slug)}/raw` with the textarea content as the body (`Content-Type: text/plain`). On success: update the "last saved" baseline content, clear the unsaved indicator, call `onSaved?.()`. On error: show an error message.
- "Revert" button: resets textarea to the last-fetched content (discards unsaved changes).
- Disable Save and Revert when there are no unsaved changes.
- Show a success flash ("Saved") for 2 seconds after a successful save.
- Do NOT use `fetchImplRaw` or `saveImplRaw` from `api.ts` (those don't exist yet — they will be added by the orchestrator post-merge). Instead, use `fetch` directly inside the component for the two API calls.

2. Write a test file `web/src/components/ImplEditor.test.tsx` (or `.test.ts`) with:
   - Mock `fetch` using `vi.fn()`
   - Test that the component renders a textarea populated with the fetched markdown
   - Test that clicking Save calls PUT with the textarea content
   - Test that clicking Revert resets the textarea to original content
   - Test that the unsaved-changes indicator appears when content is modified

3. Document in your completion report the two `api.ts` functions the orchestrator must append to `web/src/api.ts`:
```ts
export async function fetchImplRaw(slug: string): Promise<string> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/raw`)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.text()
}

export async function saveImplRaw(slug: string, markdown: string): Promise<void> {
  const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/raw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: markdown,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}
```

4. Also document in your completion report the post-merge wiring steps for the orchestrator:
   - **WaveBoard integration:** After merging Agent F and Agent H, add an `<ImplEditor slug={slug} />` render to `WaveBoard.tsx` inside the wave gate banner section (where `state.waveGate` is set). Import `ImplEditor` from `'../components/ImplEditor'`. Place it below the gate banner and above the Proceed button so the user can edit before proceeding.
   - **ReviewScreen integration (optional):** Add `'impl-editor'` to the `PanelKey` type and `panels` array in `ReviewScreen.tsx`, rendering `<ImplEditor slug={slug} onSaved={() => onRefreshImpl?.(slug)} />` when active. This lets users edit the IMPL doc from the review screen as well.

**Field 4 — interface contracts:** See `ImplEditorProps` and the `fetchImplRaw`/`saveImplRaw` signatures in Interface Contracts section H.

**Field 5 — do not touch:**
- `web/src/api.ts` — owned by Agent E (document your additions for orchestrator to apply)
- `web/src/components/WaveBoard.tsx` — owned by Agent F
- `web/src/App.tsx` — owned by Agent E
- `web/src/hooks/useWaveEvents.ts` — owned by Agent F
- `web/src/components/AgentCard.tsx` — owned by Agent D
- Any Go files

**Field 6 — verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm install
npx tsc --noEmit
npx vitest run
```

**Field 7 — completion report:** Append to `/Users/dayna.blackwell/code/scout-and-wave-go/docs/IMPL/IMPL-protocol-loop.md`:

```markdown
### Agent H - Completion Report

**status:** complete | partial | blocked
**files_changed:** web/src/components/ImplEditor.tsx, web/src/components/ImplEditor.test.tsx
**interface_deviations:** none | describe
**downstream_action_required:** true
**orchestrator_action:** (1) Append fetchImplRaw and saveImplRaw to web/src/api.ts (exact code in notes). (2) Wire ImplEditor into WaveBoard.tsx gate banner section. (3) Optionally add impl-editor panel to ReviewScreen.tsx.
**notes:**
```

**Field 8 — branch:** `saw/wave2-agent-H`

---

## Wave Execution Loop

### Orchestrator Post-Merge Checklist

After wave 1 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`; if any `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — Agent B and Agent C both modify `server.go` indirectly (B owns it, C reports a route to add); Agent G also reports two routes to add. Verify Agent B's merged `server.go` compiles before applying C's and G's route lines.
- [ ] Review `interface_deviations` — update Wave 2 agent prompts if SSE event names from B, C, or G differ from spec
- [ ] Merge Agent A: `git merge --no-ff saw/wave1-agent-A -m "Merge wave1-agent-A: fix completion report path"`
- [ ] Merge Agent B: `git merge --no-ff saw/wave1-agent-B -m "Merge wave1-agent-B: scout run SSE endpoint"`
- [ ] Apply Agent C's route line to `server.go`: add `s.mux.HandleFunc("POST /api/wave/{slug}/gate/proceed", s.handleWaveGateProceed)` to the `New()` function
- [ ] Merge Agent C: `git merge --no-ff saw/wave1-agent-C -m "Merge wave1-agent-C: wave gate endpoint"`
- [ ] Apply Agent G's two route lines to `server.go`: add to `New()` function after existing IMPL routes:
  ```go
  s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
  s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
  ```
- [ ] Merge Agent G: `git merge --no-ff saw/wave1-agent-G -m "Merge wave1-agent-G: IMPL doc raw read/write endpoints"`
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for A, B, C, G
- [ ] Post-merge verification:
  - [ ] Linter auto-fix pass: `go vet ./...` (n/a for auto-fix; no golangci-lint configured)
  - [ ] `go build ./... && go vet ./... && go test ./...`
- [ ] Fix any cascade failures — watch for `handleWaveGateProceed` or `handleGetImplRaw`/`handlePutImplRaw` not found if route lines were missed
- [ ] Tick status checkboxes for Wave 1 agents A, B, C, G in Status table below
- [ ] Feature-specific steps:
  - [ ] Verify `GET /api/scout/{runID}/events` returns SSE headers (curl test)
  - [ ] Verify `POST /api/wave/{slug}/gate/proceed` returns 202
  - [ ] Verify `GET /api/impl/protocol-loop/raw` returns 200 with raw markdown
  - [ ] Verify `PUT /api/impl/protocol-loop/raw` with a markdown body returns 200 and file is updated on disk
- [ ] Commit: `git commit -m "Wave 1 merged: completion report fix + scout endpoint + wave gate + IMPL raw endpoints"`
- [ ] Launch Wave 2

After wave 2 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`
- [ ] Conflict prediction — Agent E owns `api.ts`; Agents F and H each document functions for manual append. Apply F's and H's `api.ts` additions before merging F's and H's branches.
- [ ] Review `interface_deviations` — update if wave gate SSE event shape changed in Wave 1
- [ ] Apply Agent F's `api.ts` additions (`proceedWaveGate`, `rerunAgent`) to `web/src/api.ts`
- [ ] Apply Agent H's `api.ts` additions (`fetchImplRaw`, `saveImplRaw`) to `web/src/api.ts`
- [ ] Merge Agent D: `git merge --no-ff saw/wave2-agent-D -m "Merge wave2-agent-D: AgentCard output toggle"`
- [ ] Merge Agent E: `git merge --no-ff saw/wave2-agent-E -m "Merge wave2-agent-E: Scout launcher screen"`
- [ ] Merge Agent F: `git merge --no-ff saw/wave2-agent-F -m "Merge wave2-agent-F: wave gate UI + error recovery"`
- [ ] Merge Agent H: `git merge --no-ff saw/wave2-agent-H -m "Merge wave2-agent-H: IMPL editor panel"`
- [ ] Worktree cleanup for D, E, F, H
- [ ] Wire ImplEditor into WaveBoard (Agent H's post-merge orchestrator step):
  - [ ] In `web/src/components/WaveBoard.tsx`, import `ImplEditor` and render it inside the wave gate banner section when `state.waveGate` is set
- [ ] Optionally wire ImplEditor into ReviewScreen (add `'impl-editor'` panel)
- [ ] Post-merge verification:
  - [ ] `cd web && npm install && npx tsc --noEmit && npx vitest run`
  - [ ] `go build -o saw ./cmd/saw` (rebuilds embedded frontend)
  - [ ] `go test ./...`
- [ ] Feature-specific steps:
  - [ ] Manual smoke test: open UI, click "New plan", type a feature, click Run Scout, verify output streams
  - [ ] Manual smoke test: approve a multi-wave IMPL, verify wave gate banner appears after Wave 1 completes
  - [ ] Manual smoke test: at the wave gate, open IMPL editor, edit a line, click Save, click Proceed — verify the change is in the IMPL doc when Wave 2 reads it
  - [ ] Manual smoke test: cause an agent to fail (bad prompt), verify Re-run button appears
- [ ] Commit: `git commit -m "Wave 2 merged: scout launcher + wave gate UI + IMPL editor + error recovery"`

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | Fix completion report path in launchAgent | TO-DO |
| 1 | B | Scout run SSE endpoint (pkg/api/scout.go) | TO-DO |
| 1 | C | Wave gate endpoint + runWaveLoop pause | TO-DO |
| 1 | G | IMPL doc raw read/write endpoints (pkg/api/impl_edit.go) | TO-DO |
| 2 | D | AgentCard output toggle | TO-DO |
| 2 | E | Scout launcher screen + App routing | TO-DO |
| 2 | F | Wave gate UI + Re-run button in WaveBoard | TO-DO |
| 2 | H | IMPL editor panel (web/src/components/ImplEditor.tsx) | TO-DO |
| — | Orch | Post-merge integration, binary rebuild, smoke tests | TO-DO |

---

### Agent G - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-G
branch: saw/wave1-agent-G
commit: 10ba710c5f85ec995843fb4e700bb9069a84dea3
files_changed: []
files_created:
  - pkg/api/impl_edit.go
  - pkg/api/impl_edit_test.go
interface_deviations:
  - Used s.cfg.IMPLDir (not s.cfg.RepoPath + "docs/IMPL") to be consistent with
    the existing impl.go pattern. Both resolve to the same directory in production.
out_of_scope_deps:
  - downstream_action_required: true
    orchestrator_action: |
      Add the following lines to pkg/api/server.go in the New() function route registrations
      (after the existing GET /api/impl/{slug} line):
        s.mux.HandleFunc("GET /api/impl/{slug}/raw", s.handleGetImplRaw)
        s.mux.HandleFunc("PUT /api/impl/{slug}/raw", s.handlePutImplRaw)
tests_added:
  - pkg/api/impl_edit_test.go::TestHandleGetImplRaw_Found
  - pkg/api/impl_edit_test.go::TestHandleGetImplRaw_NotFound
  - pkg/api/impl_edit_test.go::TestHandlePutImplRaw_Success
  - pkg/api/impl_edit_test.go::TestHandlePutImplRaw_EmptyBody
verification: PASS
```

The GET handler reads from `s.cfg.IMPLDir/IMPL-{slug}.md` and returns `text/plain; charset=utf-8`. The PUT handler uses an atomic write pattern: writes to a temp file in the same directory as the target (same filesystem guarantees `os.Rename` atomicity), then renames into place. The 10MB body limit prevents runaway reads. All four tests pass; the full `./pkg/api/...` suite passes with no regressions.

One interface deviation: the prompt specified `filepath.Join(s.cfg.RepoPath, "docs", "IMPL", ...)` for path construction, but the existing `impl.go` uses `s.cfg.IMPLDir` directly. Using `s.cfg.IMPLDir` is consistent with the rest of the codebase and avoids hardcoding the `docs/IMPL` subdirectory (which is already baked into `IMPLDir` at server startup). Both approaches resolve to the same path in production.

The two route registrations (`GET /api/impl/{slug}/raw` and `PUT /api/impl/{slug}/raw`) must be added to `pkg/api/server.go` by Agent B or the orchestrator — this file is outside my ownership.
