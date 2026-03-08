# IMPL: Multi-Repo GUI Registry + UX

## Suitability Assessment

Verdict: SUITABLE
test_command: `go test ./...`
lint_command: `go vet ./...`

This feature decomposes cleanly into 5 distinct work areas with disjoint file ownership across two
waves. Wave 1 lands the config schema change (Go backend + TypeScript types + API helper) as a
foundation; Wave 2 delivers the five UI pieces that consume the new registry. All cross-agent
interfaces are fully specifiable before implementation begins. The config schema change is the
only hard blocker — every frontend piece depends on `SAWConfig.repos` existing — so a 2-wave
structure is correct. No investigation-first items exist; all behaviors are additive. No items
are already implemented; `SAWConfig` currently has `repo: { path: string }` only.

Estimated times:
- Scout phase: ~15 min (dependency mapping, interface contracts, IMPL doc)
- Agent execution: ~45 min (5 parallel Wave 2 agents × ~9 min avg, Wave 1 ~12 min, accounts for parallelism)
- Merge & verification: ~8 min
Total SAW time: ~75 min

Sequential baseline: ~6 agents × 12 min = ~72 min + overhead
Time savings: Meaningful for Wave 2 where 5 agents run in parallel (~35 min saved vs. sequential).

Recommendation: Clear speedup in Wave 2. Proceed.

---

## Scaffolds

No scaffolds needed — the shared type `RepoEntry` crosses agent boundaries but is simple enough
to be declared in `web/src/types.ts` by Agent A (Wave 1). All Wave 2 agents import from that file.
Agent A's output is the scaffold gate for Wave 2.

No scaffolds needed - agents have independent type ownership.

---

## Pre-Mortem

**Overall risk:** medium

**Failure modes:**

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| Wave 2 agents all consume `SAWConfig.repos` but Agent A (Wave 1) deviates from the interface contract (e.g., field name change) | low | high | Interface contracts below are binding; Agent A must match exactly. Orchestrator validates the TypeScript export before launching Wave 2. |
| Backward-compat migration in Go reads old `repo.path` but silently drops it in marshal round-trip | medium | medium | Agent B (Wave 1) must keep both `Repo` and `Repos` fields in `SAWConfig` during the migration read; write only `repos` on save. Verify with a JSON round-trip unit test. |
| `listImpls` backend currently uses `s.cfg.IMPLDir` (single dir). Multi-repo IMPL list scope requires per-repo dir scanning; this scope is OUT of this IMPL. | low | low | The repo switcher in Wave 2 Agent C scopes the IMPL list client-side using a filter on the slug prefix or an API param — NOT by changing `handleListImpls`. The backend list endpoint remains single-dir for now. Document this limitation in the UI. |
| Agent E (FileOwnershipPanel) and Agent F (WaveBoard tag) both need to detect "repo root" from a file path string. They must agree on the detection algorithm. | medium | medium | Interface contracts define `detectRepoRoot(filePath: string, repos: RepoEntry[]): string` so both agents use identical logic. |
| ScoutLauncher already has a freeform "repo path" text input (`showRepo` / `setRepo`). Agent D must replace this with a dropdown of registered repos without breaking the freeform fallback. | low | medium | Agent D prompt explicitly addresses backward compatibility: keep the freeform input as a fallback when registry is empty. |
| `DirPicker` uses a popover positioned with `absolute top-full`. In the Settings repo list, two pickers open simultaneously may overlap. | low | low | Agent C (SettingsScreen) renders one row at a time; only one DirPicker can be open at once. Note this in the prompt. |

---

## Known Issues

None identified.

---

## Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (2 parallel agents — config schema foundation):
    [A] web/src/types.ts
         Add RepoEntry interface; extend SAWConfig to include repos: RepoEntry[].
         Add repoRegistry state + helpers in App.tsx (repo switcher state shell only — no UI).
         ✓ root (no dependencies on other agents)

    [B] pkg/api/types.go
         pkg/api/config_handler.go
         Add ReposConfig / RepoEntry Go types; extend SAWConfig.Repos; backward-compat
         migration in handleGetConfig; update handleSaveConfig to persist repos field.
         ✓ root (no dependencies on other agents)

Wave 2 (5 parallel agents — UI pieces, all depend on Wave 1):
    [C] web/src/components/SettingsScreen.tsx
         Replace single DirPicker with repo list management UI (add/remove/reorder repos).
         depends on: [A]

    [D] web/src/components/ScoutLauncher.tsx
         Replace freeform repo path input with dropdown of registered repos.
         depends on: [A]

    [E] web/src/components/ImplList.tsx
         Add repo switcher (dropdown) at top of sidebar in App.tsx left panel.
         Add multi-repo badge on list entries that span >1 repo root.
         depends on: [A]

    [F] web/src/components/review/FileOwnershipPanel.tsx
         Group file rows under collapsible repo-name headers when files span >1 repo.
         depends on: [A]

    [G] web/src/components/WaveBoard.tsx
         Add small repo tag on each AgentCard derived from dominant repo root in agent's files.
         depends on: [A]
