# Scout-and-Wave Roadmap

## Vision

**SAW is the only agent coordination framework that solves merge conflicts AND works with any LLM provider.**

Competitive positioning:
- Everyone else: flashy UIs, single provider, merge chaos
- SAW: solid foundations (protocol-driven coordination), provider-agnostic, polished UI

## Core Differentiators

1. **Protocol-first design** - merge-conflict-free parallel execution via disjoint file ownership
2. **Provider-agnostic** - works with Claude, GPT-4, Gemini, local models, or any LiteLLM-compatible API
3. **Production-grade UI** - sophisticated review interface showing suitability gates, dependency graphs, interface contracts
4. **Open Agent Protocol compliance** - conforms to agent skills specification for interoperability

---

## Current Status (v0.12.0)

### ✅ Completed
- Core protocol implementation (I1-I6 invariants, E1-E15 execution rules)
- Go orchestration engine (worktrees, merge, state machine)
- Basic web UI (review screen, wave board, SSE streaming)
- IMPL doc completion lifecycle (E15)
- shadcn/ui migration for consistent design system

### 🚧 In Progress
- **v0.15.4 Visual Execution Dashboard** (Phase B complete: Agent color coding)
  - ✅ Phase B: Agent color coding across UI (AgentCard, DependencyGraph, WaveStructure)
  - ⏳ Phase A: Git activity sidebar with branch lanes (pending)
  - ⏳ Phase C: Integration and polish (pending)

---

## Phase 1: Polish & Position (v0.13.0 - v0.15.0)

**Goal:** Create the demo that gets attention. Show SAW's sophistication is real, not just marketing.

### v0.13.0 - Live Agent Output Streaming ⚡ NON-OPTIONAL
**Why:** Without this, the WaveBoard shows "Running" and nothing else. Zero visibility into what agents are doing. This is not a polish item — it is a core usability requirement. Users cannot trust or debug a system they cannot observe.

**Scope:**
- Capture subprocess stdout/stderr from each agent process in `pkg/agent/backend/cli/client.go`
- Stream output lines to a per-agent SSE channel: `GET /api/wave/{slug}/agent/{letter}/output`
- Frontend: expandable output section in each AgentCard showing live scrolling text
- Auto-scroll to bottom; preserve last N lines (cap at 500 to avoid memory issues)
- Distinguish tool calls from text output (lines starting with known tool patterns get different styling)
- Output persists after agent completes so you can read what happened

**Success criteria:**
- You can watch an agent work in real time from the WaveBoard
- When an agent fails, you can scroll its output to see the error
- Feels like watching a terminal, not staring at a spinner

**Estimated effort:** 2-3 days

---

### v0.15.0 - Multi-Provider Backend Support
**Why:** Removes vendor lock-in, demonstrates infrastructure thinking, differentiates from Claude-only frameworks.

**Scope:**
- Extend `pkg/agent/backend/` interface to be truly provider-agnostic
- Add OpenAI backend (`backend/openai/`) - GPT-4, o1 support
- Add LiteLLM backend (`backend/litellm/`) - universal adapter for 100+ providers
- Add local model support (`backend/local/`) - Ollama, llama.cpp
- Update `--backend` flag: `api|cli|openai|litellm|local|auto`
- Auto-detection: tries Anthropic API key → OpenAI key → LiteLLM config → local fallback
- Tool use format translation layer (each provider has different JSON schema)

**Technical challenges:**
- OpenAI tool calling uses `tools` array, not `tool_use` blocks
- Streaming response formats differ across providers
- Token limits vary (Claude: 200k, GPT-4: 128k, local: 8k-32k)
- Need graceful degradation for models without tool use (fallback to text parsing)

**Success criteria:**
- `saw scout --backend openai` works end-to-end
- `saw wave --backend litellm` executes agents via Gemini/Mistral/etc
- Documentation shows 3+ provider examples
- Demo video shows same IMPL doc executed with different backends

**Estimated effort:** 1 week
- OpenAI backend: 2 days (tool use translation, streaming)
- LiteLLM backend: 1 day (mostly config passthrough)
- Local backend: 2 days (needs special handling for context limits)
- Testing & docs: 2 days

---

### v0.14.0 - Live Agent Observability (merged into v0.13.0 — see above)
**Why:** Operators can't see what agents are doing during execution. The review UI is plan-only — no live feedback loop.

