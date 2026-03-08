# IMPL: GUI Phase 1 + Phase 2 (v0.17.0 + v0.18.0)
<!-- SAW:COMPLETE 2026-03-08 -->

## Suitability Assessment

Verdict: SUITABLE
test_command: `go test ./... && cd web && npm test -- --watchAll=false`
lint_command: `go vet ./...`

This feature set decomposes cleanly across 13 agents in 3 waves. The work spans
Go backend handlers (`pkg/api/`) and React frontend components
(`web/src/components/`, `web/src/hooks/`, `web/src/api.ts`, `web/src/types.ts`).
Route registration is owned exclusively by Agent A (Wiring) in Wave 1, which adds
all new routes to `server.go` as stubs — downstream handler agents fill in the
bodies without touching `server.go`. `api.ts` and `types.ts` are similarly
single-owner (Agent B, Wave 1). This prevents the shared-file conflicts that
typically block parallelization in full-stack features.

Pre-implementation scan results:
- Total items: 15 features
- Already implemented: 2 items (v0.17.0-A Merge Button, v0.17.0-B Post-Merge Test Runner)
- Partially implemented: 2 items (v0.18.0-D Failure Type Actions, v0.18.0-H NOT SUITABLE View)
- To-do: 11 items

Agent adjustments:
- Agents for v0.17.0-A and v0.17.0-B removed entirely (already implemented, UI + backend complete)
- Agent D (Failure Type Actions) changed to "complete the implementation" — backend SSE already sends failure_type, AgentCard shows label; need type-specific action buttons in WaveBoard
- Agent H (NOT SUITABLE View) changed to "complete the implementation" — ReviewScreen already dims panels; need dedicated research panels + Archive button

Estimated time saved: ~30 minutes (avoided reimplementing merge button and test runner)

Estimated times:
- Scout phase: ~20 min (large feature set, 15 items)
- Agent execution: ~90 min (13 agents × ~7 min avg, accounting for parallelism across 3 waves)
- Merge & verification: ~15 min
Total SAW time: ~125 min

Sequential baseline: ~195 min (13 agents × 15 min avg sequential)
Time savings: ~70 min (36% faster)

Recommendation: Clear speedup. Wave 1 has 4 fully independent agents (backend handlers,
frontend types, new components, app routing). Maximum parallelism in Wave 1.

---

## Scaffolds

No scaffolds needed — agents have independent type ownership. New Go types are added
to `pkg/api/types.go` by Agent A (Wave 1 Wiring); new TS types are added to
`web/src/types.ts` by Agent B (Wave 1 Frontend Types). Wave 2+ agents import from these.

---

## Pre-Mortem

**Overall risk:** medium

**Failure modes:**

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| Agent A stubs wrong route patterns in server.go causing 404s for Wave 2 handlers | medium | high | Interface Contracts section specifies exact route strings; Agent A must copy them verbatim |
| Agent B adds TS types that conflict with existing types.ts shape | low | medium | Contracts specify additive-only changes; agent reads existing file first |
| Wave 2 diff viewer agent uses wrong git command for per-agent diff | medium | medium | Contract specifies exact `git diff main...{branch} -- {file}` form |
| Settings screen `saw.config.json` hot-reload requires server restart | low | low | Config endpoint is load/save only; no live watcher in v0.18.0-C scope |
| Chat with Claude (v0.18.0-B) requires Claude API key in server config | high | medium | Agent must gate on API key presence; show "Configure API key in Settings" if absent |
| Quality Gates section absent from many existing IMPL docs — empty state needed | medium | low | Agent F must handle missing section gracefully with empty state |
| CONTEXT.md viewer (v0.18.0-G) path is repo-relative; wrong root causes 404 | low | medium | Handler uses `s.cfg.RepoPath` as base; contract is explicit about this |
| Per-agent context endpoint (v0.18.0-K) requires parsing agent letter from file ownership; parser may miss agents | medium | medium | Agent K reads file ownership table and iterates; falls back to full doc if agent not found |

---

## Known Issues

- `TestDoctorHelpIncludesFixNote` in some versions hangs — not present in this repo
- `web/src/components/FileOwnershipTableNew.tsx.bak` is a stale backup file; agents must not touch it
- The existing `WaveBoard.tsx` has local stub interfaces `WaveMergeState`/`WaveTestState` with a comment saying to replace with imports from `useWaveEvents` — Agent D should clean this up while touching WaveBoard

---

## Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (4 parallel agents — foundation):
    [A] pkg/api/server.go
         Wiring agent: adds stub route registrations for all new API endpoints
         ✓ root (no dependencies on other agents)

    [B] web/src/types.ts
        web/src/api.ts
         Frontend types + API client: adds TS interfaces and fetch functions for all new endpoints
         ✓ root (no dependencies on other agents)

    [C] pkg/api/diff_handler.go (new)
        pkg/api/worktree_handler.go (new)
        pkg/api/context_handler.go (new)
        pkg/api/config_handler.go (new)
        pkg/api/agent_context_handler.go (new)
         Backend handlers: implements diff, worktree, CONTEXT.md, config, and per-agent-context endpoints
         ✓ root (reads server.go stub routes but does not write to it)

    [D] web/src/components/review/QualityGatesPanel.tsx (new)
        web/src/components/review/NotSuitableResearchPanel.tsx (new)
        web/src/components/review/FileDiffPanel.tsx (new)
        web/src/components/review/ContextViewerPanel.tsx (new)
         New review panel components: Quality Gates, NOT SUITABLE, File Diff, CONTEXT.md viewer
         ✓ root (pure UI components with no cross-agent deps in Wave 1)

Wave 2 (4 parallel agents — integration):
    [E] web/src/components/WaveBoard.tsx
         Complete failure-type action buttons (v0.18.0-D)
         depends on: [B] (api.ts rerunAgent fn), [A] (no new routes needed)

    [F] web/src/components/ReviewScreen.tsx
         Wire new panels into ReviewScreen: QualityGates, NOT SUITABLE Research, FileDiff trigger,
         CONTEXT.md viewer toggle; update PanelKey union; handle NOT SUITABLE archive flow
         depends on: [B] (new types), [D] (panel components)

    [G] web/src/components/ScoutLauncher.tsx
         Add context panel (v0.18.0-A): file attachments, notes, constraint checkboxes;
         wire context into scout run payload
         depends on: [B] (api.ts runScout signature update)

    [H] web/src/components/SettingsScreen.tsx (new)
        web/src/App.tsx
         Settings screen + App routing: gear icon in header, /settings route,
         settings panel with repo/agent/quality-gate/appearance sections
         depends on: [B] (api.ts getConfig/saveConfig), [C] (config handler live)

Wave 3 (2 parallel agents — intelligence layer):
    [I] web/src/components/ChatPanel.tsx (new)
        web/src/hooks/useChatWithClaude.ts (new)
        pkg/api/chat_handler.go (new)
         Chat with Claude about the plan (v0.18.0-B)
         depends on: [A] (route stub), [B] (types/api), [F] (ReviewScreen integration point)

    [J] pkg/api/agent_context_handler.go
        web/src/components/review/AgentContextToggle.tsx (new)
         Per-agent context payload (v0.18.0-K): backend serves trimmed context,
         frontend toggle on agent cards in ReviewScreen
         depends on: [A] (route stub), [B] (types/api), [C] (agent_context_handler body)