```

Agent A also owns the `web/src/App.tsx` changes needed to thread the repo registry state down to
Wave 2 components. Wave 2 agents must read Agent A's exact prop signatures from the interface
contracts below before implementing.

---

## Interface Contracts

All signatures are binding. Wave 2 agents implement against these without seeing each other's code.

### TypeScript types (Agent A delivers, Wave 2 agents consume)

```typescript
// In web/src/types.ts

/** One registered repository in the SAWConfig repo registry. */
export interface RepoEntry {
  name: string   // human-readable label, e.g. "web", "go"
  path: string   // absolute filesystem path
}

/** Updated SAWConfig — repos replaces the old repo.path singleton. */
export interface SAWConfig {
  repos: RepoEntry[]                             // NEW: named repo registry (replaces repo.path)
  repo: { path: string }                         // KEPT for backward compat read; write-ignored after migration
  agent: { scout_model: string; wave_model: string }
  quality: { require_tests: boolean; require_lint: boolean; block_on_failure: boolean }
  appearance: { theme: 'system' | 'light' | 'dark' }
}
```

### App.tsx state additions (Agent A delivers, consumed by wave 2 via props)

```typescript
// In web/src/App.tsx — new state and derived values added by Agent A

const [repos, setRepos] = useState<RepoEntry[]>([])
const [activeRepoIndex, setActiveRepoIndex] = useState<number>(0)

// Derived: the currently selected repo (or null if registry is empty)
const activeRepo: RepoEntry | null = repos[activeRepoIndex] ?? null

// Callback passed to SettingsScreen so it can update the registry
function handleReposChange(updated: RepoEntry[]): void { ... }