**Scope:**
- **Completion reports panel** — render `### Agent X - Completion Report` sections as they appear in the IMPL doc (parser already extracts these)
- **Live agent output stream** — SSE endpoint (`/api/sse/wave/{slug}`) streams agent stdout/stderr in real time during wave execution
- **Git activity feed** — poll worktree branches for new commits, show per-agent commit timeline with diffs
- **Wave progress indicators** — update wave structure timeline nodes (pending → running → complete/failed) in real time via SSE

**Technical notes:**
- SSE already used for wave board updates — extend to per-agent granularity
- Agent output requires capturing subprocess stdout/stderr and forwarding to SSE channel
- Git polling: check `git log --oneline` on each worktree branch every 5s, deduplicate
- Consider WebSocket upgrade path if SSE uni-directional limitation becomes a bottleneck (e.g., user wants to cancel/restart agents from UI)

**Success criteria:**
- Operator can watch agents work in real time from the review UI
- Completion reports render as agents finish (no page refresh)
- Git commits visible within 5s of agent committing

**Estimated effort:** 4-5 days

---

### v0.15.0 - UI Polish Pass
**Why:** First impressions matter. The UI should feel like a product, not a prototype.

**Scope:**
- Review screen performance optimization (lazy-load panels, virtualized lists for large IMPL docs)
- Wave board live updates polish (smooth transitions, better error states)
- Stale worktree cleanup button — detect leftover `wave{N}-agent-{X}` branches before run, offer one-click cleanup in UI
- Empty states for all panels ("No agents yet", "No known issues")
- Loading skeletons for API calls
- Keyboard shortcuts (tab navigation, approve with Cmd+Enter)
- Mobile-responsive layout (current UI only tested on desktop)
- Dark mode refinements (check all panels, ensure shadcn components look good)
- Accessibility audit (ARIA labels, keyboard navigation, screen reader support)

**Success criteria:**
- Feels as polished as Linear/Vercel/Stripe
- No obvious UI bugs or glitches
- Works on mobile Safari

**Estimated effort:** 3-4 days

---

### v0.15.0 - Demo & Documentation
**Why:** Great product is useless if nobody understands it.

**Scope:**
- **Demo video (2-3 minutes):**
  - Problem: "Everyone's building agent frameworks, but they break on merge conflicts"
  - Solution: "SAW coordinates agents with protocol-driven isolation"
  - Demo: Scout → Review (show 9 panels) → Approve → Wave board (parallel execution) → Clean merge
  - Differentiator: "Works with any LLM - watch the same IMPL doc execute with Claude, GPT-4, and Gemini"
- **Documentation overhaul:**
  - Landing page: clearer value prop, animated demo
  - Quickstart: 5 minutes from install to first wave
  - Architecture deep-dive: protocol explanation, why it works
  - Multi-provider guide: when to use which backend
  - Troubleshooting: common issues, debugging tips
- **Sample IMPL docs:**
  - 3-5 realistic examples across different project types
  - Show suitability gate rejections (not everything is suitable)
  - Show complex dependency graphs

**Success criteria:**
- Someone can understand SAW in 3 minutes (video)
- Someone can run SAW in 5 minutes (quickstart)
- Hacker News/Twitter demo is ready

**Estimated effort:** 1 week
- Video: 2 days (scripting, recording, editing)
- Docs: 3 days (writing, diagrams, examples)
- Samples: 2 days (creating, testing)

---

### v0.15.1 - Configuration & Agent Phase Tuning
**Why:** SAW uses hardcoded settings for all orchestrator phases. Scout and wave agents get the same model/config, wasting cost on simple tasks and under-provisioning complex planning. No user control without code changes.

**Scope:**
- **`saw.config.json` schema** — per-phase agent configuration (scout, wave, scaffold, retry, verify)
  - Model selection (`claude-opus-4-6`, `claude-sonnet-4-6`, etc.)
  - Backend selection (`api`, `cli`, `auto`)
  - Token limits, temperature, system prompt suffixes
- **Quality gates configuration** — typecheck, test, lint with auto-detection
  - Auto-detect project type from `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`
  - Run appropriate tools: `tsc --noEmit`, `pytest`, `cargo test`, `npm test`, `go test ./...`
  - Configurable as `required` (blocks merge) or `enabled` (warning only)
