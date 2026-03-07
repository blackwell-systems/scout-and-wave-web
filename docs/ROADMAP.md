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
- **Wave 1 Active:** Review sidebar with 9-panel tabbed interface
  - Agent A: Parser extensions (5 new IMPL sections)
  - Agent B: API layer (6 new response fields)
  - Agent C: TypeScript types
  - Agent D: ReviewScreen refactor with shadcn Tabs

---

## Phase 1: Polish & Position (v0.13.0 - v0.15.0)

**Goal:** Create the demo that gets attention. Show SAW's sophistication is real, not just marketing.

### v0.13.0 - Multi-Provider Backend Support
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

### v0.14.0 - Live Agent Observability
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
