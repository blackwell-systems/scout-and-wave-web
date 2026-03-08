# Scout-and-Wave Roadmap

## Vision

**SAW is the only agent coordination framework that solves merge conflicts by design — parallel agents own disjoint files, branches merge cleanly, and humans review the plan before any code is written.**

Competitive positioning:
- Chief: simple loop, great DX, serial execution — one agent, one task
- Plan Cascade: parallel stories, rich desktop app, complex surface area, vague on merge safety
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

## Current Status (v0.19.0)

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
| Wave completes | `saw merge` in terminal | Merge button in WaveBoard | Pending |
| Merge succeeds | `go test` / `npm test` in terminal | Inline test runner | Pending |
| Want to see changes | Open IDE | File diff viewer | Pending |
| Scout/revise hung | Kill process in terminal | Cancel button | ✅ Shipped |
| Old worktrees pile up | `git branch -D` in terminal | Worktree manager | Pending |
| Want to configure SAW | Edit JSON | Settings screen | Pending |

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

**Why:** A blocked wave is currently a dead end in the UI — you see `status: blocked` with no path forward. Protocol v0.12.0 added `failure_type: transient | fixable | needs_replan | escalate` to completion reports. The UI can now offer the right action per failure type instead of leaving the user to figure it out.

**Scope:**
- WaveBoard failed agent cards: parse `failure_type` from completion report, show action button per type
  - `transient` → "Retry" button (POST `/api/wave/{slug}/agent/{letter}/rerun`)
  - `fixable` → "Fix + Retry" button — surfaces agent's free-form notes describing the fix, then re-runs
  - `needs_replan` → "Re-Scout" button — launches a new scout run with the agent's completion report as additional context
  - `escalate` → "Escalate" badge — no button, highlights for human attention
- If `failure_type` is absent from a `partial`/`blocked` report, treat as `escalate` (backward compat)
- Parse `failure_type` from the `impl-completion-report` typed block in IMPL doc

**Success criteria:**
- No blocked wave requires a terminal to resolve
- The correct recovery action is one click

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

OpenAI, LiteLLM, Ollama support via `--backend` flag. Auto-detection from env vars. Tool-use format translation layer.

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

**Next:** v0.17.0 — close the GUI loop. Merge button first (biggest impact), then test runner, diff viewer, worktree manager.

**After that:** v0.18.0 — deepen the intelligence. Scout context, chat-with-Claude, settings screen.

**Then:** v0.19.5 — Wails desktop app. Engine extraction is done — import `scout-and-wave-go`, replace HTTP + SSE with Wails bindings and events, React frontend carries over unchanged. Ships as a native cross-platform app.

**Goal:** By v0.19.5, SAW is installable in one command on Mac, Windows, and Linux with no server to run and full OS integration.