- **Config parser** — `pkg/config/config.go` parses JSON, merges with built-in defaults
- **Orchestrator integration** — select agent config based on phase
- **Fallback behavior** — if no config file, use current hardcoded defaults (opt-in, not breaking)

**Benefits:**
- **Cost optimization** — Scout uses Opus ($15/1M), waves use Sonnet ($3/1M)
- **Quality optimization** — Scout gets extended thinking budget, waves don't need it
- **Retry diversity** — Failed attempts get modified prompts ("you are fixing a failed attempt...")
- **User control** — Power users can tune without forking

**Success criteria:**
- Scout runs with Opus, waves with Sonnet (50%+ cost reduction)
- Retry prompts differ from initial attempts (measurable via logs)
- Quality gates surface type errors before human review

**Estimated effort:** 3-4 days
- Config schema + parser: 1 day
- Orchestrator integration: 1 day
- Quality gates auto-detection: 1 day
- Testing & docs: 1 day

---

### v0.15.2 - Framework Skills Auto-Injection
**Why:** Agents violate framework conventions (React hooks, Rust ownership, Go idioms) because they lack framework-specific context. Users must manually add "follow React best practices" to every request.

**Scope:**
- **Auto-detection logic** — `pkg/skills/detect.go` scans project files
  - `package.json` + "react" → `react-best-practices`
  - `Cargo.toml` → `rust-ownership`, `rust-error-handling`
  - `go.mod` → `go-idioms`, `go-error-handling`
  - `pyproject.toml` + "fastapi" → `fastapi-patterns`
- **Skill loader** — `pkg/skills/loader.go` reads `.md` files from `../scout-and-wave/skills/`
- **Prompt injection** — append skill content to Scout and wave agent system prompts
- **Configuration** — `saw.config.json` allows disabling auto-detect or adding custom skills

**Skill files (stored in protocol repo):**
```
scout-and-wave/skills/
  react-best-practices.md
  rust-ownership.md
  go-idioms.md
  python-type-hints.md
  fastapi-patterns.md
```

**Benefits:**
- Zero configuration — works automatically
- Better code quality — agents follow framework conventions
- Consistent style — all agents get same guidance
- Extensible — users can add custom team patterns

**Success criteria:**
- React project auto-injects hooks rules (detectable in agent prompts)
- Rust project auto-injects ownership patterns
- Custom skills work via config override

**Estimated effort:** 2-3 days
- Detection logic: 1 day
- Loader + injection: 1 day
- Testing & docs: 1 day

---

### v0.15.3 - Web UI Settings Panel
**Why:** Configuration via JSON editing intimidates non-technical users. The UI should expose settings visually with validation and immediate feedback.

**Scope:**
- **Settings screen** — new route `/settings` with sections:
  - Agent Configuration (per-phase model/backend/tokens)
  - Quality Gates (typecheck/test/lint toggles + required checkbox)
  - Framework Skills (auto-detect toggle, detected frameworks display, skills directory path)
- **API endpoints:**
  - `GET /api/config` — load current config + detected context (frameworks, skills, project type)
  - `POST /api/config` — save config with validation
  - `POST /api/config/reset` — reset to defaults
  - `GET /api/config/validate` — validate before save
- **Frontend components:**
  - `SettingsScreen.tsx` — main container
  - `AgentConfigSection.tsx` — per-phase cards with dropdowns
  - `QualityGatesSection.tsx` — checkbox + dropdown + "required" toggle
  - `FrameworkSkillsSection.tsx` — auto-detect toggle + read-only detected list
- **Hot reload** — config changes apply without server restart

**Benefits:**
- Accessible — non-developers can tune settings
- Validated — invalid inputs rejected before save
- Transparent — users see detected frameworks/skills
- Discoverable — reveals configuration options users didn't know existed

**Success criteria:**
- Settings UI feels as polished as Vercel/Linear settings
- Config changes apply without restart
- Validation errors shown inline (red text under invalid fields)

**Estimated effort:** 4-5 days
- API endpoints + validation: 1 day
- Settings UI components: 2 days
- Hot reload implementation: 1 day
- Testing & polish: 1 day

---

