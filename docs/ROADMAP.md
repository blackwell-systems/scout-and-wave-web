# Scout-and-Wave Roadmap

## Vision

**SAW is the only agent coordination framework that solves merge conflicts by design — parallel agents own disjoint files, branches merge cleanly, and humans review the plan before any code is written.**

Competitive positioning:
- Single-agent tools (simple loop, great DX, serial execution — one agent, one task)
- Parallel-capable tools (parallel stories, rich desktop app, complex surface area, vague on merge safety)
- SAW: protocol-driven parallelism, hard merge safety guarantees, human review gate, zero merge conflicts by construction

Distribution strategy: `/saw` skill + subagents for orchestration (already works, zero setup); Wails desktop app for rich wave monitoring with native OS distribution.

**Repo structure:**
```
scout-and-wave-go/       github.com/blackwell-systems/scout-and-wave-go (engine)
  pkg/engine/            wave runner, scout runner, merge, worktree mgmt
  pkg/protocol/          IMPL doc parser
  internal/git/          git commands

scout-and-wave-web/      github.com/blackwell-systems/scout-and-wave-web (current repo)
  pkg/api/               HTTP adapter over engine (imports engine module)
  web/                   React frontend
  cmd/saw/               web server binary

scout-and-wave-app/      Wails desktop app (future)
  cmd/saw-app/           Wails binary
  src/                   React frontend (shared from scout-and-wave-web)
```

---

## Current Status (v0.20.3)

### ✅ Shipped

**Protocol & engine**
- Core protocol (I1–I6 invariants, E1–E16 execution rules)
- Go orchestration engine (worktrees, merge, state machine)
- E16 IMPL doc validator (required blocks, typed-block dispatch, dep graph detection)
- Scaffold Agent gap detection in wave runner (`runScaffoldIfNeeded`)
- **Engine extraction complete** — `scout-and-wave-go` is a standalone Go module; `scout-and-wave-web` imports it via `replace` directive. All wave runner, parser, git, worktree, and agent packages live in the engine repo.
- Cross-repo wave support (protocol v0.11.0): multi-repo worktree coordination, `Repo` column in file ownership, updated isolation layers

**Web UI**
- 3-column persistent layout: sidebar | review | LiveRail
- Scout launcher: description input, 15-char minimum, live output streaming, completion banner
- ReviewScreen: toggleable panels, sticky toolbar, pre-mortem, wave structure, dep graph, file ownership, interface contracts, scaffolds, known issues, post-merge checklist, stub report
- WaveBoard: live agent cards, status badges, agent color coding (A–K), output toggle, re-run button
- Request Changes: RevisePanel with manual markdown editor + Claude revision via SSE
- Plan approval / rejection / request changes actions
- ThemePicker: Gruvbox Dark, Darcula, Catppuccin Mocha, Nord (persisted to localStorage)
- Dark mode toggle, scrollbar follows active theme
- SVG dependency graph with bezier edges, agent color nodes, hover tooltips
- Git activity sidebar: branch lanes, commit dots, animated merge lines
- Wave gate: pause-between-waves banner with inline IMPL editor
- Cancel button: Scout and Revise cancellation with silent reset (`scout_cancelled` / `revise_cancelled` SSE events)
- Desktop notifications: browser Notification API, fires on scout/wave/revise complete
- Auto-refresh sidebar: IMPL list refreshes immediately on scout complete
- Delete IMPL: hover ✕ button with confirm dialog, removes IMPL doc from disk
- StubReportPanel: E20 stub scan output with "clean" or "stubs detected" badges
- QualityGatesPanel: E21 gate definitions with command/required/optional/description table

**Streaming**
- PTY + `--output-format stream-json` pipeline: per-event real-time streaming
- JSON fragment reassembly for PTY-wrapped lines
- Rich event formatting: `→ ToolName(arg)`, indented tool results, `✓ complete`
- SSE broker (2048-channel capacity) for scout, wave, and revise events

