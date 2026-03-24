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

## Current Status (v0.53.0+)

**Protocol & engine** — Core protocol (I1–I6 invariants, E1–E23 execution rules), Go orchestration engine, E16 validator, scaffold build verification (E22), per-agent context extraction (E23), engine extraction complete (`scout-and-wave-go` standalone module), cross-repo wave support, single-agent rerun (`RunSingleAgent`), unified tool system (`pkg/tools` Workshop — 7 tools, backend adapters, middleware support), markdown system fully removed (YAML-only manifests), base commit tracking for post-merge verification, duplicate completion report detection.

**Web UI** — 3-column layout, Scout launcher, ReviewScreen (15+ panels), WaveBoard (failure-type action buttons, notes callout, scope-hint reruns), RevisePanel, GitActivity, CommandPalette, Settings, ThemePicker, SVG dep graph (animated during execution — pulsing/complete/failed node states, edge animations), wave gate, cancellation, desktop notifications, ManifestValidation panel, WorktreePanel (modal overlay with batch delete), QualityGatesPanel (required/optional display with command table), per-agent context toggle in ReviewScreen, timeout failure type with distinct badge and rerun action.

**Streaming** — PTY + `--output-format stream-json` pipeline, JSON fragment reassembly, SSE broker (2048-channel).

**API** — 30+ routes covering scout (+ rerun), wave, single-agent rerun, merge, test, diff, worktree (+ cleanup), chat, config, context, scaffold rerun, manifest validate/load/wave/completion, per-agent context extraction. All endpoints YAML-only (markdown format removed v0.53.0).

See CHANGELOG.md for full version history.

---

## Phase 2: Deepen the Intelligence (v0.18.0+)

### v0.18.0-A — Verification Loop UI (Auto-Retry Visualization)

**Why:** Engine v0.30.0 adds E24 verification loop with automatic retry on quality gate failures. The UI needs to show retry chains and failure context.

**Scope:**
- IMPL list: show retry chain hierarchy (e.g., "Feature X → Fix Wave 1 → Fix Wave 2")
- ReviewScreen: "Retry Context" panel when viewing a fix-wave IMPL doc
  - Shows parent IMPL doc link, original quality gate failure output, safe point SHA
  - "View Original Feature" button jumps to parent IMPL
- WaveBoard: distinguish fix waves visually (orange badge: "Fix Wave 1/2")
- After 2 retries, show escalation state: "Manual intervention required"

**Success criteria:**
- User sees full retry history without reading raw IMPL docs
- Clear path from fix wave back to original feature

---

### v0.18.0-B — Enhanced Agent Progress Indicators

**Why:** Engine v0.34.0 adds `agent_progress` SSE events with structured file/action tracking. Current WaveBoard shows agent status but not granular progress.

**Scope:**
- WaveBoard agent cards: show current file + action in real-time
  - Examples: "Writing: src/api/handlers.go", "Running: go build ./...", "Tool: Edit"
- Progress percentage: commits made / expected files (from file ownership table)
- Progress bar per agent (0-100% based on file count)
- Tooltip on hover: full command or tool call details

**Success criteria:**
- Wave execution is no longer a black box — see exactly what each agent is doing

---

### v0.18.0-C — Persistent Memory Viewer (remaining)

**Why:** Engine v0.33.0 adds persistent memory system (`docs/MEMORY.md`) with pattern/pitfall/preference learning. Basic view/edit exists via ContextViewerPanel — remaining work adds structured browsing and memory provenance.

**Scope:**
- Settings screen: "Project Memory" tab
  - Table view: Type | Content | Tags | Source Wave | Actions
  - Filter by type (pattern/pitfall/preference), search by tags
  - Edit/delete entries inline
- Scout execution panel: show "Memories Applied" count with expandable list
  - "3 memories applied to this Scout run" → expands to show which memories + relevance scores
- ReviewScreen: "Learned from this wave" callout after completion
  - Shows what new memories were extracted from completion reports

**Success criteria:**
- User sees which past learnings influenced the current Scout run
- Memory system is transparent and editable beyond raw text

---

### v0.18.0-D — Wave Timeout Status (remaining)

**Why:** Timeout failure type exists with distinct badge and rerun button. Remaining work adds richer timeout diagnostics and per-project configuration.

**Scope:**
- Completion report: "Agent timed out" section with:
  - Last known file being edited
  - Partial progress percentage
- Settings: configure default timeout per project (overridable per IMPL)

**Success criteria:**
- User can identify what agent was doing when timeout occurred
- Timeout duration is configurable without editing IMPL docs

---

### v0.18.0-J — Pre-Wave Quality Gates Preview (remaining)

**Why:** QualityGatesPanel shows gate configuration during review. Remaining work adds inline editing so users can adjust gates before approving.

**Scope:**
- "Edit Gates" inline: toggle required/optional per gate, add/remove gates — writes back via `PUT /api/impl/{slug}/raw`
- Panel collapses to a summary line when gates are default/standard: "3 gates configured (2 required)"

**Success criteria:**
- Gate configuration adjustable in one click without opening a text editor

---

### v0.18.0-K — Large IMPL Doc Scalability (remaining)

**Why:** Per-agent context API exists (`GET /api/impl/{slug}/agent/{letter}/context`) and AgentContextToggle shows trimmed payloads in ReviewScreen. Remaining work wires per-agent context into the wave launch path and adds lazy loading.

**Scope:**
- Wave launch path: pass per-agent context payload instead of full IMPL doc when invoking Wave agents via `/api/wave/{slug}/start`
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

**Now:** Phase 2 intelligence features (remaining items)
- v0.18.0-A — Verification loop / retry chain UI
- v0.18.0-B — Enhanced agent progress indicators (current file + action, progress bars)
- v0.18.0-C — Persistent memory viewer (structured table, memories applied count)
- v0.18.0-D — Wave timeout diagnostics (last known file, settings config)
- v0.18.0-J — Pre-wave quality gates editing (inline toggle required/optional)
- v0.18.0-K — Large IMPL scalability (per-agent context in wave launch, lazy-load panels)

**Then:** v0.19.5 — Wails desktop app. Engine extraction complete — import `scout-and-wave-go`, replace HTTP/SSE with Wails bindings, React frontend unchanged. Ships as native cross-platform app.

**Goal:** By v0.19.5, SAW is installable in one command on Mac/Windows/Linux with full OS integration.