### v0.15.4 - Visual Execution Dashboard
**Why:** SAW's demo shows static diagrams (dependency graph, wave timeline) but doesn't visually convey *live parallel execution*. When compared to Maestro (which shows 4 terminals working simultaneously with git commits appearing in real-time), SAW feels less dynamic. Visual impact = attention = users.

**Problem:** Current WaveBoard only shows:
- Agent status badges (pending/running/complete) - boring
- File lists (static text)
- Error messages (only on failure)

No visual proof that agents are working in parallel. No git activity. No live output. The demo doesn't *show* the power of parallel execution—it just tells you about it.

**Proposed:** Transform WaveBoard into a visually compelling execution dashboard that proves parallel work is happening.

**Core Components:**

**1. Git Activity Sidebar**

Animated branch visualization showing real-time commits and merge order:

```
Main ━━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━●━━━━━
                                  ↑         ↑
Agent A (blue)   ●━━●━━●━━●━━━━━━┘         │
                 └── 4 commits             │
                                           │
Agent B (green)  ●━━━●━━●━━●━━━━━━━━━━━━━━┘
                 └── 3 commits
                 └── Merging... ⏳

Agent C (orange) ●━━●━━━━●━━━━━━━━━━━━━━━━●
                 └── 3 commits             ⚙️ running
                 └── "Update API types"

Agent D (purple) ●
                 └── waiting for merge gate...
```

**Implementation:**
- Horizontal lane per agent with SVG rendering
- Poll `git log --oneline wave1-agent-*` every 5s
- Commit dots appear in real-time as agents work
- Lines connect to main when merged
- Agent color coding (A=blue, B=green, C=orange, D=purple)
- Hover over commit → show message + files changed
- Click commit → modal with full diff

**Visual elements:**
- Lane background: subtle gradient matching agent color
- Commit dots: filled circles with agent color
- Active commits: pulsing animation
- Merge lines: bezier curves connecting branch to main
- Status icons: ⏳ (merging), ⚙️ (running), ✓ (complete), ✗ (failed)

**Benefits:**
- **Visual proof of parallelism** - See 4 branches with commits appearing simultaneously
- **Merge order transparency** - Visual representation of dependency-driven merge sequence
- **Demo appeal** - 10-second clip shows parallel work better than any text description

**2. Agent Color Coding**

Consistent color scheme across entire UI:

```
Agent A → Blue (#3b82f6)
Agent B → Green (#22c55e)
Agent C → Orange (#f97316)
Agent D → Purple (#a855f7)
Agent E → Pink (#ec4899)
Agent F → Cyan (#06b6d4)
... continues through K
```

**Apply colors to:**
- Agent cards (border + header background)
- Git activity lanes
- Dependency graph nodes
- Wave timeline dots
- Status badges

**Implementation:**
```tsx
// lib/agentColors.ts
export const getAgentColor = (agent: string): string => {
  const colors = {
    'A': '#3b82f6', 'B': '#22c55e', 'C': '#f97316', 'D': '#a855f7',
    'E': '#ec4899', 'F': '#06b6d4', 'G': '#f59e0b', 'H': '#8b5cf6',
    'I': '#10b981', 'J': '#ef4444', 'K': '#6366f1'
  }
  return colors[agent] || '#6b7280'
}

// Use everywhere:
<AgentCard agent="A" style={{ borderColor: getAgentColor('A') }} />
<BranchLane agent="B" color={getAgentColor('B')} />
<DagNode agent="C" fill={getAgentColor('C')} />
```

**Benefits:**
- **Visual continuity** - Same color across all views reinforces agent identity
- **Quick scanning** - "Blue branch merged" matches "Agent A card turned green"
- **Professional polish** - Consistent design language

**3. Live Output Stream (Optional)**

Stream agent stdout/stderr to UI in real-time:

```tsx
<AgentCard agent="A" status="running">
  <LiveOutput>
    <OutputLine type="stdout">Reading src/types.ts...</OutputLine>
    <OutputLine type="stdout">Analyzing PreMortem structure...</OutputLine>
    <OutputLine type="tool">Tool: Read(file_path="src/types.ts")</OutputLine>
    <OutputLine type="stdout">Writing PreMortem type definition...</OutputLine>
    <OutputLine type="tool">Tool: Write(file_path="src/types.ts", ...)</OutputLine>
  </LiveOutput>
</AgentCard>
```