**API**
- `POST /api/scout/run` + `GET /api/scout/{runID}/events`
- `POST /api/impl/{slug}/revise` + `GET /api/impl/{slug}/revise/{runID}/events`
- `GET|PUT /api/impl/{slug}/raw`
- `POST /api/wave/{slug}/start|gate/proceed|agent/{letter}/rerun`
- `GET /api/git/{slug}/activity`

---

## Phase 1: Close the GUI Loop (v0.17.0)

**Goal:** You should never need a terminal. Everything from feature description to merged, tested code happens in the SAW GUI.

### What forces you out of the GUI today

| Trigger | Current workaround | Fix | Status |
|---|---|---|---|
| Wave completes | `saw merge` in terminal | Merge button in WaveBoard | ✅ Shipped (v0.17.0-A) |
| Merge succeeds | `go test` / `npm test` in terminal | Inline test runner | ✅ Shipped (v0.17.0-B) |
| Want to see changes | Open IDE | File diff viewer | Pending |
| Scout/revise hung | Kill process in terminal | Cancel button | ✅ Shipped |
| Old worktrees pile up | `git branch -D` in terminal | Worktree manager | Pending |
| Want to configure SAW | Edit JSON | Settings screen | ✅ Shipped (v0.18.0-C) |

---

### v0.17.0-A — Merge Button

**Why:** Wave completion is completely invisible from the GUI. You finish reviewing completion reports and then... go to terminal. This is the single biggest workflow break.

**Scope:**
- "Merge Wave" button appears in WaveBoard after all agents in current wave report `status: complete`
- Click triggers `POST /api/wave/{slug}/merge` — runs the merge procedure server-side
  - `git merge --no-ff wave{N}-agent-{X}` for each agent in merge order
  - Conflict detection: if merge fails, surface conflict details in UI
  - Cleanup: delete merged worktree branches
- SSE stream shows merge output line-by-line as it runs
- On success: wave card turns green, "Proceed to Wave N+1" or "Complete" banner appears
- On conflict: red banner with conflicting files listed, link to manual resolution guide

**Success criteria:**
- Full wave → merge → next wave cycle happens entirely in browser
- Merge conflicts surfaced with enough detail to resolve without terminal

---

### v0.17.0-B — Post-Merge Test Runner

**Why:** After merging you need to verify nothing broke. Currently requires terminal.

**Scope:**
- "Run Tests" button appears after successful merge
- Reads test command from IMPL doc (`test_command` field); falls back to auto-detection (`go test ./...`, `npm test`, `cargo test`)
- Streams test output via SSE
- Pass: green banner. Fail: red banner with failed test output highlighted
- Results saved to IMPL doc as a post-merge note

**Success criteria:**
- Test results visible in GUI within seconds of merge completing
- Failed tests show enough context to understand what broke

---

### v0.17.0-C — File Diff Viewer

**Why:** Agents write code you can't see from the GUI. You're approving work you can't inspect.

**Scope:**
- Clicking any file in the File Ownership panel opens a diff panel
- `GET /api/impl/{slug}/diff/{agent}` — runs `git diff main...wave{N}-agent-{X} -- {file}` and returns unified diff
- Syntax-highlighted diff (added lines green, removed red, unchanged gray)
- For completed waves: shows merged diff against main
- "← Back" returns to review

**Success criteria:**
- You can read every file an agent touched without leaving SAW
- Diff loads in under 1 second for files under 500 lines

---

### v0.17.0-D — Worktree Manager

**Why:** Failed or aborted waves leave `wave{N}-agent-{X}` branches on disk indefinitely. They pile up silently and cause "branch already exists" errors on re-runs.

**Scope:**
- Worktree panel in sidebar (or WaveBoard footer): lists all SAW-created branches for the current slug
- `GET /api/impl/{slug}/worktrees` — returns branch list with status (merged, unmerged, stale)
- One-click cleanup: delete selected branches + worktree directories
- Warning before deleting unmerged branches with uncommitted changes
- Auto-suggest cleanup when a new wave run is about to start and stale branches exist

