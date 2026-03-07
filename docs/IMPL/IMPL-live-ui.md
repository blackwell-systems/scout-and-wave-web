# IMPL: Live UI — SSE bridge, serve+wave unification, dark mode

**Test Command:** `go test ./... && cd web && npm run build`
**Lint Command:** `go vet ./...`

---

### Suitability Assessment

Verdict: SUITABLE
test_command: `go test ./... && cd web && npm test -- --run`
lint_command: `go vet ./...`

The three sub-features decompose cleanly into disjoint file ownership. Agent A
(SSE bridge) owns the orchestrator and a new publisher adapter in pkg/api. Agent
B (serve+wave unification) owns the new wave-start HTTP handler and wires the
server to launch wave execution in a goroutine. Agent C (dark mode) owns all
React components and tailwind.config.js exclusively. No file is shared across
agents within the same wave. The interfaces are fully discoverable: the
orchestrator's existing method signatures are fixed, the SSE broker's Publish
method is already defined, and the new HTTP endpoint shape is straightforward.
Build/test cycles include both `go test ./...` and a Vite/React build, so
parallelisation saves meaningful time. Single wave; all three agents are
independent and can run concurrently.

Estimated times:
- Scout phase: ~15 min (dependency mapping, interface contracts, IMPL doc)
- Agent execution: ~30 min (3 agents × ~10 min avg, all in parallel)
- Merge & verification: ~5 min
Total SAW time: ~50 min

Sequential baseline: ~75 min (3 agents × ~25 min avg sequential time)
Time savings: ~25 min (33% faster)

Recommendation: Clear speedup. Three independent agents with moderate
complexity — proceed as-is.

Pre-implementation scan results:
- Total items: 3 feature areas
- Already implemented: 0 items
- Partially implemented: 1 item (SSE broker exists; nothing calls Publish
  during wave execution)
- To-do: 2 items (serve+wave unification; dark mode)

Agent adjustments:
- Agent A: "complete the implementation" — broker exists but the orchestrator
  bridge is missing. Wire Publish calls into the orchestrator launchAgent path.
- Agents B, C: proceed as planned (to-do).

---

### Scaffolds

No scaffolds needed — agents have independent type ownership.

The only cross-boundary type is `SSEEvent`, which already exists in
`pkg/api/types.go` and is already imported by the wave.go broker. Agent A reads
it; Agent B reads it; no duplication risk.

---

### Known Issues

None identified. The existing test suite (`go test ./...`) passes on main.

---

### Dependency Graph

**Roots (no inbound dependencies from new work):**
- `pkg/orchestrator/orchestrator.go` — Agent A modifies `launchAgent` to call a
  new publisher seam; has no dependency on Agents B or C.
- `pkg/api/wave_runner.go` (new file) — Agent B creates this; depends only on
  existing types in `pkg/api/types.go` and `pkg/orchestrator`.
- `web/tailwind.config.js`, all `web/src/**` — Agent C modifies these; depends
  on nothing from Agents A or B.

**Leaves (block nothing downstream):**
- All three agents' outputs are leaves — there is no Wave 2.

**Cross-package call paths (for cascade awareness):**
- `pkg/api/server.go` registers the new `POST /api/wave/{slug}/start` route
  added by Agent B. No other packages reference that route.
- `pkg/orchestrator/orchestrator.go` gains a `publishFunc` seam (func field)
  injected by the API layer; this is an outbound call from orchestrator →
  api-layer at runtime (via the seam), but no compile-time import is added to
  orchestrator (it calls a plain `func(string, SSEEvent)` parameter, avoiding an
  import cycle).
- `cmd/saw/commands.go` calls `orchestrator.New` / `RunWave` — those signatures
  do not change, so no cascade.

**Cascade candidates (files not changing but semantically affected):**
- `cmd/saw/commands.go` — `runWave` calls `o.RunWave`; the method signature does
  not change; no cascade.
- `cmd/saw/wave_loop_test.go` — tests `runWave` via `fakeWaveOrch`; no interface
  change; no cascade.
- `pkg/api/server_test.go` — tests approve/reject handlers; new handler is
  additive; no cascade.

---

### Interface Contracts

**A1 — `Orchestrator.RunWaveWithPublish` (pkg/orchestrator/orchestrator.go)**

Agent A adds a `publishFunc` field to `Orchestrator` and a setter so the API
layer can inject it without an import cycle:

```go
// publishFunc is an optional hook called during wave execution.
// Signature matches sseBroker.Publish so the API layer can inject it directly.
// nil means no-op (default, preserves CLI behaviour).
type publishFunc func(slug string, ev SSEEvent)
```

Because `SSEEvent` is defined in `pkg/api`, and orchestrator must not import
`pkg/api` (cycle), Agent A defines a **parallel type** in the orchestrator
package:

```go
// pkg/orchestrator/events.go  (new file owned by Agent A)

// OrchestratorEvent mirrors api.SSEEvent without importing pkg/api.
// The API layer maps OrchestratorEvent → api.SSEEvent when injecting the hook.
type OrchestratorEvent struct {
    Event string      // "agent_started" | "agent_complete" | "agent_failed" | "wave_complete" | "run_complete"
    Data  interface{}
}

// EventPublisher is the hook type injected by the API layer.
type EventPublisher func(ev OrchestratorEvent)

// SetEventPublisher injects a publisher into o. Thread-safe (called before
// RunWave; RunWave is not called concurrently with SetEventPublisher).
func (o *Orchestrator) SetEventPublisher(pub EventPublisher) {
    o.eventPublisher = pub
}
```

Events emitted by `launchAgent`:
- `agent_started` — after worktree created, before ExecuteWithTools
- `agent_complete` — after waitForCompletionFunc succeeds
- `agent_failed` — when launchAgent returns a non-nil error

Events emitted by `RunWave` after `eg.Wait()` returns nil:
- `wave_complete`

