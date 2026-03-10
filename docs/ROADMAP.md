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

## Current Status (v0.35.0)

**Protocol & engine** — Core protocol (I1–I6 invariants, E1–E23 execution rules), Go orchestration engine, E16 validator, scaffold build verification (E22), per-agent context extraction (E23), engine extraction complete (`scout-and-wave-go` standalone module), cross-repo wave support, single-agent rerun (`RunSingleAgent`), unified tool system (`pkg/tools` Workshop — 7 tools, backend adapters, middleware support).

**Web UI** — 3-column layout, Scout launcher, ReviewScreen (15+ panels), WaveBoard (failure-type action buttons, notes callout, scope-hint reruns), RevisePanel, GitActivity, CommandPalette, Settings, ThemePicker, SVG dep graph, wave gate, cancellation, desktop notifications, ManifestValidation panel.

**Streaming** — PTY + `--output-format stream-json` pipeline, JSON fragment reassembly, SSE broker (2048-channel).

**API** — 30 routes covering scout (+ rerun), wave, single-agent rerun, merge, test, diff, worktree, chat, config, context, scaffold rerun, manifest validate/load/wave/completion.

See CHANGELOG.md for full version history.

---

## Phase 1: Close the GUI Loop (v0.17.0)

**Goal:** You should never need a terminal. Everything from feature description to merged, tested code happens in the SAW GUI.

### Remaining gaps

| Trigger | Current workaround | Fix |
|---|---|---|
| Want to see changes | Open IDE | File diff viewer |
| Old worktrees pile up | `git branch -D` in terminal | Worktree manager |

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

### v0.18.0-D — Failure Type Action Buttons *(shipped v0.35.0)*

**Shipped.** WaveBoard renders per-failure-type action buttons (transient→Retry, fixable→Fix+Retry with notes callout, needs_replan→Re-Scout, escalate→badge with notes, timeout→Retry with scope-hint). Backend: `handleWaveAgentRerun` calls `engine.RunSingleAgent` for true single-agent reruns; `POST /api/scout/{slug}/rerun` endpoint added. Notes field added to `CompletionReport` (Go) and `AgentStatus`/`AgentFailedData` (TypeScript), threaded through SSE.

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
- Settings screen exposes default gate config; per-IMPL gates override

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

**Dependency:** Requires the protocol "Full Research Output on NOT SUITABLE Verdicts" change to Scout to be useful. UI can be built now as a no-op fallback.

**Success criteria:**
- NOT SUITABLE is not a dead end — it's a map of why and what to do next
- All research panels populate even when the verdict is negative

---

### v0.18.0-I — Scaffold Build Failure Detail *(API done v0.33.0; UI pending)*

**Why:** Protocol E22 (v0.13.0) requires the Scaffold Agent to run `go build ./...` (or equivalent) and report `status: FAILED` with build error output if it fails. Currently this surfaces as a generic BLOCKED state with no detail.

**Scope (remaining — UI only):**
- ReviewScreen/WaveBoard: detect SCAFFOLD_PENDING → BLOCKED transition from scaffold status field in IMPL doc Scaffolds section
- When scaffold status contains `FAILED:`, show build error output in a syntax-highlighted code block (streaming via existing SSE if build is still running; static if already failed)
- "Revise Interface Contracts" button opens the IMPL doc editor (RevisePanel) pre-focused on the Interface Contracts section
- Clear "why this failed" explanation: "The Scaffold Agent could not compile the interface definitions. Fix the contracts above and re-run."

**Success criteria:**
- Build failure output visible in UI within 2 seconds of scaffold reporting FAILED
- User can identify and fix the failing interface contract without leaving SAW

---

### v0.18.0-J — Pre-Wave Quality Gates Preview

**Why:** v0.18.0-F shows quality gate *results* after wave completion. But Scout writes the `## Quality Gates` section at planning time — the gates are configured before any agent launches. Surfacing them during review gives the user a chance to adjust gate configuration before approving.

**Scope:**
- ReviewScreen: parse `## Quality Gates` section from IMPL doc during the pre-wave review step
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

### v0.18.0-K — Large IMPL Doc Scalability

**Why:** Phase 1+2 together produce 14-agent IMPL docs. Every Wave agent launched receives the full doc as context — token waste that scales O(N²) with agent count.

**Scope:**
- `GET /api/impl/{slug}/agent/{letter}/context` — serve the trimmed per-agent context payload: that agent's prompt section + interface contracts + file ownership table + scaffolds + quality gates. Used by the orchestrator at launch time.
- Wave launch path: pass per-agent context payload instead of full IMPL doc when invoking Wave agents via `/api/wave/{slug}/start`
- ReviewScreen: "Agent Context" toggle on each agent card — shows the trimmed payload that agent received at launch (debugging: "why did agent B miss the contract?")
- Lazy-load IMPL doc sections in ReviewScreen: fetch and parse only the active panel, not the full doc on every view switch

**Success criteria:**
- 14-agent IMPL doc launches with the same per-agent context size as a 5-agent one
- ReviewScreen initial load stays under 1 second regardless of IMPL doc length

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

## Stretch Goals

- **Visual IMPL Builder** — drag-and-drop wave/agent definition, visual dep graph editor
- **Agent Marketplace** — publish custom agent prompts, community IMPL templates

---

## Current Focus

**Next:** Finish Phase 1
- v0.17.0-D — **Worktree manager** (clean up stale branches in GUI)

**Then:** Phase 2 intelligence features
- ~~v0.18.0-D — Failure type action buttons~~ *(shipped v0.35.0)*
- v0.18.0-I — Scaffold build failure detail (UI only — API shipped v0.33.0)
- v0.18.0-G — CONTEXT.md viewer
- v0.18.0-H — NOT SUITABLE full research view
- v0.18.0-K — Large IMPL doc scalability

**Then:** v0.19.5 — Wails desktop app. Engine extraction complete — import `scout-and-wave-go`, replace HTTP/SSE with Wails bindings, React frontend unchanged. Ships as native cross-platform app.

**Goal:** By v0.19.5, SAW is installable in one command on Mac/Windows/Linux with full OS integration.