**Success criteria:**
- No need to run `git branch -D` manually
- Re-running a wave after failure works without "branch exists" errors

---

## Phase 2: Deepen the Intelligence (v0.18.0)

### v0.18.0-A — Scout Context Panel

**Why:** Scout often misses context that's obvious to the developer — an existing pattern to follow, a file to avoid, an architectural constraint. Currently you can only add it by editing the IMPL doc after the fact.

**Scope:**
- Expandable "Add context" section in ScoutLauncher (below feature description)
  - File attachments: paste file paths, SAW reads them and includes content in scout prompt
  - Free-text notes: "follow the pattern in pkg/api/scout.go", "don't touch the parser"
  - Constraint checkboxes: "keep backward compatible", "no new dependencies", "tests required"
- Context is appended to the scout system prompt before launch
- Context persists in browser session so you can reuse it across scout runs

**Success criteria:**
- Scout incorporates attached file content in its analysis
- Common constraints can be set in one click

---

### v0.18.0-B — Chat with Claude About the Plan

**Why:** Before approving an IMPL doc you often have questions — "why did you put this in wave 2?", "can this be done in one wave?", "what happens if agent B fails?" Currently you either approve blind or do a full revision.

**Scope:**
- "Ask Claude" chat panel in ReviewScreen (separate from Request Changes)
- Lightweight Q&A: user asks a question, Claude answers in context of the IMPL doc
- Does NOT modify the IMPL doc — read-only consultation
- Full conversation history visible in the panel
- "Apply this suggestion" button converts a chat answer into a revision request

**Success criteria:**
- You can ask architectural questions and get answers in under 30 seconds
- Chat context includes the full IMPL doc so Claude's answers are grounded

---

### v0.18.0-C — Settings Screen

**Why:** Configuring SAW requires editing JSON files. Non-technical users can't do it.

**Scope:**
- Settings route in sidebar (gear icon)
- **Repo section:** default repo path, docs/IMPL dir override
- **Agent section:** per-phase model selection (scout/wave/scaffold/revise), max turns
- **Quality gates:** test command, lint command, required vs. warning
- **Appearance:** theme (already in header, expose here too), font size, compact mode
- API: `GET|POST /api/config` — load/save `saw.config.json`
- Hot reload: config changes apply without server restart

---

### v0.18.0-D — Failure Type Action Buttons

**Why:** A blocked wave is currently a dead end in the UI — you see `status: blocked` with no path forward. Protocol v0.12.0 added `failure_type: transient | fixable | needs_replan | escalate` and v0.13.0 added `timeout` to completion reports. The UI can now offer the right action per failure type instead of leaving the user to figure it out.

**Scope:**
- WaveBoard failed agent cards: parse `failure_type` from completion report, show action button per type
  - `transient` → "Retry" button (POST `/api/wave/{slug}/agent/{letter}/rerun`)
  - `fixable` → "Fix + Retry" button — surfaces agent's free-form notes describing the fix, then re-runs
  - `needs_replan` → "Re-Scout" button — launches a new scout run with the agent's completion report as additional context
  - `escalate` → "Escalate" badge — no button, highlights for human attention
  - `timeout` → "Retry (scope down)" button — surfaces agent's partial completion summary showing what was finished, prompts user to confirm before re-running with a scope-reduction note injected into the retry prompt
- If `failure_type` is absent from a `partial`/`blocked` report, treat as `escalate` (backward compat)
- Parse `failure_type` from the `impl-completion-report` typed block in IMPL doc

**Success criteria:**
- No blocked wave requires a terminal to resolve
- The correct recovery action is one click
- Timeout retries show partial completion context before the user confirms

---

### v0.18.0-E — Stub Report Panel

**Why:** Protocol E20 (v0.12.0) defines `## Stub Report — Wave {N}` sections written to the IMPL doc after each wave. Currently these appear as raw markdown in the review screen. Surfacing them prominently before the approve buttons gives reviewers a clear signal before they approve.