```

---

## Interface Contracts

### New Go API routes (added to server.go by Agent A)

```go
// Agent A adds these to New() in pkg/api/server.go — bodies are stubs (http.NotFound)
// Wave 2/3 agents fill in the actual handlers.

// v0.17.0-C  File diff viewer
s.mux.HandleFunc("GET /api/impl/{slug}/diff/{agent}", s.handleImplDiff)

// v0.17.0-D  Worktree manager
s.mux.HandleFunc("GET /api/impl/{slug}/worktrees", s.handleListWorktrees)
s.mux.HandleFunc("DELETE /api/impl/{slug}/worktrees/{branch}", s.handleDeleteWorktree)

// v0.18.0-B  Chat with Claude
s.mux.HandleFunc("POST /api/impl/{slug}/chat", s.handleImplChat)
s.mux.HandleFunc("GET /api/impl/{slug}/chat/{runID}/events", s.handleImplChatEvents)

// v0.18.0-C  Settings
s.mux.HandleFunc("GET /api/config", s.handleGetConfig)
s.mux.HandleFunc("POST /api/config", s.handleSaveConfig)

// v0.18.0-G  CONTEXT.md viewer
s.mux.HandleFunc("GET /api/context", s.handleGetContext)
s.mux.HandleFunc("PUT /api/context", s.handlePutContext)

// v0.18.0-I  Scaffold rerun
s.mux.HandleFunc("POST /api/impl/{slug}/scaffold/rerun", s.handleScaffoldRerun)

// v0.18.0-K  Per-agent context payload
s.mux.HandleFunc("GET /api/impl/{slug}/agent/{letter}/context", s.handleGetAgentContext)
```

### New Go types (added to pkg/api/types.go by Agent A)

```go
// WorktreeEntry describes one SAW-managed git worktree.
type WorktreeEntry struct {
    Branch    string `json:"branch"`
    Path      string `json:"path"`
    Status    string `json:"status"` // "merged", "unmerged", "stale"
    HasUnsaved bool  `json:"has_unsaved"`
}

// WorktreeListResponse is the JSON body for GET /api/impl/{slug}/worktrees.
type WorktreeListResponse struct {
    Worktrees []WorktreeEntry `json:"worktrees"`
}

// FileDiffRequest is the query parameter shape for GET /api/impl/{slug}/diff/{agent}.
// Passed as ?wave=N query param.
type FileDiffRequest struct {
    Wave int    `json:"wave"`
    File string `json:"file"` // URL-encoded file path (query param)
}

// FileDiffResponse is the JSON body for GET /api/impl/{slug}/diff/{agent}.
type FileDiffResponse struct {
    Agent  string `json:"agent"`
    File   string `json:"file"`
    Branch string `json:"branch"`
    Diff   string `json:"diff"` // raw unified diff text
}

// SAWConfig is the shape of saw.config.json and the GET/POST /api/config body.
type SAWConfig struct {
    Repo    RepoConfig    `json:"repo"`
    Agent   AgentConfig   `json:"agent"`
    Quality QualityConfig `json:"quality"`
    Appear  AppearConfig  `json:"appearance"`
}

type RepoConfig struct {
    Path string `json:"path"`
}

type AgentConfig struct {
    ScoutModel string `json:"scout_model"`
    WaveModel  string `json:"wave_model"`
}

type QualityConfig struct {
    RequireTests    bool `json:"require_tests"`
    RequireLint     bool `json:"require_lint"`
    BlockOnFailure  bool `json:"block_on_failure"`
}

type AppearConfig struct {
    Theme string `json:"theme"` // "system", "light", "dark"
}

// ChatRequest is the JSON body for POST /api/impl/{slug}/chat.
type ChatRequest struct {
    Message  string `json:"message"`
    History  []ChatMessage `json:"history"`
}

// ChatMessage is one turn in the chat history.
type ChatMessage struct {
    Role    string `json:"role"`    // "user" | "assistant"
    Content string `json:"content"`
}

// ChatRunResponse is the JSON body returned by POST /api/impl/{slug}/chat.
type ChatRunResponse struct {
    RunID string `json:"run_id"`
}

// AgentContextResponse is the JSON body for GET /api/impl/{slug}/agent/{letter}/context.
type AgentContextResponse struct {
    Slug        string `json:"slug"`
    Agent       string `json:"agent"`
    Wave        int    `json:"wave"`
    ContextText string `json:"context_text"` // trimmed IMPL doc sections relevant to this agent
}
```

### New TypeScript types (added to web/src/types.ts by Agent B)

```typescript
// Worktree manager
export interface WorktreeEntry {
  branch: string
  path: string
  status: 'merged' | 'unmerged' | 'stale'
  has_unsaved: boolean
}

export interface WorktreeListResponse {
  worktrees: WorktreeEntry[]
}

// File diff viewer
export interface FileDiffResponse {
  agent: string
  file: string
  branch: string
  diff: string
}

// Settings
export interface SAWConfig {
  repo: { path: string }
  agent: { scout_model: string; wave_model: string }
  quality: { require_tests: boolean; require_lint: boolean; block_on_failure: boolean }
  appearance: { theme: 'system' | 'light' | 'dark' }
}

// Chat with Claude
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Quality Gates (parsed from IMPL doc)
export interface QualityGate {
  command: string
  required: boolean
  description: string
}

// Scout context (v0.18.0-A)
export interface ScoutContext {
  files: string[]         // pasted file paths
  notes: string           // free text
  constraints: string[]   // selected checkbox values
}

// Agent context payload (v0.18.0-K)
export interface AgentContextResponse {
  slug: string
  agent: string
  wave: number
  context_text: string
}
```

### New TypeScript API functions (added to web/src/api.ts by Agent B)

```typescript
// Worktree manager
export async function listWorktrees(slug: string): Promise<WorktreeListResponse>
export async function deleteWorktree(slug: string, branch: string): Promise<void>

// File diff
export async function fetchFileDiff(slug: string, agent: string, wave: number, file: string): Promise<FileDiffResponse>

// Settings
export async function getConfig(): Promise<SAWConfig>
export async function saveConfig(config: SAWConfig): Promise<void>

// CONTEXT.md
export async function getContext(): Promise<string>  // returns raw markdown
export async function putContext(content: string): Promise<void>

// Chat
export async function startImplChat(slug: string, message: string, history: ChatMessage[]): Promise<{ runId: string }>
export function subscribeChatEvents(slug: string, runId: string): EventSource

// Scaffold rerun
export async function rerunScaffold(slug: string): Promise<void>

// Per-agent context
export async function fetchAgentContext(slug: string, agent: string): Promise<AgentContextResponse>