**Implementation:**
- Capture subprocess stdout/stderr when running agents
- Stream to SSE endpoint `/api/wave/{slug}/agent/{agent}/output`
- Frontend subscribes per agent, displays in expandable section
- Auto-scroll to bottom, syntax highlighting for tool calls
- Collapsible (default: collapsed, expand to see detail)

**Benefits:**
- **Transparency** - Users can see exactly what agents are thinking/doing
- **Debugging** - When agent fails, scroll back through its output
- **Trust building** - Watching the agent work builds confidence in the system

**Technical considerations:**
- Output can be verbose (10k+ lines) - virtualized scrolling required
- Needs filtering (show only tool calls, hide LLM thinking)
- Privacy: some users may not want to see LLM reasoning tokens

**Deferred to later:** This adds complexity (subprocess piping, SSE per-agent channels, virtualized rendering). Git activity + color coding delivers 80% of visual impact for 40% of effort. Add output streaming only if users request it.

---

**Success Criteria:**

**For demo recording:**
- Can show 4 agents starting simultaneously
- Git lanes show commits appearing in parallel
- Merge order visually follows dependency graph
- Entire execution visible in one screen (no scrolling)
- Color-coded consistently throughout UI

**For user understanding:**
- First-time user can watch WaveBoard and understand:
  - Agents are working in parallel (git lanes prove it)
  - Merge order follows dependencies (visual connection clear)
  - No conflicts occurred (clean merge lines)

**For shareability:**
- 10-second screen recording demonstrates parallel execution
- Twitter/HN viewers immediately understand the value
- Looks as polished as Maestro/Linear/Vercel

---

**Implementation Plan:**

**Phase A: Git Activity Visualization (2-3 days)**
```
Day 1:
- `pkg/git/activity.go` - poll git log, parse commits
- `pkg/api/git.go` - SSE endpoint streaming git activity
- Data structures: Commit, Branch, Activity

Day 2:
- `web/src/components/git/GitActivitySidebar.tsx` - branch lanes SVG
- `web/src/components/git/BranchLane.tsx` - single lane with commits
- `web/src/components/git/CommitDot.tsx` - animated commit marker

Day 3:
- Merge animations (bezier curves connecting to main)
- Hover tooltips (commit message + files)
- Click handler (show diff modal)
- Polish: timing, colors, smoothness
```

**Phase B: Agent Color Coding (1 day)**
```
- `web/src/lib/agentColors.ts` - color mapping
- Update AgentCard borders + headers
- Update GitActivitySidebar lane colors
- Update DependencyGraphPanel node fills
- Update WaveStructurePanel dot colors
- Ensure consistent across light/dark themes
```

**Phase C: Integration (0.5 day)**
```
- Add GitActivitySidebar to WaveBoard layout
- Position: right side, 30% width, resizable
- Connect SSE git activity stream
- Test with 4+ agents running
```

**Total Effort:** 3.5-4 days

---

**Layout Change:**

**Before (current WaveBoard):**
```
┌─────────────────────────────────────────────┐
│ Wave Board: demo-complex                    │
├─────────────────────────────────────────────┤
│                                             │
│  [Agent A Card] [Agent B Card]              │
│  [Agent C Card] [Agent D Card]              │
│                                             │
│  ... more agents below ...                  │
│                                             │
└─────────────────────────────────────────────┘
```

**After (with git activity):**
```
┌────────────────────────┬────────────────────┐
│ Wave Board             │ Git Activity       │
├────────────────────────┤                    │
│ [Agent A Card]         │ main ━━━●━━━●━━━  │
│  Status: Complete ✓    │        ↑     ↑    │
│  Files: types.go       │ A ●━●━●┘     │    │
│  Commits: 4            │              │    │
│                        │ B ●━━●━━━━━━━┘    │
│ [Agent B Card]         │                    │
│  Status: Merging... ⏳  │ C ●━●━━━●━━━━●    │
│  Files: parser.go      │   ⚙️ running       │
│  Commits: 3            │                    │
│                        │ D ●                │
│ [Agent C Card]         │   waiting...       │
│  Status: Running ⚙️     │                    │
│  Files: api.go         │                    │
│  Commits: 3            │                    │
│                        │                    │
│ [Agent D Card]         │                    │
│  Status: Pending       │                    │
│                        │                    │
└────────────────────────┴────────────────────┘
```