**Scope:**
- ReviewScreen: parse `## Stub Report — Wave {N}` sections from IMPL doc (prose, not a typed block)
- Show a "Stub Report" panel per wave in the review screen, collapsed by default, with a warning badge if stubs were found
- Table display: File | Line | Pattern | Context (from scan-stubs.sh output)
- "No stubs detected" green indicator when clean
- Panel appears between wave completion reports and the approve/reject buttons
- API: `GET /api/impl/{slug}/raw` already returns the full doc — parse client-side

**Success criteria:**
- Reviewer sees stub count before approving, without reading raw markdown

---

### v0.18.0-F — Quality Gates Panel

**Why:** Protocol E21 (v0.12.0) defines a `## Quality Gates` section written by the Scout. The UI can show configured gates and their results after waves run.

**Scope:**
- ReviewScreen: parse `## Quality Gates` section (level + gates array) and display as a configuration panel
- After wave completes: show gate results alongside the wave card (pass/fail badge per gate, command + exit code)
- Gates configured `required: true` show as blocking (red); `required: false` as advisory (yellow)
- API: `GET|PUT /api/impl/{slug}/raw` + client-side parse, or new `GET /api/impl/{slug}/gates` endpoint
- Settings screen (v0.18.0-C) exposes default gate config; per-IMPL gates override

**Success criteria:**
- Quality gate results visible in UI without reading IMPL doc raw markdown

---

### v0.18.0-G — CONTEXT.md Viewer

**Why:** Protocol E17/E18 (v0.12.0) define `docs/CONTEXT.md` — persistent project memory that Scouts read before every run and Orchestrators update after each feature. Making it visible and editable in the UI closes the loop for users who want to understand or correct what the Scout knows about their project.

**Scope:**
- Sidebar item: "Project Memory" — reads `docs/CONTEXT.md` from the project root
- Read view: display structured YAML fields (architecture, decisions, conventions, established_interfaces, features_completed) in a human-readable format
- Edit view: inline YAML editor with save (PUT to file via API)
- API: `GET|PUT /api/context` — reads/writes `docs/CONTEXT.md` in configured project root
- If `docs/CONTEXT.md` doesn't exist, show "No project memory yet — completes automatically after your first feature"

**Success criteria:**
- Users can read and correct project memory without opening a text editor

---

### v0.18.0-H — NOT SUITABLE Full Research View

**Why:** When Scout returns NOT SUITABLE, ReviewScreen shows a dead end — a verdict and a short rationale. Protocol roadmap item "Full Research Output on NOT SUITABLE Verdicts" will make Scouts write complete research regardless of verdict (dep graph, file survey, risk assessment, "what would make it suitable"). The UI needs to render this when it arrives rather than treating NOT SUITABLE as an empty state.

**Scope:**
- ReviewScreen: detect NOT SUITABLE verdict from `## Suitability Assessment` section
- Render all research panels normally (dep graph, file ownership, interface contracts) with verdict badge prominent at top in red
- Add "What Would Make It Suitable" callout card — parsed from a new `## What Would Make It Suitable` section in NOT SUITABLE IMPL docs
- Add "Serial Implementation Notes" panel — parsed from `## Serial Implementation Notes` section
- "Approve" and "Reject" buttons replaced with "Archive" (moves IMPL doc to `docs/IMPL/archived/`)
- API: `GET /api/impl/{slug}/raw` already sufficient — client-side parse

**Dependency:** Requires the protocol "Full Research Output on NOT SUITABLE Verdicts" change to Scout to be useful. UI can be built now as a no-op fallback (just renders the existing minimal NOT SUITABLE doc without breaking).

**Success criteria:**
- NOT SUITABLE is not a dead end — it's a map of why and what to do next
- All research panels populate even when the verdict is negative

---

### v0.18.0-I — Scaffold Build Failure Detail *(API done v0.33.0; UI pending)*