// Scout with context (updates existing runScout signature)
// New optional contextData parameter appended to feature description
export async function runScout(feature: string, repo?: string, context?: ScoutContext): Promise<{ runId: string }>
```

---

## File Ownership

```yaml type=impl-file-ownership
| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| pkg/api/server.go | A | 1 | — |
| pkg/api/types.go | A | 1 | — |
| web/src/types.ts | B | 1 | — |
| web/src/api.ts | B | 1 | — |
| pkg/api/diff_handler.go | C | 1 | — |
| pkg/api/worktree_handler.go | C | 1 | — |
| pkg/api/context_handler.go | C | 1 | — |
| pkg/api/config_handler.go | C | 1 | — |
| pkg/api/agent_context_handler.go | C | 1 | — |
| web/src/components/review/QualityGatesPanel.tsx | D | 1 | — |
| web/src/components/review/NotSuitableResearchPanel.tsx | D | 1 | — |
| web/src/components/review/FileDiffPanel.tsx | D | 1 | — |
| web/src/components/review/ContextViewerPanel.tsx | D | 1 | — |
| web/src/components/WaveBoard.tsx | E | 2 | A, B |
| web/src/components/ReviewScreen.tsx | F | 2 | B, D |
| web/src/components/ScoutLauncher.tsx | G | 2 | B |
| web/src/components/SettingsScreen.tsx | H | 2 | B, C |
| web/src/App.tsx | H | 2 | B, C |
| web/src/components/ChatPanel.tsx | I | 3 | A, B, F |
| web/src/hooks/useChatWithClaude.ts | I | 3 | A, B, F |
| pkg/api/chat_handler.go | I | 3 | A |
| web/src/components/review/AgentContextToggle.tsx | J | 3 | A, B, C |
```

---

## Wave Structure

```yaml type=impl-wave-structure
Wave 1: [A] [B] [C] [D]       <- 4 parallel agents (foundation: routes, types, handlers, panels)
              | (A+B+C+D complete)
Wave 2:   [E] [F] [G] [H]     <- 4 parallel agents (integration: WaveBoard, ReviewScreen, Scout, Settings)
              | (E+F+G+H complete)
Wave 3:      [I] [J]           <- 2 parallel agents (intelligence: Chat, AgentContext)
```

---

## Wave 1

Wave 1 lays the foundation. Agent A owns `server.go` exclusively and adds all new route registrations as stubs plus new Go types to `types.go`. Agent B owns `types.ts` and `api.ts` exclusively and adds all new TypeScript types and fetch functions. Agent C implements the five new backend handler files. Agent D creates four new React panel components. None of these agents overlap on any file.

### Agent A — Backend Wiring (routes + types)

**Role:** Add stub route registrations for all new v0.17.0-C/D and v0.18.0-B/C/G/I/K endpoints to `server.go`, and add new Go types to `types.go`. Handler bodies will be filled by Agent C in Wave 1 and Agents I/J in Wave 3.

**Files owned:**
- `pkg/api/server.go` — add route registrations (stubs only; do NOT implement handlers here)
- `pkg/api/types.go` — add new request/response types

**Context:** Read `pkg/api/server.go` and `pkg/api/types.go` before writing. The existing pattern is `s.mux.HandleFunc("METHOD /path/{param}", s.handlerFunc)`. New handler methods must be declared (but can panic/return 501) in a temporary stub file `pkg/api/stubs.go` so the package compiles. Agent C will replace these stubs.

**Tasks:**

1. In `server.go` `New()` function, add the following route registrations immediately after the existing `DELETE /api/impl/{slug}` registration:

```go
// v0.17.0-C — File diff viewer
s.mux.HandleFunc("GET /api/impl/{slug}/diff/{agent}", s.handleImplDiff)

// v0.17.0-D — Worktree manager
s.mux.HandleFunc("GET /api/impl/{slug}/worktrees", s.handleListWorktrees)
s.mux.HandleFunc("DELETE /api/impl/{slug}/worktrees/{branch}", s.handleDeleteWorktree)

// v0.18.0-B — Chat with Claude
s.mux.HandleFunc("POST /api/impl/{slug}/chat", s.handleImplChat)
s.mux.HandleFunc("GET /api/impl/{slug}/chat/{runID}/events", s.handleImplChatEvents)

// v0.18.0-C — Settings
s.mux.HandleFunc("GET /api/config", s.handleGetConfig)
s.mux.HandleFunc("POST /api/config", s.handleSaveConfig)

// v0.18.0-G — CONTEXT.md viewer
s.mux.HandleFunc("GET /api/context", s.handleGetContext)
s.mux.HandleFunc("PUT /api/context", s.handlePutContext)

// v0.18.0-I — Scaffold rerun
s.mux.HandleFunc("POST /api/impl/{slug}/scaffold/rerun", s.handleScaffoldRerun)

// v0.18.0-K — Per-agent context payload
s.mux.HandleFunc("GET /api/impl/{slug}/agent/{letter}/context", s.handleGetAgentContext)
```

2. Create `pkg/api/stubs.go` with stub method bodies (return 501 Not Implemented) for all new handler methods so the package compiles while Agent C writes the real implementations:

```go
package api
import "net/http"