**Alternative layout:** Git activity as a horizontal banner above agent cards (takes less width, more mobile-friendly).

---

**After This:**

Your demo becomes:

> "Scout analyzed the codebase—here's the IMPL doc with dependency graph [show ReviewScreen]. Approve. Watch 4 agents start [show WaveBoard]. See the git activity? Four branches working simultaneously. Commits appearing in real-time. Agent A finished—see it merge to main [point to merge animation]. Agent B finished—merged. Agent C—merged. Agent D—merged. All parallel, zero conflicts. That's Scout-and-Wave."

**That's a demo that gets shared.**

---

## Phase 2: Ecosystem & Integration (v0.16.0+)

### v0.16.0 - MCP Server Implementation
**Why:** Make SAW orchestratable by AI agents. Claude Code (or any MCP client) can coordinate SAW runs.

**Scope:**
- MCP server at `mcp-server-saw` package
- Tools: `saw_scout`, `saw_wave`, `saw_status`, `saw_approve`, `saw_reject`
- Resources: IMPL docs, wave status, completion reports
- Prompts: "Review this IMPL doc", "Execute Wave 1"
- Integration with Claude Code: user asks "build a caching layer", Claude runs `saw scout`, shows review, asks for approval, runs `saw wave`

**Success criteria:**
- Claude Code can orchestrate a full SAW workflow
- AI can review IMPL docs and ask clarifying questions
- "AI pair programming with merge-free agent execution"

**Estimated effort:** 1 week

---

### v0.17.0 - VS Code Extension
**Why:** Developers live in their editor. Bring SAW review to where they work.

**Scope:**
- Sidebar panel showing IMPL doc review (same 9 panels as web UI)
- Status bar showing wave progress
- Inline approve/reject buttons
- Notifications when agents complete
- Quick actions: "Scout this feature", "Run next wave"

**Success criteria:**
- Never leave VS Code during SAW workflow
- Inline IMPL doc review with file navigation
- Better than opening browser

**Estimated effort:** 2 weeks

---

### v0.18.0 - GitHub Integration
**Why:** Teams want to review IMPL docs in PRs, not locally.

**Scope:**
- GitHub App that comments IMPL doc review on PRs
- `saw-bot` posts file ownership table, wave structure as PR comment
- Approval workflow: team reviews IMPL in GitHub, then merges triggers wave execution
- Wave results posted back to PR (which agents completed, test results)

**Success criteria:**
- IMPL review happens in GitHub PR
- Team can approve/reject without running SAW locally
- CI/CD integration for automated wave execution

**Estimated effort:** 2 weeks

---

## Phase 3: Scale & Enterprise (v1.0.0+)

### v1.0.0 - Production Hardening
- Observability: OpenTelemetry, structured logging, metrics
- Error recovery: automatic retry, partial wave restart
- Cost tracking: per-agent token usage, cost attribution
- Security: credential isolation, sandbox execution
- Performance: concurrent wave execution, agent queueing

### v1.1.0 - Team Features
- Multi-user review: IMPL doc approval requires 2+ reviewers
- Role-based access: who can approve, who can execute
- Audit log: all IMPL reviews, wave executions, outcomes
- Template library: reusable IMPL patterns for common features

### v1.2.0 - Enterprise
- Self-hosted deployment
- SAML/SSO authentication
- Organization-level configuration
- Private model support (on-prem LLMs)
- SLA monitoring & alerting

---

## Stretch Goals

### Agent Marketplace
- Publish custom agent prompts (specialized agents for specific tasks)
- Community-contributed IMPL templates
- Agent performance leaderboard (success rate by task type)

### Visual IMPL Builder
- Drag-and-drop interface for defining waves
- Visual dependency graph editor
- AI-assisted agent prompt generation

### Multi-Repo Coordination
- SAW orchestrates across multiple repositories
- Cross-repo interface contracts
- Monorepo support with isolated wave execution per package

---

## Current Focus

**Next 2 weeks:** Complete sidebar feature (Wave 1 in progress), ship v0.13.0 with multi-provider support.

**Next 1 month:** UI polish (v0.14.0), demo video + docs (v0.15.0), launch on Hacker News.

**Next 3 months:** MCP server (v0.16.0), VS Code extension (v0.17.0), position SAW as infrastructure layer for AI agent coordination.