**Why:** Protocol E22 (v0.13.0) requires the Scaffold Agent to run `go build ./...` (or equivalent) and report `status: FAILED` with build error output if it fails. Currently this surfaces as a generic BLOCKED state with no detail. The wave won't launch and the user doesn't know why or what to fix.

**Scope:**
- ReviewScreen/WaveBoard: detect SCAFFOLD_PENDING → BLOCKED transition from scaffold status field in IMPL doc Scaffolds section
- When scaffold status contains `FAILED:`, show build error output in a syntax-highlighted code block (streaming via existing SSE if build is still running; static if already failed)
- "Revise Interface Contracts" button opens the IMPL doc editor (RevisePanel) pre-focused on the Interface Contracts section
- Clear "why this failed" explanation: "The Scaffold Agent could not compile the interface definitions. Fix the contracts above and re-run."
- API: `GET /api/impl/{slug}/raw` for current scaffold status; re-run scaffold via new `POST /api/impl/{slug}/scaffold/rerun`

**Success criteria:**
- Build failure output visible in UI within 2 seconds of scaffold reporting FAILED
- User can identify and fix the failing interface contract without leaving SAW

---

### v0.18.0-K — Large IMPL Doc Scalability

**Why:** Phase 1+2 together produce 14-agent IMPL docs. The ReviewScreen already panels the doc into structured views so human readability isn't the problem. The problem is engine-side: every Wave agent launched receives the full doc as context — token waste that scales O(N²) with agent count. Agent A gets all 13 other agents' full prompts even though it only needs its own section and the shared contracts.

**Scope:**
- `GET /api/impl/{slug}/agent/{letter}/context` — serve the trimmed per-agent context payload: that agent's prompt section + interface contracts + file ownership table + scaffolds + quality gates. Used by the orchestrator at launch time.
- Wave launch path: pass per-agent context payload instead of full IMPL doc when invoking Wave agents via `/api/wave/{slug}/start`
- ReviewScreen: "Agent Context" toggle on each agent card — shows the trimmed payload that agent received at launch (debugging: "why did agent B miss the contract?")
- Lazy-load IMPL doc sections in ReviewScreen: fetch and parse only the active panel, not the full doc on every view switch

**Success criteria:**
- 14-agent IMPL doc launches with the same per-agent context size as a 5-agent one
- ReviewScreen initial load stays under 1 second regardless of IMPL doc length

---

### v0.18.0-J — Pre-Wave Quality Gates Preview

**Why:** v0.18.0-F shows quality gate *results* after wave completion. But Scout writes the `## Quality Gates` section at planning time — the gates are configured before any agent launches. Surfacing them during review gives the user a chance to adjust gate configuration before approving, and sets expectations for what will block the merge.

**Scope:**
- ReviewScreen: parse `## Quality Gates` section from IMPL doc during the pre-wave review step (same client-side parse as v0.18.0-F)
- Show "Quality Gates" panel in the review sidebar: level badge (`quick`/`standard`/`full`), list of gates with command and required/advisory status
- Required gates shown with lock icon — "merge will block if this fails"
- Advisory gates shown with warning icon — "informational only"
- "Edit Gates" inline: toggle required/optional per gate, add/remove gates — writes back via `PUT /api/impl/{slug}/raw`
- Panel collapses to a summary line when gates are default/standard: "3 gates configured (2 required)"
- API: `GET /api/impl/{slug}/raw` — client-side parse, no new endpoint needed

**Success criteria:**
- User sees exactly what will run before approving — no surprises at merge time
- Gate configuration adjustable in one click without opening a text editor

---

## Phase 3: Native App (v0.19.5+)

### v0.19.5 — Wails Desktop App

**Why:** The web server is the wrong distribution primitive for end users. The `/saw` skill handles orchestration — the UI's job is monitoring, and monitoring deserves a real native app.

**Scope:**
- New `scout-and-wave-app` repo: Wails app importing `scout-and-wave-engine`
- Replace `net/http` handlers with Wails bound methods
- Replace SSE `EventSource` with `runtime.EventsEmit` / `EventsOn`
- Replace `fetch` calls in `api.ts` with Wails JS bindings
- React frontend carries over as-is — WebKit/WebView2 renders it unchanged
- SVG dep graph, wave board, all components work without modification