func (s *Server) handleImplDiff(w http.ResponseWriter, r *http.Request)         { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleListWorktrees(w http.ResponseWriter, r *http.Request)    { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleDeleteWorktree(w http.ResponseWriter, r *http.Request)   { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleImplChat(w http.ResponseWriter, r *http.Request)         { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleImplChatEvents(w http.ResponseWriter, r *http.Request)   { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request)        { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request)       { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetContext(w http.ResponseWriter, r *http.Request)       { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handlePutContext(w http.ResponseWriter, r *http.Request)       { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleScaffoldRerun(w http.ResponseWriter, r *http.Request)    { http.Error(w, "not implemented", http.StatusNotImplemented) }
func (s *Server) handleGetAgentContext(w http.ResponseWriter, r *http.Request)  { http.Error(w, "not implemented", http.StatusNotImplemented) }
```

3. In `types.go`, append the new types listed in the Interface Contracts section above: `WorktreeEntry`, `WorktreeListResponse`, `FileDiffRequest`, `FileDiffResponse`, `SAWConfig` (with sub-structs `RepoConfig`, `AgentConfig`, `QualityConfig`, `AppearConfig`), `ChatRequest`, `ChatMessage`, `ChatRunResponse`, `AgentContextResponse`.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web
go build ./...
go vet ./...
go test ./pkg/api/... -run TestServer -timeout 2m
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [pkg/api/server.go, pkg/api/types.go, pkg/api/stubs.go]
interface_deviations: none | describe any
notes: ...
```

---

### Agent B — Frontend Types + API Client

**Role:** Add all new TypeScript interface types to `types.ts` and all new API fetch functions to `api.ts`. These are the contracts all Wave 2+ frontend agents import.

**Files owned:**
- `web/src/types.ts` — add new interfaces (additive only; do NOT modify existing interfaces)
- `web/src/api.ts` — add new fetch functions; update `runScout` to accept optional `context` parameter

**Context:** Read both files in full before writing. All additions are append-only except `runScout` which gets a third optional parameter `context?: ScoutContext`. Do not change the function signature in a way that breaks existing callers — the parameter is optional.

**Tasks:**

1. Append to `web/src/types.ts` (after existing exports):
   - `WorktreeEntry`, `WorktreeListResponse`, `FileDiffResponse`, `SAWConfig`, `ChatMessage`, `QualityGate`, `ScoutContext`, `AgentContextResponse`
   - Full definitions are in the Interface Contracts section above.

2. In `web/src/api.ts`, add after existing functions:
   - `listWorktrees(slug)` — GET `/api/impl/{slug}/worktrees`
   - `deleteWorktree(slug, branch)` — DELETE `/api/impl/{slug}/worktrees/{branch}`
   - `fetchFileDiff(slug, agent, wave, file)` — GET `/api/impl/{slug}/diff/{agent}?wave={wave}&file={file}`
   - `getConfig()` — GET `/api/config`
   - `saveConfig(config)` — POST `/api/config`
   - `getContext()` — GET `/api/context` (returns `r.text()`)
   - `putContext(content)` — PUT `/api/context`
   - `startImplChat(slug, message, history)` — POST `/api/impl/{slug}/chat`; returns `{ runId: data.run_id }`
   - `subscribeChatEvents(slug, runId)` — returns `new EventSource(...)`
   - `rerunScaffold(slug)` — POST `/api/impl/{slug}/scaffold/rerun`
   - `fetchAgentContext(slug, agent)` — GET `/api/impl/{slug}/agent/{letter}/context`

3. Update `runScout` to accept optional third parameter `context?: ScoutContext`. When present, serialize context fields and append to the request body as `context_files`, `context_notes`, `context_constraints`.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -50
```
(TypeScript compile errors will surface here. No test run needed — these are pure type/function additions.)

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/types.ts, web/src/api.ts]
interface_deviations: none | describe any
notes: ...
```

---

### Agent C — Backend Handlers (diff, worktrees, context, config, agent-context)

**Role:** Implement five new Go handler files for the new API endpoints. Stubs already exist (created by Agent A) — this agent replaces stub bodies with real logic.

**Files owned (all new files):**
- `pkg/api/diff_handler.go` — `handleImplDiff`
- `pkg/api/worktree_handler.go` — `handleListWorktrees`, `handleDeleteWorktree`
- `pkg/api/context_handler.go` — `handleGetContext`, `handlePutContext`
- `pkg/api/config_handler.go` — `handleGetConfig`, `handleSaveConfig`
- `pkg/api/agent_context_handler.go` — `handleGetAgentContext`

**Note:** After Agent A merges, the stubs in `stubs.go` will conflict with your implementations. Before writing your handler files, the orchestrator will delete the corresponding stub functions from `stubs.go`. Your files define the real method bodies; `stubs.go` retains only handlers not yet implemented (by Wave 3 agents).

**Implementation details:**

**diff_handler.go** (`handleImplDiff`):
- Path: `GET /api/impl/{slug}/diff/{agent}?wave=N&file=path/to/file`
- Read `wave` from query param (default 1); read `file` from query param (URL-decode it)
- Construct branch name: `wave{N}-agent-{letter}` where letter is `r.PathValue("agent")`
- Run: `git diff main...{branch} -- {file}` in `s.cfg.RepoPath`
- If branch not found, try merged diff: `git diff HEAD~1...HEAD -- {file}` (post-merge case)
- Return `FileDiffResponse{Agent, File, Branch, Diff}` as JSON

**worktree_handler.go** (`handleListWorktrees`, `handleDeleteWorktree`):
- `handleListWorktrees`: run `git worktree list --porcelain` in `s.cfg.RepoPath`; parse output to extract branch + path; cross-reference with `git branch --merged` to set status; return `WorktreeListResponse`
- Filter to only SAW-created branches: branch name matches `wave\d+-agent-[a-z]`
- `handleDeleteWorktree`: URL param `{branch}` is branch name; run `git worktree remove --force {path}` then `git branch -d {branch}`; return 204 on success, 409 if unmerged

**context_handler.go** (`handleGetContext`, `handlePutContext`):
- Context file path: `filepath.Join(s.cfg.RepoPath, "docs", "CONTEXT.md")`
- `handleGetContext`: read file, return as `text/plain`; return 404 if not exists
- `handlePutContext`: accept raw body, atomic write (temp file + rename), return 200

**config_handler.go** (`handleGetConfig`, `handleSaveConfig`):
- Config file path: `filepath.Join(s.cfg.RepoPath, "saw.config.json")`
- `handleGetConfig`: read + parse JSON into `SAWConfig`; return defaults if file not found
- `handleSaveConfig`: decode JSON body as `SAWConfig`, marshal back, atomic write; return 200

**agent_context_handler.go** (`handleGetAgentContext`):
- Path: `GET /api/impl/{slug}/agent/{letter}/context`
- Parse IMPL doc; find the agent's wave + owned files from file ownership table
- Extract: suitability section, interface contracts relevant to this agent's files, this agent's prompt from waves array, file ownership rows for this agent only
- Return as `AgentContextResponse{ContextText: trimmedMarkdown}`

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web
go build ./...
go vet ./...
go test ./pkg/api/... -timeout 2m
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [pkg/api/diff_handler.go, pkg/api/worktree_handler.go, pkg/api/context_handler.go, pkg/api/config_handler.go, pkg/api/agent_context_handler.go]
interface_deviations: none | describe any
notes: ...
```

---

### Agent D — New Review Panel Components

**Role:** Create four new pure React panel components that Wave 2 will wire into ReviewScreen. These components are self-contained; they receive all data via props and do not call APIs directly.

**Files owned (all new files):**
- `web/src/components/review/QualityGatesPanel.tsx`
- `web/src/components/review/NotSuitableResearchPanel.tsx`
- `web/src/components/review/FileDiffPanel.tsx`
- `web/src/components/review/ContextViewerPanel.tsx`

**Implementation details:**

**QualityGatesPanel.tsx:**
- Props: `{ gatesText: string }` — raw text of the Quality Gates section from IMPL doc
- Parse lines starting with `- ` or `* ` as gates; detect `[required]`/`[optional]` tags
- Render a table: Command | Required/Optional | Description
- Handle empty/missing `gatesText` with a neutral empty state: "No quality gates defined"
- Export: `export default function QualityGatesPanel({ gatesText }: { gatesText?: string }): JSX.Element`

**NotSuitableResearchPanel.tsx:**
- Props: `{ impl: IMPLDocResponse }` (import from `../../types`)
- Render: prominent "NOT SUITABLE" verdict badge at top; full suitability rationale text block; "What Would Make It Suitable" callout card (parse rationale for blockers); "Serial Implementation Notes" panel showing dependency graph and interface contracts text; "Archive" button (calls `onArchive` prop)
- Props interface: `{ impl: IMPLDocResponse; onArchive: () => void }`
- Export: `export default function NotSuitableResearchPanel(...)`

**FileDiffPanel.tsx:**
- Props: `{ slug: string; agent: string; wave: number; file: string; onBack: () => void }`
- On mount: call `fetchFileDiff(slug, agent, wave, file)` from `../../api`
- Loading state: spinner. Error state: error message.
- Render the diff as syntax-highlighted lines: lines starting with `+` get green background, lines with `-` get red background, `@@` lines get blue/gray, unchanged lines get default.
- "← Back" button calls `onBack`
- Export: `export default function FileDiffPanel(...)`

**ContextViewerPanel.tsx:**
- Props: `{ onClose: () => void }`
- On mount: call `getContext()` from `../../api`
- Render raw markdown in a `<pre>` block in read mode
- "Edit" button toggles to a `<textarea>` edit mode; "Save" calls `putContext(content)` then returns to read mode
- Export: `export default function ContextViewerPanel({ onClose }: { onClose: () => void }): JSX.Element`

**Style guidance:** Follow existing panel patterns — look at `PostMergeChecklistPanel.tsx` and `KnownIssuesPanel.tsx` for card border, header, and dark mode class conventions.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/review/QualityGatesPanel.tsx, web/src/components/review/NotSuitableResearchPanel.tsx, web/src/components/review/FileDiffPanel.tsx, web/src/components/review/ContextViewerPanel.tsx]
interface_deviations: none | describe any
notes: ...
```

---

## Wave 2

Wave 2 integrates Wave 1's deliverables. All four agents depend on Agent B's types/api additions. Agents E, F, G, H are independent of each other — they touch disjoint files.

**Prerequisite:** Wave 1 must fully complete before Wave 2 launches. Orchestrator must delete stub implementations from `stubs.go` that were replaced by Agent C's handler files before launching Wave 2 (to avoid duplicate method errors).

### Agent E — WaveBoard Failure Type Actions (v0.18.0-D)

**Role:** Complete the failure-type action buttons in WaveBoard. The backend already sends `failure_type` in `agent_failed` SSE events and AgentCard already shows the label. This agent adds type-specific action buttons.

**Files owned:**
- `web/src/components/WaveBoard.tsx`

**Context:** Read `WaveBoard.tsx` in full before writing. Note the existing "Re-run" button for all failed agents. Also read `AgentCard.tsx` to understand the existing failure_type display. Read `web/src/api.ts` to confirm `rerunAgent` signature.

**Tasks:**

1. Remove the local stub `WaveMergeState` and `WaveTestState` interfaces near the top of the file (lines 12–23). Replace with `import { WaveMergeState, WaveTestState } from '../hooks/useWaveEvents'`.

2. Replace the generic "Re-run" button block with failure-type-specific buttons. The `agent.failure_type` values and their actions:

| failure_type | Button label | Action |
|---|---|---|
| `transient` or undefined | "Retry" | call `rerunAgent(slug, agent.wave, agent.agent)` |
| `fixable` | "Fix + Retry" | call `rerunAgent(slug, agent.wave, agent.agent)` (same endpoint; label communicates intent) |
| `needs_replan` | "Re-Scout" | call `onRescout()` if prop exists, else open scout launcher via navigate |
| `timeout` | "Retry (scope down)" | call `rerunAgent(slug, agent.wave, agent.agent)` |
| `escalate` | Show orange badge "Needs Manual Review" — no button | — |

3. For `needs_replan`: since WaveBoard does not have a navigation prop today, add an optional `onRescout?: () => void` prop to `WaveBoardProps`. App.tsx (owned by Agent H) will wire this. If `onRescout` is undefined, fall back to "Retry".

4. Optimistic update: the existing `setStatusOverrides` pattern must be preserved — apply it for all retry-style actions.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/WaveBoard.tsx]
interface_deviations: none | describe any — especially if WaveBoardProps changed
notes: ...
downstream_action_required: true | false
```

---

### Agent F — ReviewScreen Integration

**Role:** Wire the four new panel components into ReviewScreen. Update the PanelKey union and panels array. Handle NOT SUITABLE verdict by replacing Approve/Reject/RequestChanges with Archive button. Add file-click-to-diff flow in FileOwnershipPanel. Add quality gates panel. Add CONTEXT.md viewer toggle.

**Files owned:**
- `web/src/components/ReviewScreen.tsx`

**Context:** Read `ReviewScreen.tsx` in full. The existing `PanelKey` union and `panels` array control the toggle buttons. The `isNotSuitable` flag already exists. Read `FileOwnershipPanel.tsx` to understand its current interface.

**Tasks:**

1. Add to imports: `QualityGatesPanel`, `NotSuitableResearchPanel`, `FileDiffPanel`, `ContextViewerPanel` from `./review/`.

2. Extend `PanelKey` union with: `'quality-gates' | 'context-viewer'`

3. Add to `panels` array: `{ key: 'quality-gates', label: 'Quality Gates' }`, `{ key: 'context-viewer', label: 'Project Memory' }`

4. Add state: `const [diffTarget, setDiffTarget] = useState<{ agent: string; wave: number; file: string } | null>(null)`

5. When `isNotSuitable`:
   - Instead of dimming all panels, render `<NotSuitableResearchPanel impl={impl} onArchive={onReject} />` as the primary content
   - Hide the panel toggle buttons and `<ActionButtons>`
   - The `onArchive` prop calls `onReject` (which already exists in props)

6. Add `QualityGatesPanel` render when `activePanels.includes('quality-gates')`:
   - Pass `gatesText={(impl as any).quality_gates_text ?? ''}` — note: `quality_gates_text` will be added to `IMPLDocResponse` in a future backend task; for now pass empty string as fallback

7. Add `ContextViewerPanel` render when `activePanels.includes('context-viewer')`:
   - Render as an overlay/modal (fixed position) with `onClose={() => togglePanel('context-viewer')}`

8. If `diffTarget` is non-null, render `<FileDiffPanel slug={slug} agent={diffTarget.agent} wave={diffTarget.wave} file={diffTarget.file} onBack={() => setDiffTarget(null)} />` instead of the normal review content.

9. Pass `onFileClick={(agent, wave, file) => setDiffTarget({ agent, wave, file })}` to `<FileOwnershipPanel>`. Update `FileOwnershipPanel`'s props interface to accept optional `onFileClick?: (agent: string, wave: number, file: string) => void`. Make file rows clickable when this prop is present.

**Note on FileOwnershipPanel.tsx:** This file is NOT in your ownership. You may add the `onFileClick` prop call in ReviewScreen, but you must NOT edit `FileOwnershipPanel.tsx`. Instead, pass the prop and accept that it will be a no-op until the prop is wired — OR add a `// TODO: wire onFileClick` comment. If you need to make file rows clickable, the cleanest approach is to wrap the file display in ReviewScreen itself via a new small component defined inline.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/ReviewScreen.tsx]
interface_deviations: none | describe any
notes: ...
```

---

### Agent G — Scout Context Panel (v0.18.0-A)

**Role:** Add an expandable "Add context" section to ScoutLauncher with file attachments, free-text notes, and constraint checkboxes. Context persists in browser session state and is sent with the scout run.

**Files owned:**
- `web/src/components/ScoutLauncher.tsx`

**Context:** Read `ScoutLauncher.tsx` in full. The component is self-contained. Read `web/src/api.ts` to confirm the updated `runScout(feature, repo?, context?)` signature from Agent B.

**Tasks:**

1. Add state: `const [showContext, setShowContext] = useState(false)` and `const [contextData, setContextData] = useState<ScoutContext>({ files: [], notes: '', constraints: [] })` (import `ScoutContext` from `../types`).

2. Below the repo path toggle section, add a similar collapsible section "Add context (optional)":
   - **File paths textarea**: multiline input, placeholder "Paste file paths, one per line". On blur, split by newlines and set `contextData.files`.
   - **Notes textarea**: free text, placeholder "Additional notes or constraints for the Scout agent".
   - **Constraint checkboxes**: predefined options:
     - "Minimize API surface changes"
     - "Prefer additive changes (no deletions)"
     - "Keep existing tests passing"
     - "Single-wave only (no multi-wave)"

3. Pass `contextData` to `runScout(feature.trim(), repo.trim() || undefined, contextData)` in `handleRun`.

4. Session persistence: use `sessionStorage` to save/restore `contextData` on change. Key: `saw-scout-context`.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/ScoutLauncher.tsx]
interface_deviations: none | describe any
notes: ...
```

---

### Agent H — Settings Screen + App Routing

**Role:** Create the Settings screen and wire it into App.tsx. Add gear icon to header. Settings has four sections: Repo, Agent model selection, Quality gates config, Appearance.

**Files owned:**
- `web/src/components/SettingsScreen.tsx` (new)
- `web/src/App.tsx`

**Context:** Read `App.tsx` in full. The app uses a column layout with `liveView` state controlling the right rail. Settings is a center-column view — no right rail. Read `web/src/api.ts` to confirm `getConfig`/`saveConfig` functions from Agent B.

**Tasks:**

**SettingsScreen.tsx:**
```typescript
interface SettingsScreenProps {
  onClose: () => void
}
export default function SettingsScreen({ onClose }: SettingsScreenProps): JSX.Element
```
- On mount: call `getConfig()` from `../api`, populate form fields
- Sections:
  - **Repo**: text input for repo path
  - **Agent**: two selects for scout model and wave model (options: `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-3-5`)
  - **Quality Gates**: three checkboxes matching `QualityConfig` fields
  - **Appearance**: theme picker (system/light/dark)
- "Save" button: call `saveConfig(config)`, show success toast-style banner, call `onClose`
- "Cancel" button: call `onClose` without saving
- Style: same card/border pattern as other screens

**App.tsx changes:**
1. Import `SettingsScreen` and `Settings` icon from lucide-react.
2. Add state: `const [showSettings, setShowSettings] = useState(false)`
3. In the header, add a gear button after `ThemePicker`:
   ```tsx
   <button onClick={() => setShowSettings(true)} title="Settings">
     <Settings size={16} />
   </button>
   ```
4. In the center column, add: if `showSettings`, render `<SettingsScreen onClose={() => setShowSettings(false)} />` instead of the normal content.
5. Pass `onRescout={() => { setShowSettings(false); setLiveView('scout') }}` to WaveBoard... actually WaveBoard is used inside LiveRail. Instead: expose `onRescout` via the LiveRail's `liveView` state by adding a new `liveView` value `'rescout'` that triggers the scout launcher. Simplest: just navigate to scout view: `setLiveView('scout')`.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/SettingsScreen.tsx, web/src/App.tsx]
interface_deviations: none | describe any
notes: ...
```

---

## Wave 3

Wave 3 delivers the intelligence layer. Both agents depend on Wave 1+2 being merged. Agent I requires that Agent F has integrated the chat trigger point into ReviewScreen. Agent J requires Agent C's `agent_context_handler.go` body.

### Agent I — Chat with Claude (v0.18.0-B)

**Role:** Implement the "Ask Claude" chat panel in ReviewScreen and the backend handler that streams Claude responses about the IMPL doc.

**Files owned:**
- `web/src/components/ChatPanel.tsx` (new)
- `web/src/hooks/useChatWithClaude.ts` (new)
- `pkg/api/chat_handler.go` (new — replaces stub from Agent A)

**Context:** Read `pkg/api/impl_edit.go` for the pattern of how Claude agents are run server-side (`runImplReviseAgent` uses `engine.RunScout` with a custom system prompt — the same approach applies here). Read `web/src/components/RevisePanel.tsx` for the SSE-driven streaming panel pattern to follow on the frontend.

**Backend — chat_handler.go:**

```go
// handleImplChat handles POST /api/impl/{slug}/chat.
// Accepts {"message":"...", "history":[...]}, launches Claude with IMPL doc context,
// streams response via SSE. Read-only — does NOT modify the IMPL doc.
func (s *Server) handleImplChat(w http.ResponseWriter, r *http.Request) { ... }

// handleImplChatEvents handles GET /api/impl/{slug}/chat/{runID}/events.
// Streams chat_output, chat_complete, chat_failed events.
func (s *Server) handleImplChatEvents(w http.ResponseWriter, r *http.Request) { ... }
```

System prompt for the chat agent:
```
You are an expert software architect answering questions about a Scout-and-Wave IMPL doc.
The IMPL doc is at: {implPath}
Read the IMPL doc using the Read tool, then answer the user's question concisely.
The conversation history is provided for context.
You MUST NOT modify the IMPL doc or any source files. Read-only.
Previous conversation:
{formattedHistory}
User question: {message}
```

SSE events to publish: `chat_output` (chunk), `chat_complete` (final answer), `chat_failed` (error).

**Frontend — useChatWithClaude.ts:**
```typescript
export interface ChatState {
  messages: ChatMessage[]
  running: boolean
  error?: string
}

export function useChatWithClaude(slug: string): {
  state: ChatState
  sendMessage: (text: string) => Promise<void>
  clearHistory: () => void
}
```
- `sendMessage`: calls `startImplChat(slug, text, state.messages)`, subscribes to SSE stream, appends streamed chunks to the last assistant message, finalizes on `chat_complete`.

**Frontend — ChatPanel.tsx:**
```typescript
interface ChatPanelProps {
  slug: string
  onClose: () => void
}
export default function ChatPanel({ slug, onClose }: ChatPanelProps): JSX.Element
```
- Uses `useChatWithClaude(slug)` hook
- Message list with user messages right-aligned, assistant messages left-aligned
- Text input + Send button at bottom
- "× Close" button at top right
- "Apply this suggestion" button appears on the last assistant message; calls `onClose` and (in a future release) can seed the RevisePanel — for now it just copies the message to clipboard with a "Copied!" toast

**Wiring into ReviewScreen:** Agent F already merged; ChatPanel is rendered as an overlay/slide-in when user clicks "Ask Claude" button. Add `onAskClaude` prop handling: `const [showChat, setShowChat] = useState(false)` and conditionally render `<ChatPanel slug={slug} onClose={() => setShowChat(false)} />`.

**Note:** Since ReviewScreen.tsx was already merged by Agent F, this agent must carefully add only the `showChat` state, `Ask Claude` button in the actions row, and the ChatPanel conditional render. Read the merged ReviewScreen.tsx before writing.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web
go build ./...
go vet ./...
cd web && npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [web/src/components/ChatPanel.tsx, web/src/hooks/useChatWithClaude.ts, pkg/api/chat_handler.go, web/src/components/ReviewScreen.tsx]
interface_deviations: none | describe any
notes: ...
```

---

### Agent J — Per-Agent Context Payload (v0.18.0-K)

**Role:** Implement the per-agent context endpoint backend logic (replaces stub) and add the "Agent Context" toggle on agent cards in ReviewScreen's AgentPromptsPanel.

**Files owned:**
- `pkg/api/agent_context_handler.go` — implement `handleGetAgentContext` (replaces the stub body; note Agent C wrote the real body in Wave 1 — read what Agent C wrote and enhance it if needed, or verify it is complete)
- `web/src/components/review/AgentContextToggle.tsx` (new)

**Context:** Read `pkg/api/agent_context_handler.go` as written by Agent C. If it is complete (returns trimmed IMPL doc context per agent), your job is frontend only. If the stub was not replaced (Agent C marked it out of scope), implement the full handler here.

**Frontend — AgentContextToggle.tsx:**
```typescript
interface AgentContextToggleProps {
  slug: string
  agent: string   // letter, e.g. "A"
  wave: number
}
export default function AgentContextToggle({ slug, agent, wave }: AgentContextToggleProps): JSX.Element
```
- "View Agent Context" button (small, outlined)
- On click: call `fetchAgentContext(slug, agent)` from `../../api`
- Loading state: spinner
- Result: render `context_text` in a collapsible `<pre>` block with syntax highlighting
- "Copy" button copies `context_text` to clipboard

**Wiring:** Add `<AgentContextToggle slug={slug} agent={entry.agent} wave={entry.wave} />` to `AgentPromptsPanel.tsx` below each agent prompt. AgentPromptsPanel is NOT in your file ownership — instead, add the toggle in a way that doesn't require modifying AgentPromptsPanel: wrap it in ReviewScreen when rendering the agent-prompts panel. Alternative: add a new `AgentContextPanel.tsx` under `review/` that replaces the import in ReviewScreen (which Agent F already merged). Read ReviewScreen.tsx before deciding.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web
go build ./...
go vet ./...
cd web && npm run build 2>&1 | head -80
```

**Completion report template:**
```
status: complete | partial | blocked
files_changed: [pkg/api/agent_context_handler.go, web/src/components/review/AgentContextToggle.tsx]
interface_deviations: none | describe any
notes: ...
```

---

## Wave Execution Loop

### Orchestrator Post-Merge Checklist

After wave 1 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`; if any `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — cross-reference `files_changed` lists; flag any file appearing in >1 agent's list before touching the working tree
- [ ] Review `interface_deviations` — update downstream agent prompts for any item with `downstream_action_required: true`
- [ ] Merge each agent: `git merge --no-ff <branch> -m "Merge wave1-agent-{X}: <desc>"`
- [ ] **Post-Wave 1 special step:** After merging Agent A and Agent C, delete from `pkg/api/stubs.go` the stub functions that Agent C replaced: `handleImplDiff`, `handleListWorktrees`, `handleDeleteWorktree`, `handleGetContext`, `handlePutContext`, `handleGetConfig`, `handleSaveConfig`, `handleGetAgentContext`. Leave `handleImplChat`, `handleImplChatEvents`, `handleScaffoldRerun` — those are still stubs for Wave 3.
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for each
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: n/a (no auto-fix configured)
      - [ ] `go build ./... && go vet ./... && go test ./... && cd web && npm run build` ← full build
- [ ] Fix any cascade failures
- [ ] Tick status checkboxes in this IMPL doc for completed agents
- [ ] Update interface contracts for any deviations logged by agents
- [ ] Commit: `git commit -m "feat: gui-phase1-phase2 wave 1 — routes, types, handlers, panels"`
- [ ] Launch Wave 2

After wave 2 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`
- [ ] Conflict prediction — WaveBoard (E) and App.tsx (H) are separate; ReviewScreen (F) and ScoutLauncher (G) are separate
- [ ] Merge each agent
- [ ] Post-merge verification:
      - [ ] `go build ./... && go vet ./... && go test ./... && cd web && npm run build`
- [ ] Fix cascade failures
- [ ] Commit: `git commit -m "feat: gui-phase1-phase2 wave 2 — WaveBoard, ReviewScreen, Scout context, Settings"`
- [ ] Launch Wave 3

After wave 3 completes:

- [ ] Read all agent completion reports — confirm all `status: complete`
- [ ] Special step: delete remaining stubs from `pkg/api/stubs.go` (handleImplChat, handleImplChatEvents, handleScaffoldRerun) once Agent I has provided real implementations. If Agent I did NOT implement handleScaffoldRerun (v0.18.0-I), leave the stub and file a follow-up.
- [ ] Merge each agent
- [ ] Post-merge verification:
      - [ ] `go build ./... && go vet ./... && go test ./... && cd web && npm run build`
- [ ] Integration smoke test: `./saw serve &` then curl key endpoints
- [ ] Commit: `git commit -m "feat: gui-phase1-phase2 wave 3 — chat, agent context"`
- [ ] Feature-specific steps:
      - [ ] Verify `GET /api/impl/{slug}/diff/{agent}?wave=1&file=pkg/api/server.go` returns valid diff JSON
      - [ ] Verify `GET /api/impl/{slug}/worktrees` returns JSON array
      - [ ] Verify `GET /api/config` returns default SAWConfig when no config file exists
      - [ ] Verify `GET /api/context` returns 404 when no CONTEXT.md exists (not 500)
      - [ ] Verify Settings screen renders in browser
      - [ ] Verify Chat panel streams response for a test question
- [ ] Tag: `git tag v0.18.0`

---

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | Backend wiring — routes + types | TO-DO |
| 1 | B | Frontend types + API client | TO-DO |
| 1 | C | Backend handlers (diff, worktrees, context, config, agent-context) | TO-DO |
| 1 | D | New review panel components (QualityGates, NotSuitable, FileDiff, ContextViewer) | TO-DO |
| 2 | E | WaveBoard failure type action buttons | TO-DO |
| 2 | F | ReviewScreen integration (new panels, NOT SUITABLE flow, diff trigger) | TO-DO |
| 2 | G | Scout context panel | TO-DO |
| 2 | H | Settings screen + App routing | TO-DO |
| 3 | I | Chat with Claude (backend + frontend) | TO-DO |
| 3 | J | Per-agent context payload (backend + AgentContextToggle) | TO-DO |
| — | Orch | Post-merge integration, smoke tests, tag v0.18.0 | TO-DO |

---

### Agent A - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: 4e327d993e9ed4850aefc166bd5dae71c3d6066f
files_changed:
  - pkg/api/server.go
  - pkg/api/types.go
files_created:
  - pkg/api/stubs.go
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build ./... && go vet ./...)
```

---

### Agent B - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: f807cad31d4af7b7fe19f8ad886efff66b86d863
files_changed:
  - web/src/types.ts
  - web/src/api.ts
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build in main repo)
```

The existing `api.ts` uses bare `/api/...` paths (no `BASE_URL` constant) — new functions follow the same convention rather than the `BASE_URL` pattern shown in the agent prompt. The `runScout` third parameter `context?: ScoutContext` is optional so existing two-argument callers are unaffected. All type errors surfaced by `tsc --noEmit` in the worktree were pre-existing infrastructure errors (missing `node_modules`) unrelated to `types.ts` or `api.ts`; the full build in the main repo passes cleanly.

### Agent D - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-D
branch: wave1-agent-D
commit: e461756
files_changed: []
files_created:
  - web/src/components/review/QualityGatesPanel.tsx
  - web/src/components/review/NotSuitableResearchPanel.tsx
  - web/src/components/review/FileDiffPanel.tsx
  - web/src/components/review/ContextViewerPanel.tsx
interface_deviations: []
out_of_scope_deps:
  - fetchFileDiff, getContext, putContext not yet in api.ts (owned by Agent B) — TEMP inline stubs added to FileDiffPanel.tsx and ContextViewerPanel.tsx; remove after Wave 1 merge
tests_added: []
verification: PASS (npm run build — tsc + vite, 1.73s, 0 type errors)
```

All four panels follow the card/border/dark-mode class conventions from PostMergeChecklistPanel and KnownIssuesPanel. Key decisions:

- QualityGatesPanel: parses `- ` / `* ` lines from gatesText, detects `[required]`/`[optional]` tags (defaults required when neither present), renders a styled table with badge column.
- NotSuitableResearchPanel: prominent red NOT SUITABLE banner, rationale via MarkdownContent, blockers parsed from bullet lines in rationale text, serial notes section for dependency_graph_text and interface_contracts_text.
- FileDiffPanel: useEffect fetch on mount, spinner/error states, per-line coloring (green/red/blue-gray/default), Back button. TEMP stub for fetchFileDiff uses a reasonable `/api/impl/:slug/wave/:wave/agent/:agent/diff?file=:file` URL — Agent B should confirm the actual route shape.
- ContextViewerPanel: two-mode read/edit with TEMP stubs for getContext/putContext using `/api/context` — Agent B should confirm endpoint path. Save shows inline spinner and surfaced error.

The worktree needed `npm install` before building (node_modules absent, as expected for a fresh worktree). Build passes cleanly with no new type errors or warnings attributable to these files.

All 11 new route registrations added to `server.go` immediately after `DELETE /api/impl/{slug}`. `stubs.go` created with 501 stub bodies for all new handler methods. New types appended to `types.go` without touching existing types. Build and vet pass clean with zero warnings.

### Agent C - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-C
branch: wave1-agent-C
commit: 2de3055297d096b821ab36504a5db53ec0897e1f
files_changed: []
files_created:
  - pkg/api/diff_handler.go
  - pkg/api/worktree_handler.go
  - pkg/api/context_handler.go
  - pkg/api/config_handler.go
  - pkg/api/agent_context_handler.go
  - pkg/api/types_temp.go
  - pkg/api/stubs_temp.go
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build ./... && go vet ./...)
```

All five handler files implemented against interface contracts. `types_temp.go` adds the new Go types (WorktreeEntry, FileDiffResponse, SAWConfig, AgentContextResponse, ChatRequest/ChatMessage/ChatRunResponse) that Agent A owns in `types.go` — needed for isolated build. `stubs_temp.go` adds 501 stubs for handleImplChat, handleImplChatEvents, handleScaffoldRerun (Agent A-owned). Both temp files must be deleted after Wave 1 merge once Agent A's types.go and stubs.go land.

Key decisions:
- `handleImplDiff`: uses `git diff main...{branch} -- {file}` with post-merge fallback to `HEAD~1...HEAD`; returns empty diff string (not error) when branch is not found post-merge
- `handleListWorktrees`: parses porcelain output, filters on `wave\d+-agent-[a-z]+` regex, derives status from `git branch --merged main`
- `handleDeleteWorktree`: returns 409 JSON with error message if branch is unmerged and force=true not set; uses soft `-d` then hard `-D` delete
- `handleGetAgentContext`: uses engine.ParseIMPLDoc for structured data; falls back to raw markdown section extraction if parser returns no prompt for the agent
- All file writes use atomic temp-file + os.Rename pattern consistent with impl_edit.go

### Agent E - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-E
branch: wave2-agent-E
commit: 1f57cbbd002500838ae038fa66791a9c8b791092
files_changed:
  - web/src/components/WaveBoard.tsx
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

Removed local `WaveMergeState`/`WaveTestState` stub interfaces and replaced with imports from `../hooks/useWaveEvents`. Added optional `onRescout?: () => void` prop to `WaveBoardProps`. Replaced the generic Re-run button with a `renderFailureActionButton` helper that renders failure-type-specific actions per the spec table: `transient`/undefined shows "Retry", `fixable` shows "Fix + Retry", `needs_replan` shows "Re-Scout" (calls `onRescout` prop if provided, falls back to `rerunAgent`), `timeout` shows "Retry (scope down)", and `escalate` renders an orange "Needs Manual Review" badge with no button. All retry-style paths preserve the `setStatusOverrides` optimistic update pattern. Switched from inline `fetch` to `rerunAgent()` from `api.ts`.

### Agent G - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-G
branch: wave2-agent-G
commit: a8b2e821798d486f5ece7511787caf3bd2797443
files_changed:
  - web/src/components/ScoutLauncher.tsx
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

### Agent H - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-H
branch: wave2-agent-H
commit: f62b0e5a7e4c727792ba3a1f1154b3483a314580
files_created:
  - web/src/components/SettingsScreen.tsx
files_changed:
  - web/src/App.tsx
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

SettingsScreen renders four card sections (Repo, Agent, Quality Gates, Appearance) populated from `getConfig()` on mount. Save calls `saveConfig()`, shows a brief "Saved!" message, then calls `onClose`. The Appearance section uses a simple `<select>` for system/light/dark rather than wiring into the existing ThemePicker (which manages color themes independently via localStorage — these are orthogonal concerns). App.tsx renders the SettingsScreen in place of the center-column content when `showSettings` is true, which fits the existing layout without requiring a modal overlay. The Settings gear button is placed after DarkModeToggle in the header.

Added collapsible "Add context (optional)" panel below the repo path toggle, using the same toggle button pattern. Panel contains: a file-paths textarea (split on newline, updated on blur), a notes textarea (controlled, updates on change), and four predefined constraint checkboxes. `contextData` is passed as the third argument to `runScout` in `handleRun`. Session persistence uses `sessionStorage` — state is initialized lazily from storage on mount and written back via a `useEffect` on every `contextData` change. The files textarea uses `defaultValue` + `onBlur` to avoid re-rendering on every keystroke while the panel is open.

### Agent F - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-F
branch: wave2-agent-F
commit: ff57696b3e4b3df3c3d29c62640601e4c78bcfd3
files_changed:
  - web/src/components/ReviewScreen.tsx
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

Added imports for all four new Wave 1 panels. Extended `PanelKey` union with `'quality-gates' | 'context-viewer'` and added both to the `panels` array. Added `diffTarget` state for file diff navigation.

When `isNotSuitable` is true, renders `<NotSuitableResearchPanel>` as primary content and hides panel toggles and `<ActionButtons>` entirely (replaced the original `opacity-40 pointer-events-none` wrapper with a conditional branch).

`FileDiffPanel` renders as a full-screen early-return when `diffTarget` is non-null, with `onBack` clearing the state.

`QualityGatesPanel` renders inline in the panels grid when `'quality-gates'` is active.

`ContextViewerPanel` renders as a fixed-position modal overlay (z-50) outside the scrolling content div, with `onClose` toggling the panel off.

For `FileOwnershipPanel.onFileClick`: since `FileOwnershipPanel.tsx` is not in my ownership and its props interface does not yet declare `onFileClick`, used an IIFE with a local `AnyFileOwnershipPanel` cast to pass the prop without editing the panel file. A TODO comment marks this for cleanup after Wave 1 merge.

### Agent J - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave3-agent-J
branch: wave3-agent-J
commit: a079fea
files_created:
  - web/src/components/review/AgentContextToggle.tsx
  - web/src/components/review/AgentContextPanel.tsx
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build + npm run build)
downstream_action_required: true
```

AgentContextPanel.tsx wraps AgentPromptsPanel + AgentContextToggle per-agent. ReviewScreen.tsx needs to import AgentContextPanel instead of AgentPromptsPanel for the agent-prompts panel key to show per-agent context toggles. Downstream: orchestrator should update ReviewScreen.tsx after merge.

### Agent I - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave3-agent-I
branch: wave3-agent-I
commit: 39a3d12
files_created:
  - pkg/api/chat_handler.go
  - web/src/hooks/useChatWithClaude.ts
  - web/src/components/ChatPanel.tsx
files_changed:
  - web/src/components/ReviewScreen.tsx
  - pkg/api/stubs.go
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (go build + npm run build)
```

Previous agent run had already written `chat_handler.go`, `useChatWithClaude.ts`, and modified `stubs.go`. Only `ChatPanel.tsx` and the ReviewScreen wiring were missing. Created `ChatPanel.tsx` with the full spec: user messages right-aligned (blue), assistant left-aligned (gray), auto-scroll via `useRef`, disabled input while running, Copy/Copied! feedback on last assistant message, and `state.error` display. Wired into ReviewScreen.tsx by adding the import, `showChat` state, an "Ask Claude" button next to ActionButtons, and the fixed-overlay `{showChat && <ChatPanel ... />}` render. Both `go build ./...` and `npm run build` pass cleanly.