Events emitted by the caller (Agent B's handler) after all waves finish:
- `run_complete`

**A2 — Data payloads (pkg/orchestrator/events.go)**

```go
type AgentStartedPayload struct {
    Agent string   `json:"agent"`
    Wave  int      `json:"wave"`
    Files []string `json:"files"`
}

type AgentCompletePayload struct {
    Agent  string `json:"agent"`
    Wave   int    `json:"wave"`
    Status string `json:"status"`
    Branch string `json:"branch"`
}

type AgentFailedPayload struct {
    Agent       string `json:"agent"`
    Wave        int    `json:"wave"`
    Status      string `json:"status"`
    FailureType string `json:"failure_type"`
    Message     string `json:"message"`
}

type WaveCompletePayload struct {
    Wave        int    `json:"wave"`
    MergeStatus string `json:"merge_status"`
}

type RunCompletePayload struct {
    Status string `json:"status"`
    Waves  int    `json:"waves"`
    Agents int    `json:"agents"`
}
```

**B1 — `POST /api/wave/{slug}/start` endpoint (pkg/api/wave_runner.go, new file)**

```go
// handleWaveStart serves POST /api/wave/{slug}/start.
// Body: {"impl_path": "<absolute-path>"}  (JSON)
// - 400 if impl_path missing or blank
// - 409 if a run for this slug is already in progress
// - 202 Accepted immediately; wave execution proceeds in a goroutine,
//   publishing events to the broker as it goes.
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request)
```

Request body struct (defined in wave_runner.go):

```go
type waveStartRequest struct {
    ImplPath string `json:"impl_path"`
}
```

The handler:
1. Decodes `waveStartRequest`.
2. Checks `s.activeRuns` (a `sync.Map[string, struct{}]`) to detect in-progress
   runs for this slug; returns 409 if already running.
3. Marks the slug as active in `s.activeRuns`.
4. Launches a goroutine that:
   a. Creates `orchestrator.New(s.cfg.RepoPath, req.ImplPath)`.
   b. Calls `o.SetEventPublisher(s.makePublisher(slug))`.
   c. Calls `runWaveLoop(o, slug, s.broker)` (a package-private function in
      wave_runner.go that mirrors the wave loop in cmd/saw/commands.go).
   d. On completion/error, removes slug from `s.activeRuns`.
5. Returns 202 immediately.

`s.makePublisher(slug)` adapts `orchestrator.EventPublisher` →
`broker.Publish(slug, api.SSEEvent{...})`, mapping `OrchestratorEvent` to
`SSEEvent`.

```go
// makePublisher returns an EventPublisher that maps OrchestratorEvent to SSEEvent
// and publishes it on the broker for the given slug.
func (s *Server) makePublisher(slug string) orchestrator.EventPublisher
```

**B2 — Route registration (pkg/api/server.go)**

Agent B adds one line to `New`:

```go
s.mux.HandleFunc("POST /api/wave/{slug}/start", s.handleWaveStart)
```

Agent B also adds `activeRuns sync.Map` to the `Server` struct.

**C1 — Tailwind dark mode strategy (web/tailwind.config.js)**

```js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',          // <-- added
  theme: { extend: {} },
  plugins: [],
}
```

**C2 — Dark mode toggle hook (web/src/hooks/useDarkMode.ts, new file)**

```ts
// useDarkMode returns [isDark, toggle].
// Reads system preference on first render; persists choice to localStorage.
export function useDarkMode(): [boolean, () => void]
```

On mount, the hook:
1. Reads `localStorage.getItem('theme')`.
2. Falls back to `window.matchMedia('(prefers-color-scheme: dark)').matches`.
3. Adds/removes the `dark` class on `document.documentElement`.
4. `toggle()` flips the stored preference and the class.

**C3 — Dark mode toggle button (web/src/components/DarkModeToggle.tsx, new file)**

```ts
interface DarkModeToggleProps {}
export default function DarkModeToggle(_props: DarkModeToggleProps): JSX.Element
```

Renders a sun/moon icon button. Placed in the top-right corner of the root
layout in `App.tsx`.

**C4 — Frontend API extension (web/src/api.ts)**

Agent C adds:

```ts
export async function startWave(slug: string, implPath: string): Promise<void>
```

Posts to `POST /api/wave/{slug}/start` with body `{ impl_path: implPath }`.
Returns void on 202; throws on any other status.

**C5 — App.tsx: wire start-wave button and dark mode toggle**

After approve, the ReviewScreen's `onApprove` currently calls `approveImpl`
(which just publishes a broker event) and then transitions to the `wave` screen.
Agent C changes `handleApprove` in `App.tsx` to also call `startWave(slug,
implPath)` so wave execution starts automatically from the browser. The `impl`
path is derived from `slug` using the same convention as `handleGetImpl`:
`docs/IMPL/IMPL-{slug}.md` relative to the repo root — but since the frontend
does not know the absolute repo path, Agent C passes only the slug; the backend
`handleWaveStart` resolves the absolute path using `s.cfg.IMPLDir`.

Revised contract for `handleWaveStart` request body:

```go
// Agent B implements this — implPath OR slug accepted:
type waveStartRequest struct {
    Slug     string `json:"slug"`      // preferred: server resolves to ImplPath
    ImplPath string `json:"impl_path"` // alternative: used if Slug blank
}
```

Frontend call:

```ts
export async function startWave(slug: string): Promise<void>
// POST /api/wave/{slug}/start  — body: {}  (slug is in the URL)
```

This is simpler: slug is already in the path, body can be empty. Agent B reads
the slug from `r.PathValue("slug")` and constructs the path as
`filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")` — same as `handleGetImpl`.

**Revised B1 (binding):**

```go
// handleWaveStart serves POST /api/wave/{slug}/start.
// No request body required — slug is in the URL path.
// 409 if already running. 202 Accepted immediately.
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request)
```

No request body struct needed. Agent C's `startWave` sends an empty POST.

```ts
export async function startWave(slug: string): Promise<void> {
  const response = await fetch(`/api/wave/${encodeURIComponent(slug)}/start`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}
```

---

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `pkg/orchestrator/events.go` (new) | A | 1 | — |
| `pkg/orchestrator/orchestrator.go` | A | 1 | — |
| `pkg/orchestrator/orchestrator_test.go` | A | 1 | — |
| `pkg/api/wave_runner.go` (new) | B | 1 | — |
| `pkg/api/server.go` | B | 1 | — |
| `pkg/api/server_test.go` | B | 1 | — |
| `web/tailwind.config.js` | C | 1 | — |
| `web/src/hooks/useDarkMode.ts` (new) | C | 1 | — |
| `web/src/components/DarkModeToggle.tsx` (new) | C | 1 | — |
| `web/src/App.tsx` | C | 1 | — |
| `web/src/api.ts` | C | 1 | — |
| `web/src/components/ReviewScreen.tsx` | C | 1 | — |
| `web/src/components/WaveBoard.tsx` | C | 1 | — |
| `web/src/components/AgentCard.tsx` | C | 1 | — |
| `web/src/components/ProgressBar.tsx` | C | 1 | — |
| `web/src/components/SuitabilityBadge.tsx` | C | 1 | — |
| `web/src/components/ActionButtons.tsx` | C | 1 | — |
| `web/src/components/FileOwnershipTable.tsx` | C | 1 | — |
| `web/src/components/WaveStructureDiagram.tsx` | C | 1 | — |
| `web/src/components/InterfaceContracts.tsx` | C | 1 | — |
| `web/src/index.css` | C | 1 | — |

---

### Wave Structure

Wave 1: [A] [B] [C]    <- 3 parallel agents, all independent

No downstream waves. All outputs are merged directly.

---

### Agent Prompts

---

#### Agent A — SSE Bridge (orchestrator → broker)

**agent:** A
**wave:** 1
**branch:** `wave1-agent-a`
**worktree:** `<repo>/.worktrees/wave1-a`

**owns:**
- `pkg/orchestrator/events.go` (new)
- `pkg/orchestrator/orchestrator.go`
- `pkg/orchestrator/orchestrator_test.go`

**context:**

The SSE broker in `pkg/api/wave.go` has a working `Publish(slug string, ev SSEEvent)` method, but nothing calls it during wave execution. The orchestrator drives wave execution in `RunWave` and `launchAgent` but has no way to call the broker — importing `pkg/api` from `pkg/orchestrator` would create an import cycle. The fix is a plain function-valued field (`eventPublisher`) that the API layer injects at runtime.

**task:**

1. Create `pkg/orchestrator/events.go`. Define:
   - `OrchestratorEvent` struct with `Event string` and `Data interface{}` fields.
   - Payload structs: `AgentStartedPayload`, `AgentCompletePayload`, `AgentFailedPayload`, `WaveCompletePayload`, `RunCompletePayload` — exact field names and JSON tags as specified in the Interface Contracts section of this IMPL doc.
   - `EventPublisher` type: `type EventPublisher func(ev OrchestratorEvent)`.
   - `(o *Orchestrator) SetEventPublisher(pub EventPublisher)` method that stores `pub` in a new `eventPublisher EventPublisher` field on `Orchestrator`.

2. Modify `pkg/orchestrator/orchestrator.go`:
   - Add `eventPublisher EventPublisher` field to the `Orchestrator` struct.
   - Add a private helper `func (o *Orchestrator) publish(ev OrchestratorEvent)` that calls `o.eventPublisher(ev)` if non-nil, otherwise no-ops.
   - In `launchAgent`:
     - After worktree is created (step a) and before `ExecuteWithTools` (step c), call `o.publish(OrchestratorEvent{Event: "agent_started", Data: AgentStartedPayload{Agent: agentSpec.Letter, Wave: waveNum, Files: agentSpec.Files}})`. If `agentSpec.Files` is not a field on `AgentSpec`, use `[]string{}`.
     - After `waitForCompletionFunc` succeeds (step d), call `o.publish(OrchestratorEvent{Event: "agent_complete", Data: AgentCompletePayload{Agent: agentSpec.Letter, Wave: waveNum, Status: "complete", Branch: fmt.Sprintf("wave%d-agent-%s", waveNum, strings.ToLower(agentSpec.Letter))}})`.
     - If `launchAgent` is about to return a non-nil error (wrap the error return paths), publish `OrchestratorEvent{Event: "agent_failed", Data: AgentFailedPayload{Agent: agentSpec.Letter, Wave: waveNum, Status: "failed", FailureType: "execution_error", Message: err.Error()}}` before returning.
   - In `RunWave`, after `eg.Wait()` returns nil, call `o.publish(OrchestratorEvent{Event: "wave_complete", Data: WaveCompletePayload{Wave: waveNum, MergeStatus: "pending"}})`.

3. Update `pkg/orchestrator/orchestrator_test.go` to add tests:
   - `TestSetEventPublisher_PublishesAgentStarted`: inject a capturing publisher, call `RunWave` on a doc with one agent (use `newFromDoc` and the existing fake seams `worktreeCreatorFunc`, `waitForCompletionFunc`, `newRunnerFunc`), verify that an `agent_started` event was published.
   - `TestSetEventPublisher_PublishesAgentComplete`: verify `agent_complete` event after a successful wave.
   - `TestSetEventPublisher_NilPublisher_NoOp`: verify that when no publisher is set, `RunWave` still succeeds (no nil-pointer panic).

**verification gate:**
```bash
cd /path/to/repo
go build ./...
go vet ./...
go test ./pkg/orchestrator/... -run 'TestSetEventPublisher|TestRunWave' -v -timeout 60s
```

**out-of-scope:** Do not touch `pkg/api/`, `cmd/saw/`, or `web/`.

**completion report:** Append to `docs/IMPL/IMPL-live-ui.md`:

```markdown
## Agent A Completion Report

status: complete | partial | blocked
files_changed:
  - pkg/orchestrator/events.go
  - pkg/orchestrator/orchestrator.go
  - pkg/orchestrator/orchestrator_test.go
interface_deviations: none | <description>  (downstream_action_required: true/false)
notes: <any relevant notes>
```

---

#### Agent B — `saw serve` + wave execution unification

**agent:** B
**wave:** 1
**branch:** `wave1-agent-b`
**worktree:** `<repo>/.worktrees/wave1-b`

**owns:**
- `pkg/api/wave_runner.go` (new)
- `pkg/api/server.go`
- `pkg/api/server_test.go`

**context:**

The `pkg/api` server currently has `GET /api/wave/{slug}/events` for SSE streaming, and `POST /api/impl/{slug}/approve` which publishes a `plan_approved` event. But clicking Approve in the browser does not actually start wave execution — that requires a separate `saw wave` CLI invocation. This agent adds `POST /api/wave/{slug}/start` which launches wave execution in a background goroutine, publishing SSE events via the existing broker as the orchestrator progresses.

Agent A (concurrent) adds `SetEventPublisher` and `EventPublisher` to the orchestrator. You will call those. If Agent A's work is not yet merged when you test, stub out the `SetEventPublisher` call behind a build tag or an `// TODO` comment and verify the endpoint skeleton compiles without it.

**task:**

1. Create `pkg/api/wave_runner.go`. This file contains:

   a. A `runWaveLoop` package-private function that mirrors the wave loop in
      `cmd/saw/commands.go::runWave` but accepts an orchestrator interface and a
      publish hook instead of printing to stdout. Signature:

      ```go
      // waveRunOrchestrator is the minimal interface needed by runWaveLoop.
      type waveRunOrchestrator interface {
          TransitionTo(newState types.State) error
          RunWave(waveNum int) error
          MergeWave(waveNum int) error
          RunVerification(testCommand string) error
          UpdateIMPLStatus(waveNum int) error
          IMPLDoc() *types.IMPLDoc
          SetEventPublisher(pub orchestrator.EventPublisher)
      }
      ```

      Import `github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator`
      and `github.com/blackwell-systems/scout-and-wave-go/pkg/types`.

      ```go
      func runWaveLoop(o waveRunOrchestrator, slug string, broker *sseBroker) error
      ```

      The function:
      - Calls `o.SetEventPublisher(makePublisher(slug, broker))`.
      - Advances state: `ScoutPending → Reviewed → WavePending`.
      - Iterates all waves in `o.IMPLDoc().Waves` in order (wave 1 onward).
      - For each wave: `RunWave`, transition to `WaveExecuting`, `MergeWave`,
        `RunVerification`, `UpdateIMPLStatus`, transition to `WaveVerified`.
      - After all waves: transition to `Complete`, publish
        `run_complete` event via broker.
      - Returns any non-nil error encountered.

   b. `makePublisher(slug string, broker *sseBroker) orchestrator.EventPublisher`:
      Returns a function that maps `orchestrator.OrchestratorEvent` →
      `SSEEvent` and calls `broker.Publish(slug, ...)`. Map the `Event` field
      directly; marshal `Data` as-is.

   c. `handleWaveStart(w http.ResponseWriter, r *http.Request)` method on `*Server`:
      - Reads `slug` from `r.PathValue("slug")`.
      - Checks `s.activeRuns` (`sync.Map`); if the slug key exists, writes 409 and returns.
      - Stores the slug in `s.activeRuns`.
      - Constructs `implPath = filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")`.
      - Creates `orchestrator.New(s.cfg.RepoPath, implPath)`.
      - Launches a goroutine: calls `runWaveLoop(o, slug, s.broker)`, then deletes
        slug from `s.activeRuns`. Log errors to stderr with `log.Printf`.
      - Writes 202 Accepted.

2. Modify `pkg/api/server.go`:
   - Add `activeRuns sync.Map` field to `Server`.
   - Register route in `New`:
     ```go
     s.mux.HandleFunc("POST /api/wave/{slug}/start", s.handleWaveStart)
     ```

3. Add tests to `pkg/api/server_test.go`:
   - `TestHandleWaveStart_Returns202`: POST to `/api/wave/myfeature/start`, verify 202.
   - `TestHandleWaveStart_Returns409WhenAlreadyRunning`: mark a slug active in
     `s.activeRuns`, POST again, verify 409.

   For these tests, the goroutine that calls `runWaveLoop` will attempt to create
   a real orchestrator and run waves — that will fail quickly on a temp dir with
   no real IMPL doc. Use `t.Cleanup` or a short timeout to let the goroutine
   complete. Alternatively, inject a `waveRunnerFunc` seam (package-level var,
   like the existing seams in orchestrator.go) so tests can replace it with a
   no-op. Your choice — use whichever approach keeps tests fast and reliable.

**verification gate:**
```bash
cd /path/to/repo
go build ./...
go vet ./...
go test ./pkg/api/... -run 'TestHandleWaveStart|TestHandleGetImpl|TestHandleApprove|TestHandleWaveEvents' -v -timeout 60s
```

**out-of-scope:** Do not touch `pkg/orchestrator/`, `cmd/saw/`, or `web/`.

**completion report:** Append to `docs/IMPL/IMPL-live-ui.md`:

```markdown
## Agent B Completion Report

status: complete | partial | blocked
files_changed:
  - pkg/api/wave_runner.go
  - pkg/api/server.go
  - pkg/api/server_test.go
interface_deviations: none | <description>  (downstream_action_required: true/false)
notes: <any relevant notes>
```

---

#### Agent C — Dark mode + frontend start-wave wiring

**agent:** C
**wave:** 1
**branch:** `wave1-agent-c`
**worktree:** `<repo>/.worktrees/wave1-c`

**owns:**
- `web/tailwind.config.js`
- `web/src/hooks/useDarkMode.ts` (new)
- `web/src/components/DarkModeToggle.tsx` (new)
- `web/src/App.tsx`
- `web/src/api.ts`
- `web/src/components/ReviewScreen.tsx`
- `web/src/components/WaveBoard.tsx`
- `web/src/components/AgentCard.tsx`
- `web/src/components/ProgressBar.tsx`
- `web/src/components/SuitabilityBadge.tsx`
- `web/src/components/ActionButtons.tsx`
- `web/src/components/FileOwnershipTable.tsx`
- `web/src/components/WaveStructureDiagram.tsx`
- `web/src/components/InterfaceContracts.tsx`
- `web/src/index.css`

**context:**

The React frontend uses Tailwind CSS utility classes throughout. Tailwind supports
dark mode via `darkMode: 'class'` — when the `dark` class is present on
`<html>`, all `dark:` prefixed utilities apply. The current components use light
backgrounds (`bg-gray-50`, `bg-white`) and light text (`text-gray-800`,
`text-gray-500`) with no dark variants. Dark mode needs to be added to every
component.

Additionally, the Approve button in ReviewScreen currently calls `approveImpl`
(which publishes a broker event) and transitions to WaveBoard. Agent B (parallel)
adds `POST /api/wave/{slug}/start`; you must call it after approve so wave
execution begins from the browser. You only need to add `startWave` to `api.ts`
and call it in `App.tsx::handleApprove` — the backend handles the rest.

**task:**

**Part 1 — Tailwind dark mode config:**

1. In `web/tailwind.config.js`, add `darkMode: 'class'` to the config object.

**Part 2 — Dark mode hook and toggle:**

2. Create `web/src/hooks/useDarkMode.ts`:
   ```ts
   export function useDarkMode(): [boolean, () => void] {
     // Read initial preference: localStorage 'theme' key ('dark'/'light'),
     // fallback to system prefers-color-scheme
     // Apply 'dark' class to document.documentElement
     // Return [isDark, toggle]
     // toggle flips isDark, saves to localStorage, updates document class
   }
   ```
   Use `useState` and `useEffect`.

3. Create `web/src/components/DarkModeToggle.tsx`:
   - Calls `useDarkMode()` to get `[isDark, toggle]`.
   - Renders a button with a sun icon when dark, moon icon when light.
   - Use inline SVG for icons (no external icon library).
   - Classes: `p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors`.

**Part 3 — Add dark variants to all components:**

For each component below, add `dark:` Tailwind variants to every color utility
class. Follow this mapping:

| Light | Dark |
|-------|------|
| `bg-white` | `dark:bg-gray-900` |
| `bg-gray-50` | `dark:bg-gray-950` |
| `bg-gray-100` | `dark:bg-gray-800` |
| `bg-gray-200` | `dark:bg-gray-700` |
| `text-gray-800` / `text-gray-900` | `dark:text-gray-100` |
| `text-gray-600` / `text-gray-700` | `dark:text-gray-300` |
| `text-gray-500` | `dark:text-gray-400` |
| `text-gray-400` | `dark:text-gray-500` |
| `border-gray-200` | `dark:border-gray-700` |
| `border-gray-100` | `dark:border-gray-800` |

Status-specific colours (AgentCard, WaveBoard scaffold badge) can remain as-is
(green/blue/red) since those are semantic and visible in both modes. Alternatively
add mild dark variants like `dark:bg-green-900 dark:text-green-300` — your
discretion, but be consistent.

Components to update:
- `ReviewScreen.tsx` — outer div, header text, slug text
- `WaveBoard.tsx` — outer div, wave containers, empty state text, header
- `AgentCard.tsx` — card border/bg, agent name text, file list text
- `ProgressBar.tsx` — track bg, label text
- `SuitabilityBadge.tsx` — rationale text (badge colours are semantic, leave them)
- `ActionButtons.tsx` — border-t colour, button colours are semantic (leave green/red/yellow)
- `FileOwnershipTable.tsx` — table container, header row, cell text, row bg colours
- `WaveStructureDiagram.tsx` — container border/bg, wave label text, down-arrow colour
- `InterfaceContracts.tsx` — container, header row, pre bg/text, placeholder text

**Part 4 — App.tsx: layout, dark toggle, and start-wave wiring:**

4. In `App.tsx`:
   - Add `DarkModeToggle` to all three screen states (input screen, review screen
     wrapper, wave screen wrapper). Position it top-right using `absolute` or
     `fixed` positioning, or wrap each screen in a container div. Keep it simple
     — a `fixed top-4 right-4` works well.
   - In `handleApprove`, after `await approveImpl(slug)`, also call
     `await startWave(slug)`. Import `startWave` from `./api`. If `startWave`
     throws (e.g. 409 because a run is already in progress), swallow the error
     and still transition to the wave screen — the user can watch the existing
     run's SSE stream.

5. In `web/src/api.ts`, add:
   ```ts
   export async function startWave(slug: string): Promise<void> {
     const response = await fetch(`/api/wave/${encodeURIComponent(slug)}/start`, {
       method: 'POST',
     })
     if (!response.ok) {
       throw new Error(`HTTP ${response.status}: ${await response.text()}`)
     }
   }
   ```

**Part 5 — index.css dark body background:**

6. In `web/src/index.css`, add after the Tailwind directives:
   ```css
   html.dark body {
     background-color: #030712; /* gray-950 */
   }
   ```

**verification gate:**
```bash
cd /path/to/repo/web
npm install
npm run build
# Build must complete with 0 errors and 0 TypeScript errors
```

**out-of-scope:** Do not touch `pkg/`, `cmd/`, or `go.mod`.

**completion report:** Append to `docs/IMPL/IMPL-live-ui.md`:

```markdown
## Agent C Completion Report

status: complete | partial | blocked
files_changed:
  - web/tailwind.config.js
  - web/src/hooks/useDarkMode.ts
  - web/src/components/DarkModeToggle.tsx
  - web/src/App.tsx
  - web/src/api.ts
  - web/src/components/ReviewScreen.tsx
  - web/src/components/WaveBoard.tsx
  - web/src/components/AgentCard.tsx
  - web/src/components/ProgressBar.tsx
  - web/src/components/SuitabilityBadge.tsx
  - web/src/components/ActionButtons.tsx
  - web/src/components/FileOwnershipTable.tsx
  - web/src/components/WaveStructureDiagram.tsx
  - web/src/components/InterfaceContracts.tsx
  - web/src/index.css
interface_deviations: none | <description>  (downstream_action_required: true/false)
notes: <any relevant notes>
```

---

### Wave Execution Loop

After Wave 1 completes, work through the Orchestrator Post-Merge Checklist below.

The merge procedure is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks
  the merge entirely.
- Interface deviations with `downstream_action_required: true` must be propagated
  before any downstream agent launches (no downstream agents in this feature, but
  deviations may require orchestrator fixup).
- Post-merge verification catches cross-package failures none of the agents saw in
  isolation (Agent B imports Agent A's `orchestrator.EventPublisher`; this is the
  critical cross-agent link).
- Fix before proceeding.

### Orchestrator Post-Merge Checklist

After wave 1 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`; if any
      `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — cross-reference `files_changed` lists; Agent A owns
      `orchestrator.go`, Agent B owns `server.go`/`wave_runner.go`, Agent C owns
      all `web/` files — no overlaps expected; verify before touching working tree
- [ ] Review `interface_deviations` — if Agent A changed `OrchestratorEvent` or
      `EventPublisher` signature, update Agent B's `makePublisher` accordingly;
      `downstream_action_required: true` here means a manual fixup patch is needed
      before the build will pass
- [ ] Merge each agent: `git merge --no-ff <branch> -m "Merge wave1-agent-{X}: <desc>"`
      Suggested order: A first (establishes EventPublisher type), then B (imports it),
      then C (independent)
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for each
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: `go vet ./...` (check mode; no auto-fix needed)
      - [ ] `go build ./... && go vet ./... && go test ./...` — backend full suite
      - [ ] `cd web && npm install && npm run build` — frontend build
- [ ] Fix any cascade failures — `pkg/api/wave_runner.go` imports
      `pkg/orchestrator`; if Agent A's `events.go` introduced a type Agent B
      references by a different name, fix the import in `wave_runner.go` here
- [ ] Tick status checkboxes in this IMPL doc for completed agents
- [ ] Update interface contracts for any deviations logged by agents
- [ ] Apply `out_of_scope_deps` fixes flagged in completion reports
- [ ] Feature-specific steps:
      - [ ] Verify `saw serve` starts cleanly: `go run ./cmd/saw serve --no-browser`
      - [ ] Verify the dark mode toggle appears and switches themes in the browser
      - [ ] Verify that clicking Approve in the UI triggers a POST to `/api/wave/{slug}/start`
            (check browser devtools Network tab or server logs)
      - [ ] Verify SSE events appear in WaveBoard when a wave runs
- [ ] Commit: `git commit -m "feat: live UI — SSE bridge, serve+wave unification, dark mode"`
- [ ] No further waves.

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | SSE bridge: OrchestratorEvent, EventPublisher, publish calls in launchAgent/RunWave | TO-DO |
| 1 | B | serve+wave: POST /api/wave/{slug}/start, runWaveLoop, activeRuns guard | TO-DO |
| 1 | C | Dark mode: Tailwind class strategy, useDarkMode hook, DarkModeToggle, dark: variants on all components, startWave wiring | TO-DO |
| — | Orch | Post-merge integration, build verification, binary install | TO-DO |

---

### Agent A - Completion Report

```yaml
status: complete
worktree: /Users/dayna.blackwell/code/scout-and-wave-go/.claude/worktrees/wave1-agent-A
branch: wave1-agent-A
files_changed:
  - pkg/orchestrator/events.go (created, +56 lines)
  - pkg/orchestrator/orchestrator.go (modified, +57/-3 lines)
  - pkg/orchestrator/orchestrator_test.go (modified, +76 lines)
interface_deviations: none
notes: |
  All types match the interface contracts exactly. One adaptation: AgentSpec.FilesOwned
  (not OwnedFiles) is the actual field name on types.AgentSpec — used in the
  AgentStartedPayload.Files field. Branch naming uses the convention
  "saw/wave{N}-agent-{Letter}" for the Branch field in AgentCompletePayload.

  The 'go build ./...' command fails due to web/embed.go referencing a missing
  web/dist directory (pre-existing issue, not introduced here). All orchestrator
  package builds, vets, and tests pass cleanly with 35/35 tests passing.

  Two new tests added:
  - TestSetEventPublisher_NilPublisher_NoOp: verifies no panic when no publisher set
  - TestPublish_EmitsAgentStarted: verifies agent_started event is received by injected publisher
```