**What you get:**
- `brew install --cask saw` on Mac, MSI on Windows, AppImage on Linux
- No port, no server process — double-click and it works
- Real OS notifications, menu bar wave progress indicator
- Hot reload in dev mode via `wails dev`
- Cross-platform via goreleaser

---

### v0.19.5 — Multi-Provider Backends

SAW agents are Claude-native today. This milestone decouples the engine from Anthropic's API so any model with tool-use support can run Scout, Wave, and Scaffold agents.

**Providers:**
- **OpenAI** — GPT-4o, o3, o4-mini via OpenAI API
- **LiteLLM** — proxy gateway covering 100+ models; single config for team deployments
- **Ollama** — local inference (Llama 3, Qwen, Mistral, etc.); fully air-gapped option
- **Kimi** (Moonshot AI) — strong code reasoning, long context; competitive on cost
- **Google Gemini** — Gemini 2.5 Pro via Vertex AI or AI Studio
- Any provider with OpenAI-compatible `/v1/chat/completions` endpoint

**Interface:**
- `--backend claude|openai|litellm|ollama|gemini|kimi` flag on all `saw` commands
- Auto-detection from env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY`, `OLLAMA_HOST`
- Per-agent model override: Scout on Claude Opus, Wave agents on a cheaper model
- `saw backends list` — show detected providers and their status

**Translation layer:**
- Normalize tool-use format across providers (Claude's `tool_use` vs OpenAI's `tool_calls`)
- Streaming response normalization (SSE format differs per provider)
- Token counting abstraction (each provider has different counting semantics)
- Retry/backoff per provider's rate limit headers

### v0.20.0 — MCP Server

`mcp-server-saw` package. Tools: `saw_scout`, `saw_wave`, `saw_status`, `saw_approve`. Expose SAW engine to any MCP-capable host.

### v0.21.0 — GitHub Integration

GitHub App that posts IMPL doc reviews as PR comments. Approval workflow in GitHub. Wave results posted back to PR.

---

## Phase 4: Scale (v1.0.0+)

- **v1.0.0** — Production hardening: OpenTelemetry, structured logging, cost tracking, sandboxed execution
- **v1.1.0** — Team features: multi-user review, role-based access, audit log, IMPL templates
- **v1.2.0** — Enterprise: self-hosted, SAML/SSO, on-prem LLM support

---

## Agent Color System (Cross-Cutting)

### ✅ Unified Deterministic Agent Color Palette — SHIPPED (v0.20.0)

**Status:** Complete. Golden angle color system with 26 base colors and multi-generation ID support shipped in v0.20.0.

**What shipped:**
- Golden angle hue calculation for 26 distinct colors (A-Z)
- Multi-generation ID support (A2, B3, A3, etc.)
- Dark mode awareness with automatic lightness adjustment
- FileOwnershipTable refactored to use centralized system
- DependencyGraphPanel regex fix for multi-generation parsing
- All components now consistent across surfaces

**Original problem statement (now resolved):** Fixed A–K palette (11 colors) broke down beyond 11 agents. FileOwnershipTable used local color arrays. Multi-generation IDs (A2, B3) not supported.

**Design:**

Agent IDs decompose into `(letter, generation)`:
- `"A"` → `(A, 1)`, `"B"` → `(B, 1)`
- `"A2"` → `(A, 2)`, `"B3"` → `(B, 3)`

**Hue** is derived from the letter using the golden angle for maximum perceptual separation:
```
hue = (charIndex * 137.508) % 360   // charIndex: A=0, B=1, ... Z=25
```
A=0° → red-orange, B≈137° → blue-green, C≈275° → violet, etc. Adjacent letters land on opposite sides of the color wheel.

**Lightness** varies by generation within the same hue, keeping the family relationship visually clear:
```
generation 1: hsl(hue, 65%, 45%)   // primary
generation 2: hsl(hue, 65%, 30%)   // darker shade
generation 3: hsl(hue, 65%, 60%)   // lighter shade
generation 4+: cycle with saturation variation
```

**Two derived values per agent** (matching current API in `agentColors.ts`):
- `getAgentColor(id)` → solid color for border, text, SVG nodes
- `getAgentColorWithOpacity(id, opacity)` → rgba fill for card backgrounds, table row tints

**Surfaces to update:**
1. `lib/agentColors.ts` — replace lookup table with deterministic function; add multi-char ID parser
2. `WaveStructurePanel.tsx` — already uses `getAgentColor`; picks up change automatically
3. `WaveBoard.tsx` / `AgentCard.tsx` — already uses `getAgentColor`; picks up automatically
4. `FileOwnershipTable.tsx` — add per-row agent color tint using `getAgentColorWithOpacity`
5. `DependencyGraphPanel.tsx` — SVG nodes already colored; verify consistent with new function

**Dark mode / light mode:** Hue stays constant across modes; lightness is mode-aware. In dark mode, lower base lightness (e.g. 40%) keeps colors vivid without washing out against dark backgrounds. In light mode, higher base lightness (e.g. 50%) prevents colors from being too dark against white. The HSL function handles this with a single `isDark` parameter that adjusts the lightness range used for each generation.

**Protocol dependency:** Multi-generation IDs (A2, B3) require the protocol to define them as valid agent identifiers. The parser must recognize them, and the IMPL doc format must allow them in wave structure and file ownership tables. See protocol roadmap for the corresponding change.

---

## Stretch Goals

- **Visual IMPL Builder** — drag-and-drop wave/agent definition, visual dep graph editor
- **Agent Marketplace** — publish custom agent prompts, community IMPL templates

---

## Current Focus

**Completed recently:**
- ✅ v0.20.3 — Multi-repo visual hierarchy (three-level: repo → wave → agent)
- ✅ v0.20.2 — Sticky footer for action buttons
- ✅ v0.20.0 — Golden angle color system (26 colors, multi-generation IDs, dark mode)
- ✅ v0.17.0-A — Merge button (POST /api/wave/{slug}/merge with SSE streaming)
- ✅ v0.17.0-B — Post-merge test runner (reads test_command, streams output)
- ✅ v0.17.0-C — File diff viewer (FileDiffPanel with syntax highlighting)
- ✅ v0.17.0-C — StubReportPanel (E20 stub scan output)
- ✅ v0.17.0-C — QualityGatesPanel (E21 gate definitions)
- ✅ v0.18.0-A — Scout context panel (attach files, add constraints)
- ✅ v0.18.0-B — Chat with Claude (Q&A about IMPL doc before approval)
- ✅ v0.18.0-C — Settings screen (repo, agent models, quality gates, appearance)
- ✅ v0.33.0 — Scaffold rerun API (`POST /api/impl/{slug}/scaffold/rerun`) — 501 stub replaced with full `engine.RunScaffold` integration; events stream via existing wave SSE broker
- ✅ v0.32.0 — Structured Scout output (schema-validated JSON → YAML); ManifestValidation panel; manifest routes wired

**Next:** Finish Phase 1 — close the remaining GUI loop gaps
- v0.17.0-D — **Worktree manager** (clean up stale branches in GUI)

**After that:** Remaining Phase 2 intelligence features
- v0.18.0-K — Large IMPL doc scalability (lazy-load panels, per-agent context trim)
- v0.18.0-D — Failure type action buttons (transient/fixable/needs_replan/escalate/timeout)
- v0.18.0-H — NOT SUITABLE full research view
- v0.18.0-I — Scaffold build failure detail

**Then:** v0.19.5 — Wails desktop app. Engine extraction complete — import `scout-and-wave-go`, replace HTTP/SSE with Wails bindings, React frontend unchanged. Ships as native cross-platform app.

**Goal:** By v0.19.5, SAW is installable in one command on Mac/Windows/Linux with full OS integration.