// Callback passed to ImplList / sidebar for switching the active repo
function handleRepoSwitch(index: number): void { ... }
```

### SettingsScreen props (updated by Agent C)

```typescript
interface SettingsScreenProps {
  onClose: () => void
  // New: propagate registry changes up to App so other components react
  onReposChange?: (repos: RepoEntry[]) => void
}
```

### ScoutLauncher props (updated by Agent D)

```typescript
interface ScoutLauncherProps {
  onComplete: (slug: string) => void
  onScoutReady?: () => void
  // New: registered repos for dropdown; freeform fallback when empty
  repos?: RepoEntry[]
}
```

### ImplList props (updated by Agent E)

```typescript
interface ImplListProps {
  entries: IMPLListEntry[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  onDelete: (slug: string) => void
  loading: boolean
  // New: repo registry for multi-repo badge detection
  repos?: RepoEntry[]
}
```

### Repo root detection utility (used by Agents E, F, G — must match exactly)

```typescript
// Utility function — each agent defines this locally (identical copy)
// Finds the RepoEntry whose path is the longest prefix match for filePath.
// Returns the repo name, or '' if no match.
function detectRepoName(filePath: string, repos: RepoEntry[]): string {
  let best = ''
  let bestLen = 0
  for (const r of repos) {
    if (filePath.startsWith(r.path) && r.path.length > bestLen) {
      best = r.name
      bestLen = r.path.length
    }
  }
  return best
}
```

### Go types (Agent B delivers)

```go
// In pkg/api/types.go

// RepoEntry is one named repository in the repo registry.
type RepoEntry struct {
    Name string `json:"name"`
    Path string `json:"path"`
}

// ReposConfig holds the multi-repo registry.
type ReposConfig struct {
    Repos []RepoEntry `json:"repos"`
}

// SAWConfig is the shape of saw.config.json (updated).
// Repo is kept for backward-compat read; Repos is authoritative.
type SAWConfig struct {
    Repos  []RepoEntry  `json:"repos,omitempty"`    // NEW: named repo registry
    Repo   RepoConfig   `json:"repo,omitempty"`      // LEGACY: backward compat only
    Agent  AgentConfig  `json:"agent"`
    Quality QualityConfig `json:"quality"`
    Appear  AppearConfig  `json:"appearance"`
}
```

### Go config migration logic (Agent B delivers)

```go
// In handleGetConfig — after json.Unmarshal:
// If cfg.Repos is empty but cfg.Repo.Path is non-empty, migrate:
if len(cfg.Repos) == 0 && cfg.Repo.Path != "" {
    cfg.Repos = []RepoEntry{{Name: "repo", Path: cfg.Repo.Path}}
}
// Always clear the legacy field before encoding response
cfg.Repo = RepoConfig{}
```

---

## File Ownership

```yaml type=impl-file-ownership
| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| web/src/types.ts | A | 1 | — |
| web/src/App.tsx | A | 1 | — |
| web/src/api.ts | A | 1 | — |
| pkg/api/types.go | B | 1 | — |
| pkg/api/config_handler.go | B | 1 | — |
| web/src/components/SettingsScreen.tsx | C | 2 | A |
| web/src/components/ScoutLauncher.tsx | D | 2 | A |
| web/src/components/ImplList.tsx | E | 2 | A |
| web/src/components/review/FileOwnershipPanel.tsx | F | 2 | A |
| web/src/components/WaveBoard.tsx | G | 2 | A |
```

`web/src/components/FileOwnershipTable.tsx` is a cascade candidate: Agent F's
`FileOwnershipPanel.tsx` wraps it. If Agent F needs to pass `repos` into
`FileOwnershipTable`, that component is also in scope for Agent F (it is not
owned by any other Wave 2 agent). Ownership clarification: Agent F owns both
`FileOwnershipPanel.tsx` AND `FileOwnershipTable.tsx` since the grouping logic
lives in those two files together.

Updated ownership for Agent F:

| File | Agent | Wave |
|------|-------|------|
| web/src/components/review/FileOwnershipPanel.tsx | F | 2 |
| web/src/components/FileOwnershipTable.tsx | F | 2 |

---

## Wave Structure

```yaml type=impl-wave-structure
Wave 1: [A] [B]                  <- 2 parallel agents (schema foundation)
             | (A complete)
Wave 2: [C] [D] [E] [F] [G]     <- 5 parallel agents (UI pieces)
```

---

## Wave 1

Wave 1 delivers the data layer. Agent A extends the TypeScript types and wires repo registry state
into App.tsx. Agent B updates the Go config schema with backward-compat migration. Both are
independent of each other and can run in parallel. Wave 2 cannot start until Agent A is merged
(all frontend agents depend on `SAWConfig.repos` and `RepoEntry`).

### Agent A — TypeScript Types + App State

**Role:** Config schema (TypeScript) + App.tsx repo registry state wiring

**Task:** You are implementing the TypeScript foundation for the multi-repo registry feature. No UI is rendered; this wave only adds types, state, and prop threading.

**Scope:**
- `web/src/types.ts` — add `RepoEntry` interface; update `SAWConfig` to include `repos: RepoEntry[]` while keeping `repo: { path: string }` for backward compat
- `web/src/App.tsx` — add `repos` + `activeRepoIndex` state; derive `activeRepo`; load repos from config on mount; pass `repos` + `onReposChange` down to `SettingsScreen`; pass `repos` down to `ScoutLauncher`, `ImplList`, and `LiveRail` as optional props (they are consumed in Wave 2, so just thread the props through even if the child components don't yet use them)
- `web/src/api.ts` — no new functions needed; `getConfig()` and `saveConfig()` already accept `SAWConfig`; just verify TypeScript compiles with the updated type

**Interface contracts you must match exactly:**

```typescript
// web/src/types.ts
export interface RepoEntry {
  name: string
  path: string
}

export interface SAWConfig {
  repos: RepoEntry[]
  repo: { path: string }   // kept for backward-compat read
  agent: { scout_model: string; wave_model: string }
  quality: { require_tests: boolean; require_lint: boolean; block_on_failure: boolean }
  appearance: { theme: 'system' | 'light' | 'dark' }
}
```

```typescript
// web/src/App.tsx — new state
const [repos, setRepos] = useState<RepoEntry[]>([])
const [activeRepoIndex, setActiveRepoIndex] = useState<number>(0)
const activeRepo: RepoEntry | null = repos[activeRepoIndex] ?? null

function handleReposChange(updated: RepoEntry[]): void {
  setRepos(updated)
}
function handleRepoSwitch(index: number): void {
  setActiveRepoIndex(index)
}
```

On mount (in the existing `useEffect` that calls `listImpls`), also call `getConfig()` and populate `repos` from `config.repos ?? []`. If `config.repos` is empty but `config.repo.path` is non-empty, set `repos` to `[{ name: 'repo', path: config.repo.path }]` as a client-side migration fallback.

**Pass these props down (Wave 2 agents depend on them being threaded through):**
- `SettingsScreen`: add `onReposChange={handleReposChange}` prop
- `ImplList`: add `repos={repos}` prop
- `LiveRail`: add `repos={repos}` prop (LiveRail passes to ScoutLauncher)
- `ScoutLauncher` (via LiveRail): add `repos={repos}` prop

**Files you own:** `web/src/types.ts`, `web/src/App.tsx`, `web/src/api.ts`

**Do not touch:** Any component file in `web/src/components/` except to update prop type signatures where TypeScript forces it (do not add JSX or behavior).

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build   # must produce zero TypeScript errors
```

**Completion report format:**
```
## Wave 1 Agent A Completion Report
status: complete | partial | blocked
files_changed: [web/src/types.ts, web/src/App.tsx, web/src/api.ts]
interface_deviations: none | <describe any deviation from the contracts above>
downstream_action_required: false | true — <what downstream agents must know>
notes: <anything relevant>
```

---

### Agent B — Go Config Schema + Migration

**Role:** Go backend config types + backward-compat migration

**Task:** Extend the Go config schema to support a named repo registry (`repos: [{name, path}]`). Implement backward-compat migration: if a saved config has the old `repo.path` field but no `repos` array, auto-migrate it to `repos[0]` on read. On write, persist only `repos` (not the legacy `repo` field).

**Files you own:** `pkg/api/types.go`, `pkg/api/config_handler.go`

**Do not touch:** Any other Go file. Do not change `server.go`, `impl.go`, or the `Config` struct (the server's startup config — that is separate from `SAWConfig`).

**Exact changes required:**

In `pkg/api/types.go`, replace:
```go
type RepoConfig struct {
    Path string `json:"path"`
}

type SAWConfig struct {
    Repo    RepoConfig    `json:"repo"`
    Agent   AgentConfig   `json:"agent"`
    Quality QualityConfig `json:"quality"`
    Appear  AppearConfig  `json:"appearance"`
}
```

With:
```go
// RepoEntry is one named repository in the repo registry.
type RepoEntry struct {
    Name string `json:"name"`
    Path string `json:"path"`
}

// RepoConfig is kept for backward-compat JSON deserialization of old configs.
type RepoConfig struct {
    Path string `json:"path"`
}

type SAWConfig struct {
    Repos   []RepoEntry   `json:"repos,omitempty"`   // authoritative registry
    Repo    RepoConfig    `json:"repo,omitempty"`     // legacy, read-only for migration
    Agent   AgentConfig   `json:"agent"`
    Quality QualityConfig `json:"quality"`
    Appear  AppearConfig  `json:"appearance"`
}
```

In `pkg/api/config_handler.go`, after `json.Unmarshal(data, &cfg)` in `handleGetConfig`, insert:
```go
// Backward-compat: if no repos registry, migrate legacy repo.path
if len(cfg.Repos) == 0 && cfg.Repo.Path != "" {
    cfg.Repos = []RepoEntry{{Name: "repo", Path: cfg.Repo.Path}}
}
cfg.Repo = RepoConfig{} // clear legacy field from response
```

In `handleSaveConfig`, after `json.NewDecoder(r.Body).Decode(&cfg)`, insert:
```go
cfg.Repo = RepoConfig{} // ensure legacy field is never written back
```

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web
go build ./...
go vet ./...
go test ./pkg/api/... -run TestConfig
```
If no `TestConfig` exists, add a minimal one in `pkg/api/config_handler_test.go` that:
1. Writes a legacy `{"repo":{"path":"/tmp/testrepo"}}` JSON to a temp dir
2. Calls `handleGetConfig` and asserts the response has `repos: [{name: "repo", path: "/tmp/testrepo"}]`

**Completion report format:**
```
## Wave 1 Agent B Completion Report
status: complete | partial | blocked
files_changed: [pkg/api/types.go, pkg/api/config_handler.go]
interface_deviations: none | <describe>
downstream_action_required: false | true — <what Wave 2 agents must know>
notes: <anything>
```

---

## Wave 2

Wave 2 launches after Agent A (Wave 1) is merged. All 5 agents are fully independent of each
other and run in parallel. Each agent imports `RepoEntry` from `web/src/types.ts` (already
published by Agent A). The `repos` prop is already threaded through `App.tsx` by Agent A.

Agent B (Go) can be merged independently of Agent A without blocking Wave 2.

### Agent C — SettingsScreen Repo List UI

**Role:** Replace the single repo path picker with a multi-repo list management UI

**Task:** Update `web/src/components/SettingsScreen.tsx` to show a list of registered repos (each with a name and path), allow adding new repos using the existing `DirPicker` component, allow removing repos, and propagate changes up via `onReposChange` prop.

**Files you own:** `web/src/components/SettingsScreen.tsx`

**Do not touch:** `DirPicker.tsx`, `App.tsx`, `types.ts`, or any other component.

**What to implement:**

The Repository section currently shows a single `DirPicker`. Replace it with:

1. A list of existing repos, each row showing:
   - An editable text input for the `name` (e.g. "web", "go")
   - A `DirPicker` for the `path`
   - A remove button (`✕`)

2. An "Add repo" button that appends `{ name: '', path: '' }` to the local list.

3. On save (`handleSave`), write the full `config.repos` array to `SAWConfig` and call
   `onReposChange?.(config.repos)` after a successful save so App.tsx state updates.

Local state: manage the repo list as `config.repos` (already part of `SAWConfig` after Wave 1).
The default state initializer should handle `repos: []` gracefully (show empty list + "Add repo").

**Props change:** `SettingsScreen` now receives `onReposChange?: (repos: RepoEntry[]) => void`.
Import `RepoEntry` from `../types`.

**UX detail:** Validate that each repo has a non-empty path before saving. Show an inline error
if any row has an empty path. Names are optional (default to the last path segment if blank when saving).

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build
```

**Completion report format:**
```
## Wave 2 Agent C Completion Report
status: complete | partial | blocked
files_changed: [web/src/components/SettingsScreen.tsx]
interface_deviations: none | <describe>
downstream_action_required: false
notes: <anything>
```

---

### Agent D — ScoutLauncher Repo Dropdown

**Role:** Replace freeform repo path input in ScoutLauncher with a dropdown of registered repos

**Task:** Update `web/src/components/ScoutLauncher.tsx` so the optional repo path field becomes a
dropdown populated from the registered repos. When the registry has entries, show a `<select>`
listing them. Keep a "Custom path..." option at the bottom that reveals the existing freeform text
input as a fallback. When the registry is empty, keep the existing freeform input unchanged.

**Files you own:** `web/src/components/ScoutLauncher.tsx`

**Do not touch:** `LiveRail.tsx`, `App.tsx`, `types.ts`, or any other file.

**What to implement:**

1. Accept new optional prop: `repos?: RepoEntry[]` (import `RepoEntry` from `../types`).

2. Replace the existing `showRepo` / freeform input block with:
   - If `repos` is non-empty: show a `<select>` whose options are `repos.map(r => r.name)` plus
     a final `"Custom path..."` option.
   - When a repo is selected from the dropdown, set `repo` state to `repos[selectedIndex].path`.
   - When "Custom path..." is selected, reveal the freeform text input (existing behavior).
   - If `repos` is empty or undefined: show the existing freeform toggle unchanged.

3. The `repo` string passed to `runScout()` remains unchanged — it is always the absolute path.

4. The toggle button text changes to: `+ Repo (optional)` regardless of state.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build
```

**Completion report format:**
```
## Wave 2 Agent D Completion Report
status: complete | partial | blocked
files_changed: [web/src/components/ScoutLauncher.tsx]
interface_deviations: none | <describe>
downstream_action_required: false
notes: <anything>
```

---

### Agent E — ImplList Repo Switcher + Multi-Repo Badge

**Role:** Add repo switcher dropdown to sidebar header; add multi-repo badge on cross-repo plan entries

**Task:** Update `web/src/components/ImplList.tsx` to accept a `repos` prop and render two new UX elements:
1. A repo switcher at the top of the list (dropdown or tab strip) that sets the "active repo"
2. A small `[multi-repo]` badge on entries whose IMPL slug suggests cross-repo ownership

**Files you own:** `web/src/components/ImplList.tsx`

**Do not touch:** `App.tsx`, `types.ts`, `ImplListEntry` type in `types.ts`, or any other file.

**Important scoping note:** The backend `GET /api/impl` endpoint returns all IMPL docs from a single
directory (the server's `IMPLDir`). There is no per-repo filtering on the backend in this release.
The repo switcher is a UX hint only — it does not filter the list. Add a `// TODO: scope list to active repo` comment where filtering would go. This avoids a backend change in this wave.

**What to implement:**

1. Accept new optional prop `repos?: RepoEntry[]` (import `RepoEntry` from `../types`).

2. If `repos` has ≥2 entries, render a `<select>` at the top of the list above the entries:
   ```
   [All repos ▼]  (default option)
   [web]
   [go]
   ```
   This select is visual-only for now (no filtering). Add a `// TODO` comment.

3. Multi-repo badge: for each `IMPLListEntry`, inspect `e.slug`. If the slug contains a
   cross-repo hint keyword (`cross-repo`, `multi-repo`, `engine`, or `extraction`), render a
   small badge: `<span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 ml-1 font-mono">multi</span>`

   This is a heuristic for now; a proper implementation would parse file ownership. Add a comment
   noting this.

4. The `IMPLListEntry` type in `types.ts` does NOT gain new fields. Detection is slug-based only.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build
```

**Completion report format:**
```
## Wave 2 Agent E Completion Report
status: complete | partial | blocked
files_changed: [web/src/components/ImplList.tsx]
interface_deviations: none | <describe>
downstream_action_required: false
notes: <anything>
```

---

### Agent F — FileOwnershipPanel Grouped by Repo

**Role:** Group file ownership rows under collapsible repo-name headers when files span multiple repos

**Task:** Update `web/src/components/review/FileOwnershipPanel.tsx` and
`web/src/components/FileOwnershipTable.tsx` so that when the file ownership list includes paths
from multiple repo roots, the rows are grouped under collapsible repo-name section headers.

**Files you own:**
- `web/src/components/review/FileOwnershipPanel.tsx`
- `web/src/components/FileOwnershipTable.tsx`

**Do not touch:** `App.tsx`, `types.ts`, `ReviewScreen.tsx`, or any other component.

**How to detect repo roots:**

Use this exact utility (copy-paste into `FileOwnershipPanel.tsx`):
```typescript
function detectRepoName(filePath: string, repos: RepoEntry[]): string {
  let best = ''
  let bestLen = 0
  for (const r of repos) {
    if (filePath.startsWith(r.path) && r.path.length > bestLen) {
      best = r.name
      bestLen = r.path.length
    }
  }
  return best
}
```

**What to implement:**

1. `FileOwnershipPanel` receives a new optional prop `repos?: RepoEntry[]` (import from `../../types`).

2. If `repos` is empty/undefined or all files map to the same repo (or no repo matches), render
   `FileOwnershipTable` exactly as today — no grouping. This preserves single-repo behavior.

3. If files span ≥2 distinct `detectRepoName` results, group the `fileOwnership` array by repo
   name and render one `<details>` section per repo:
   ```tsx
   <details open>
     <summary className="...">web (12 files)</summary>
     <FileOwnershipTable fileOwnership={repoGroup} col4Name={...} />
   </details>
   ```
   Files that do not match any repo get grouped under an "other" section.

4. Each `<details>` section is open by default. Clicking the `<summary>` collapses it.

5. Style the `<summary>` to match the existing card header style: `text-sm font-medium px-2 py-1.5 cursor-pointer select-none`.

**Props change for `FileOwnershipPanel`:**
```typescript
interface FileOwnershipPanelProps {
  impl: IMPLDocResponse
  repos?: RepoEntry[]    // NEW — optional, passed by ReviewScreen or parent
}
```

**Note:** `ReviewScreen.tsx` currently renders `FileOwnershipPanel`. You will need to check
whether `ReviewScreen` already receives a `repos` prop. It likely does not yet — that prop
threading is Agent A's responsibility for `App.tsx`, but `ReviewScreen` is in a different call
chain. For this wave, accept `repos` as optional and default to `[]` so the panel degrades
gracefully when not provided. Add a `// TODO: thread repos from App` comment on the prop.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build
```

**Completion report format:**
```
## Wave 2 Agent F Completion Report
status: complete | partial | blocked
files_changed: [web/src/components/review/FileOwnershipPanel.tsx, web/src/components/FileOwnershipTable.tsx]
interface_deviations: none | <describe>
downstream_action_required: false
notes: <anything>
```

---

### Agent G — WaveBoard Agent Repo Tag

**Role:** Add a small repo tag to each AgentCard in WaveBoard showing the dominant repo

**Task:** Update `web/src/components/WaveBoard.tsx` to display a small `[web]` / `[go]` tag on
each agent card, derived from the dominant repo root in that agent's file ownership list.

**Files you own:** `web/src/components/WaveBoard.tsx`

**Do not touch:** `AgentCard.tsx`, `App.tsx`, `types.ts`, or any other file.

**How to compute the dominant repo tag:**

Use this exact utility (copy-paste into `WaveBoard.tsx`):
```typescript
function detectRepoName(filePath: string, repos: RepoEntry[]): string {
  let best = ''
  let bestLen = 0
  for (const r of repos) {
    if (filePath.startsWith(r.path) && r.path.length > bestLen) {
      best = r.name
      bestLen = r.path.length
    }
  }
  return best
}

function dominantRepo(files: string[], repos: RepoEntry[]): string {
  const counts = new Map<string, number>()
  for (const f of files) {
    const name = detectRepoName(f, repos)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) { best = name; bestCount = count }
  }
  return best
}
```

**What to implement:**

1. `WaveBoard` receives a new optional prop `repos?: RepoEntry[]` (import `RepoEntry` from `../types`).

2. In the agent card render loop (`waveAgents.map(...)`), after `<AgentCard agent={agent} />`,
   compute `const tag = dominantRepo(agent.files, repos ?? [])`.

3. If `tag` is non-empty, render a small tag badge alongside the agent card:
   ```tsx
   {tag && (
     <span className="self-start text-[9px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground bg-muted">
       [{tag}]
     </span>
   )}
   ```

4. If `repos` is empty/undefined or `tag` is empty, render nothing (graceful degradation).

5. `AgentCard.tsx` is NOT modified. The tag is rendered as a sibling element in `WaveBoard.tsx`'s
   existing `<div className="flex flex-col gap-1">` wrapper (already wraps AgentCard + failure button).

**Note on `agent.files`:** `AgentStatus.files` is already populated by the `agent_started` SSE
event. If a newly registered agent has an empty files list (not yet started), the tag will simply
be empty — that is correct behavior.

**Verification gate:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-web/web
command npm run build
```

**Completion report format:**
```
## Wave 2 Agent G Completion Report
status: complete | partial | blocked
files_changed: [web/src/components/WaveBoard.tsx]
interface_deviations: none | <describe>
downstream_action_required: false
notes: <anything>
```

---

## Wave Execution Loop

After each wave completes, work through the Orchestrator Post-Merge Checklist below in order.

Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks the merge
  entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be propagated to downstream
  agent prompts before that wave launches.
- Post-merge verification is the real gate.

### Orchestrator Post-Merge Checklist

**After Wave 1 completes:**

- [ ] Read Agent A and Agent B completion reports — confirm all `status: complete`
- [ ] Verify Agent A's `RepoEntry` interface matches the contract exactly (name/path fields)
- [ ] Verify Agent B's `SAWConfig.Repos` Go type matches the contract (name/path JSON tags)
- [ ] Cross-reference `files_changed` — no overlap between A and B
- [ ] Review `interface_deviations` — update Wave 2 agent prompts for any deviation flagged with `downstream_action_required: true`
- [ ] Merge Agent A: `git merge --no-ff wave1-agent-a -m "Merge wave1-agent-a: TypeScript types + App repo state"`
- [ ] Merge Agent B: `git merge --no-ff wave1-agent-b -m "Merge wave1-agent-b: Go config schema + migration"`
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d <branch>` for each
- [ ] Post-merge verification:
      - [ ] Linter auto-fix: n/a (no auto-fix configured)
      - [ ] `go build ./... && go vet ./... && go test ./...`
      - [ ] `cd web && command npm run build`
- [ ] Fix any cascade failures
- [ ] Tick Wave 1 status rows below
- [ ] Commit: `git commit -m "wave1: repo registry foundation — types, Go schema, App state"`
- [ ] Launch Wave 2 (all 5 agents in parallel)

**After Wave 2 completes:**

- [ ] Read all 5 completion reports — confirm all `status: complete`
- [ ] Cross-reference `files_changed` — no file owned by more than one agent
- [ ] Merge all 5 agents (any order, all independent):
      - [ ] `git merge --no-ff wave2-agent-c -m "Merge wave2-agent-c: SettingsScreen repo list UI"`
      - [ ] `git merge --no-ff wave2-agent-d -m "Merge wave2-agent-d: ScoutLauncher repo dropdown"`
      - [ ] `git merge --no-ff wave2-agent-e -m "Merge wave2-agent-e: ImplList repo switcher + badge"`
      - [ ] `git merge --no-ff wave2-agent-f -m "Merge wave2-agent-f: FileOwnershipPanel grouped by repo"`
      - [ ] `git merge --no-ff wave2-agent-g -m "Merge wave2-agent-g: WaveBoard agent repo tag"`
- [ ] Worktree cleanup for all 5 agents
- [ ] Post-merge verification:
      - [ ] `go build ./... && go vet ./... && go test ./...`
      - [ ] `cd web && command npm run build`
- [ ] Feature-specific steps:
      - [ ] Manually test: open Settings, add 2 repos, save, reopen — verify repos persist
      - [ ] Manually test: open New Plan, verify dropdown shows registered repos
      - [ ] Manually test: open a cross-repo IMPL doc, verify FileOwnershipPanel groups by repo
      - [ ] Thread `repos` prop from `App.tsx` through `ReviewScreen` to `FileOwnershipPanel` (post-merge orchestrator task — single line change in ReviewScreen.tsx not owned by any agent)
      - [ ] Rebuild and restart the server: `go build -o saw ./cmd/saw && pkill -f "saw serve"; ./saw serve &>/tmp/saw-serve.log &`
- [ ] Commit: `git commit -m "wave2: multi-repo GUI — settings, scout launcher, impl list, file ownership, wave board"`

### Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 1 | A | TypeScript types (`RepoEntry`, `SAWConfig`) + App.tsx repo state | TO-DO |
| 1 | B | Go config schema (`RepoEntry`, `SAWConfig.Repos`) + migration | TO-DO |
| 2 | C | SettingsScreen repo list management UI | TO-DO |
| 2 | D | ScoutLauncher repo dropdown | TO-DO |
| 2 | E | ImplList repo switcher + multi-repo badge | TO-DO |
| 2 | F | FileOwnershipPanel grouped by repo | TO-DO |
| 2 | G | WaveBoard agent repo tag | TO-DO |
| — | Orch | Post-merge integration, ReviewScreen prop thread, binary rebuild | TO-DO |

---

## Wave 1 Agent B Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: 50feaa7
files_changed:
  - pkg/api/types.go
  - pkg/api/config_handler.go
files_created:
  - pkg/api/config_handler_test.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - pkg/api/config_handler_test.go: TestConfigMigration_LegacyRepoPath
  - pkg/api/config_handler_test.go: TestConfigMigration_NoMigrationWhenReposPresent
verification: PASS (go build ./..., go vet ./..., go test ./pkg/api/... -run TestConfig -v)
```

Both changes are purely additive. `SAWConfig.Repo` is now `omitempty` so existing configs without
a legacy field serialize cleanly. Migration logic fires only when `repos` is absent and `repo.path`
is non-empty; no data is lost. Wave 2 agents can read `SAWConfig.Repos []RepoEntry` from
`GET /api/config` and `POST /api/config` with confidence that the legacy field will never appear
in responses or persisted files.

## Wave 1 Agent A Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: ec66709
files_changed:
  - web/src/types.ts
  - web/src/App.tsx
  - web/src/components/SettingsScreen.tsx
  - web/src/components/ImplList.tsx
  - web/src/components/LiveRail.tsx
files_created: []
interface_deviations:
  - activeRepo and onRepoSwitch added as optional props to LiveRailProps (not in original spec
    but required to avoid noUnusedLocals TS error for handleRepoSwitch defined in App.tsx)
out_of_scope_deps:
  - SettingsScreen.tsx required a one-line fix to its useState<SAWConfig> initial value
    (added repos: []) because SAWConfig.repos is now a required field; this touched component
    logic beyond a prop interface declaration but was necessary for zero TS errors
tests_added: []
verification: PASS (command npm run build — zero TypeScript errors, vite build succeeded)
```

The build was clean after npm install in the worktree (node_modules were not present). Key decisions:

- `noUnusedLocals: true` and `noUnusedParameters: true` are both active in tsconfig.json. To
  avoid an unused-local error for `handleRepoSwitch`, it is passed to LiveRail as `onRepoSwitch`
  (optional prop). Wave 2 agents implementing LiveRail behavior should consume it there.
- `activeRepo` is similarly passed to LiveRail as an optional prop so it is referenced and not
  flagged as unused.
- The SettingsScreen `useState<SAWConfig>` initial literal needed `repos: []` added since `repos`
  is now a required field on `SAWConfig`. This is a one-line data change, no JSX or behavior was
  altered.
- `web/src/api.ts` required no changes — `getConfig` and `saveConfig` already accept `SAWConfig`
  and TypeScript compiled cleanly with the updated type.

## Wave 2 Agent C Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-C
branch: wave2-agent-C
commit: efbc838
files_changed:
  - web/src/components/SettingsScreen.tsx
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build — zero TypeScript errors, vite build clean)
```

Replaced the single DirPicker repo section with a full multi-repo list management UI. Key decisions:

- The worktree has no `node_modules` of its own; the worktree shares source files with the main repo. Build was verified by running `npm run build` from the main repo's `web/` directory, which has the correct `node_modules` — the worktree's SettingsScreen.tsx changes are picked up because git worktrees share working-tree files.
- Added `repoErrors` state separate from the general `error` state so path-validation errors appear inline near the repo list rather than at the top of the form.
- `onReposChange` is now destructured from props (Wave 1 had declared it in the interface but the function body ignored it). Called after successful `saveConfig` with the normalized repos array.
- Name defaulting (last path segment) happens only at save time; the input field is left blank during editing so the user sees the placeholder and can still type a custom name.

## Wave 2 Agent D Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-D
branch: wave2-agent-D
commit: 290f8ae
files_changed:
  - web/src/components/ScoutLauncher.tsx
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build — tsc clean, vite build clean)
```

Replaced the freeform repo path toggle in ScoutLauncher with a dropdown when `repos` is non-empty.

Key decisions:

- Added `repos?: RepoEntry[]` and `activeRepo?: RepoEntry | null` to `ScoutLauncherProps`. `RepoEntry` imported from `../types`.
- Added `dropdownValue` state (separate from `repo`) to track the `<select>` value including the sentinel `__custom__`. This lets the select stay on "Custom path..." while the user types in the freeform input below, without conflating the two.
- When `activeRepo` is provided, both `repo` and `dropdownValue` are initialised to `activeRepo.path` so the correct entry is pre-selected on mount.
- `showRepo` continues to gate the freeform input: in dropdown mode it only becomes true when "Custom path..." is chosen; in freeform-only mode it remains the old toggle button.
- LiveRail currently does not forward `repos`/`activeRepo` to ScoutLauncher (line 46 of LiveRail.tsx passes only `onComplete`/`onScoutReady`). This is an out-of-scope wiring step — the props are accepted and functional, but require LiveRail to pass them through to light up in the running app.

## Wave 2 Agent E Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-E
branch: wave2-agent-E
commit: a4aec51
files_changed:
  - web/src/components/ImplList.tsx
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

Updated `ImplList.tsx` to accept `repos?: RepoEntry[]` prop (replaced inline import type with named import from `../types`).

Key decisions:

- Repo switcher `<select>` renders above the entry list when `repos` has >= 2 entries. It is visual-only with a TODO comment for filtering logic.
- `isMultiRepo()` helper checks slug against four keywords: `cross-repo`, `multi-repo`, `engine`, `extraction`. Badge is rendered in both the active and completed entry sections.
- `IMPLListEntry` type was not modified per constraints.
- `node_modules` was not present in the worktree web dir — ran `command npm install` first to satisfy the build gate. The `dist/` output was not committed (only `ImplList.tsx` was staged).

## Wave 2 Agent G Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-G
branch: wave2-agent-G
commit: 13674ef
files_changed:
  - web/src/components/WaveBoard.tsx
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

Agent.files already existed as string[] on AgentStatus in types.ts — no local type extension needed.
Repos prop is optional; tag renders nothing when repos is empty or no file matches a repo path.
node_modules were absent from the worktree web dir; installed via npm install before build.

## Wave 2 Agent F Completion Report

```yaml type=impl-completion-report
status: complete
worktree: .claude/worktrees/wave2-agent-F
branch: wave2-agent-F
commit: 5fe8b89
files_changed:
  - web/src/components/review/FileOwnershipPanel.tsx
  - web/src/components/FileOwnershipTable.tsx
files_created: []
interface_deviations: []
out_of_scope_deps: []
tests_added: []
verification: PASS (npm run build)
```

Key decisions:

- `detectRepoName()` uses longest-prefix matching so nested repo paths resolve correctly.
- Grouping triggers only when `repos` is non-empty AND entries map to >=2 distinct repo names. Single-repo or no-match cases render the existing `FileOwnershipTable` unchanged.
- Files that match no repo are collected into an "other" group (sorted last).
- Groups are ordered by the position of the repo in the `repos` array, matching registry declaration order.
- `onFileClick` was added as an optional prop to both `FileOwnershipPanel` and `FileOwnershipTable`. The table accepts it via `_onFileClick` (underscore prefix) since the table does not yet wire click handlers to rows — this avoids a TypeScript unused-variable error while preserving the threading contract.
- `node_modules` was absent from the worktree; ran `command npm install` to satisfy the build gate. Only owned source files were staged and committed.
