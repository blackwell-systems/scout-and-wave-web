# Scout-and-Wave Web

[![Blackwell Systems™](https://raw.githubusercontent.com/blackwell-systems/blackwell-docs-theme/main/badge-trademark.svg)](https://github.com/blackwell-systems)
[![CI](https://github.com/blackwell-systems/scout-and-wave-web/actions/workflows/ci.yml/badge.svg)](https://github.com/blackwell-systems/scout-and-wave-web/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.20.3-blue)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow.svg)](https://buymeacoffee.com/blackwellsystems)

**Web UI for the [Scout-and-Wave protocol](https://github.com/blackwell-systems/scout-and-wave)** — review IMPL docs, monitor live wave execution, and chat with Claude about your implementation plans.

## What is this?

Scout-and-Wave (SAW) coordinates multiple AI agents working in parallel on non-overlapping parts of a codebase. This repo provides the **`saw` binary** — the user-facing web UI + orchestration tool.

**Features:**
- **Interactive web UI** for reviewing IMPL docs (implementation plans) with visual dependency graphs, wave timelines, and file ownership tables
- **Live wave dashboard** with real-time agent status, streaming logs, and progress tracking
- **Chat interface** to ask Claude questions about IMPL docs with full conversation context
- **HTTP API** (42 endpoints) for programmatic access to SAW operations
- **CLI interface** (`./saw`) as an alternative to the web UI

The web server imports the [scout-and-wave-go](https://github.com/blackwell-systems/scout-and-wave-go) engine package for all SAW orchestration logic. The protocol specification lives in [scout-and-wave](https://github.com/blackwell-systems/scout-and-wave).

**Note:** There's also a separate `sawtools` CLI in scout-and-wave-go for protocol-level operations (CI/CD, power users). See [scout-and-wave-go/docs/binaries.md](https://github.com/blackwell-systems/scout-and-wave-go/blob/develop/docs/binaries.md) for when to use which binary.

## Quickstart

```bash
# Clone and build
git clone https://github.com/blackwell-systems/scout-and-wave-web.git
cd scout-and-wave-web
make build

# Start the web server
./saw serve
# Opens http://localhost:7432 in your browser
```

The web UI provides:

1. **IMPL Picker** — browse all IMPL docs in `docs/IMPL/`
2. **Review Screen** — suitability verdict, wave structure, dependency graph, file ownership, interface contracts, agent prompts
3. **Wave Dashboard** — live agent execution with per-agent status cards, streaming output, and error reporting
4. **Chat Panel** — ask Claude about the IMPL doc; conversations persist per-IMPL across sessions

## Prerequisites

- **Go 1.25+** — required by `go.mod`
- **Node.js 18+** — required for web UI build
- **git** — SAW creates/merges git worktrees during wave execution
- **`claude` CLI** *(optional)* — required only if using `--backend cli` (Claude Max plan, no API key); install from [claude.ai/code](https://claude.ai/code)
- **`ANTHROPIC_API_KEY`** *(optional)* — required only if using `--backend api`; default is `auto` (uses whichever is available)

## Installation

### From source

```bash
git clone https://github.com/blackwell-systems/scout-and-wave-web.git
cd scout-and-wave-web
make build
./saw --version
```

The `make build` target builds the React frontend (`web/`) and embeds it into the Go binary via `go:embed`. You can then copy `./saw` anywhere on your `$PATH`.

### Docker (coming soon)

```bash
docker pull blackwellsystems/scout-and-wave-web:latest
docker run -p 7432:7432 -v $(pwd):/workspace blackwellsystems/scout-and-wave-web
```

## Usage

### Web UI (primary interface)

```bash
# Start server and open browser
./saw serve

# Custom port and repo path
./saw serve --addr :8080 --repo /path/to/your/project

# Don't auto-open browser
./saw serve --no-browser
```

The web UI provides three main views:

#### 1. IMPL Picker (home)
- Grid of all IMPL docs in `docs/IMPL/`
- Shows status badge (pending/suitable/not-suitable), wave count, agent count
- Click any card to open the review screen

#### 2. Review Screen
- **Overview**: Suitability verdict, estimated complexity, wave count
- **Wave Structure**: Visual timeline showing which agents run in parallel
- **Dependency Graph**: Interactive SVG showing agent dependencies
- **File Ownership**: Table showing which agent owns which files (I1 enforcement)
- **Interface Contracts**: Shared type scaffolds created before wave execution (I2 enforcement)
- **Agent Prompts**: Full 9-field prompt each agent will receive
- **Action buttons**: Approve, Request Changes, Reject (workflow tracking)
- **Chat panel**: Ask Claude questions about the IMPL doc (resizable, history persists per-IMPL)

#### 3. Wave Dashboard
- Live view of wave execution progress
- Per-wave status cards with agent breakdown
- Streaming output from each agent as they work
- Error reporting and retry status
- Auto-refreshes via Server-Sent Events (SSE)

### CLI (alternative interface)

The binary also provides a CLI for scripting and CI/CD:

```bash
# Analyze codebase and generate IMPL doc
./saw scout --feature "add caching layer"

# Create scaffold files from IMPL doc
./saw scaffold --impl docs/IMPL/IMPL-caching.md

# Execute all waves automatically
./saw wave --impl docs/IMPL/IMPL-caching.md --auto

# Check status
./saw status --impl docs/IMPL/IMPL-caching.md
./saw status --impl docs/IMPL/IMPL-caching.md --json

# Manual merge (recovery)
./saw merge --impl docs/IMPL/IMPL-caching.md --wave 1
```

See [CLI Reference](docs/cli-reference.md) for full command reference.

## Web UI Features

### Chat with Claude about IMPL docs

Click "Ask Claude about this IMPL" in any review screen to open the chat panel. Features:

- **Full conversation context**: Each message includes all previous turns (like the Claude Code CLI)
- **Per-IMPL history**: Switch between IMPLs and return — conversations persist in memory
- **Markdown rendering**: Code blocks with syntax highlighting, proper paragraph spacing
- **Resizable panel**: Drag the divider to adjust chat width
- **Explanatory mode**: When using the CLI backend (no API key), Claude provides educational insights about SAW patterns

Example conversation:

```
You: What's the purpose of Agent B in Wave 2?
Claude: Agent B implements the cache invalidation layer...

★ Insight ─────────────────────────────────────
• Interface separation: Agent B depends on the CacheClient
  interface from Wave 1, not the concrete implementation
• Wave sequencing (I3): Agent B couldn't run until Wave 1
  committed the interface contract
─────────────────────────────────────────────────

You: Why can't Agent B run in Wave 1?
Claude: Agent B depends on the RateLimiter type that Agent A creates...
```

### Dark mode and themes

Click the theme icon in the top-right to cycle through:

- **Light** (default)
- **Dark** (standard dark mode)
- **Gruvbox Dark**
- **Darcula** (JetBrains IDE theme)
- **Catppuccin Mocha**
- **Nord**

Theme choice persists to `localStorage`.

### Dependency graph visualization

The dependency graph panel renders an interactive SVG:

- Nodes represent agents (color-coded by wave)
- Edges show dependencies (data flow from Wave N → Wave N+1)
- Hover to highlight connected nodes
- Auto-layout using hierarchical algorithm

### Live wave execution

When running `./saw wave --auto` (or via API), the Wave Dashboard streams live updates:

- Per-wave progress bars
- Per-agent status cards (pending → running → complete/failed)
- Streaming stdout/stderr from each agent
- Error messages and retry attempts
- Merge status and post-merge verification results

All updates arrive over SSE (`/api/wave/{slug}/events`), so no polling required.

## Architecture

```
scout-and-wave-web/
├── cmd/saw/              # CLI entry point (wraps pkg/api + pkg/engine calls)
├── pkg/
│   ├── api/             # HTTP server, SSE broker, REST endpoints
│   │   ├── server.go    # Main server with embedded web bundle
│   │   ├── chat_handler.go    # Chat SSE endpoint
│   │   └── wave_handler.go    # Wave execution SSE endpoint
│   └── protocol/        # IMPL doc parser (wraps scout-and-wave-go/pkg/protocol)
├── web/                 # React + TypeScript + Tailwind
│   ├── src/
│   │   ├── components/  # UI components (ReviewScreen, WaveBoard, ChatPanel)
│   │   ├── hooks/       # useChatWithClaude, useWaveEvents (SSE)
│   │   └── api.ts       # HTTP client (fetch wrappers)
│   └── dist/            # Built bundle (go:embed'ed into binary)
└── docs/IMPL/           # IMPL docs generated by `saw scout`
```

**Dependency chain**:
- `scout-and-wave-web` (this repo) → imports `scout-and-wave-go` (engine) → references `scout-and-wave` (protocol spec)

The engine repo (`scout-and-wave-go`) provides:
- `pkg/engine` — RunScout, RunChat, StartWave, MergeWave
- `pkg/agent` — Agent runner with tool-use loop
- `pkg/agent/backend` — Anthropic API client + Claude CLI shim
- `pkg/orchestrator` — 10-state machine
- `pkg/protocol` — IMPL doc parser

This repo (`scout-and-wave-web`) provides:
- Web UI (React)
- HTTP server with SSE streaming
- REST API for IMPL operations
- Chat endpoint with conversation context

## Development

### Prerequisites

```bash
go version  # 1.25+
node --version  # 18+
```

### Build the web UI

```bash
cd web
npm install
npm run build  # outputs to web/dist/
```

### Build the Go binary

```bash
go build -o saw ./cmd/saw
```

Or use the Makefile:

```bash
make build      # builds web + go
make dev        # builds and starts server with hot-reload
make test       # runs go tests
```

### Development workflow

**Frontend changes**:
```bash
cd web
npm run dev  # Vite dev server on port 5173 with hot-reload
```

The Vite dev server proxies API requests to `http://localhost:7432` (configure in `vite.config.ts`). Run `./saw serve` in another terminal to provide the backend.

**Backend changes**:
```bash
# Edit Go files
go build -o saw ./cmd/saw
pkill -f "saw serve"
./saw serve &>/tmp/saw-serve.log &
```

Or use the restart helper:
```bash
make restart  # kills server, rebuilds, restarts
```

**Full rebuild** (after frontend changes):
```bash
cd web && npm run build && cd .. && go build -o saw ./cmd/saw
```

The binary embeds `web/dist/` via `go:embed`, so you must rebuild the Go binary after every npm build for changes to appear.

### Logs

- **Server logs**: `/tmp/saw-serve.log` (configure with `--log-file`)
- **Chat sessions**: Logged with `[chat]` prefix (includes runID, slug, historyLen)
- **Wave execution**: Logged with `[wave]` prefix (includes waveNum, agent letters)

Example log output:
```
2026/03/08 21:38:43 [chat] Starting chat session: slug=demo-complex runID=1773031123005120000 message="explain Agent B" historyLen=2
2026/03/08 21:38:43 [chat] Launching RunChat: runID=1773031123005120000 implPath=/path/to/IMPL-demo-complex.md repoPath=/workspace historyLen=2
2026/03/08 21:39:14 [chat] Streaming chunk #1: runID=1773031123005120000 len=40
2026/03/08 21:39:14 [chat] Agent completed successfully: runID=1773031123005120000 totalChunks=12
```

## Documentation

- **[CLI Reference](docs/cli-reference.md)** — Complete command-line interface documentation for all 18 commands
- **[API Reference](docs/api-reference.md)** — HTTP endpoint documentation for all 42 REST/SSE endpoints
- **[Configuration Reference](docs/configuration.md)** — `saw.config.json` structure and settings

### Quick CLI Examples

```bash
# Generate IMPL doc
./saw scout --feature "add OAuth support"

# Create interface scaffolds
./saw scaffold --impl docs/IMPL/IMPL-oauth.yaml

# Execute waves
./saw wave --impl docs/IMPL/IMPL-oauth.yaml --auto

# Check status
./saw status --impl docs/IMPL/IMPL-oauth.yaml

# Start web server
./saw serve
```

### Quick API Examples

```bash
# List all IMPL docs
curl http://localhost:7432/api/impl

# Get IMPL details
curl http://localhost:7432/api/impl/oauth

# Start wave execution
curl -X POST http://localhost:7432/api/wave/oauth/start \
  -H "Content-Type: application/json" \
  -d '{"wave_num": 1, "auto": true}'

# Stream wave events (SSE)
curl -N http://localhost:7432/api/wave/oauth/events
```

## Protocol Compliance

Implements [SAW Protocol v0.14.5](https://github.com/blackwell-systems/scout-and-wave):

| Invariant | Enforcement |
|-----------|-------------|
| **I1** | Disjoint file ownership — file ownership table parsed pre-merge; any overlap fails validation |
| **I2** | Interface contracts precede execution — scaffold files committed before worktree creation |
| **I3** | Wave sequencing — Wave N+1 blocked until Wave N merged + post-merge verification passes |
| **I4** | IMPL doc is single source of truth — all status, completion reports, and decisions written to IMPL doc |
| **I5** | Agents commit before reporting — merge procedure checks for commits; missing commits trigger BLOCKED |
| **I6** | Role separation — orchestrator delegates to Scout/Wave agents via `engine.RunScout`/`engine.StartWave` |

**10-state machine**:

```
ScoutPending → Reviewed → ScaffoldPending → WavePending → WaveExecuting
                                                 ↑              ↓
                                            WaveVerified ← WaveMerging
                                                 ↓
                                             Complete
```

Terminal states: `NotSuitable`, `Complete`. Recovery state: `Blocked`.

See [protocol/state-machine.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/state-machine.md) for transition logic.

## Troubleshooting

### "IMPL doc validation failed"

```bash
# Run the validator manually
bash ~/.claude/skills/saw/scripts/validate-impl.sh docs/IMPL/IMPL-feature.md
```

Common issues:
- Missing required typed blocks (`impl-wave-structure`, `impl-file-ownership`, `impl-dep-graph`)
- Wave headers without agent sections
- Malformed file ownership table (missing columns)

### "Agent stuck on pending"

Check logs:
```bash
tail -f /tmp/saw-serve.log | grep "\[wave\]"
```

Common causes:
- Claude CLI not in `$PATH` (if using `--backend cli`)
- `ANTHROPIC_API_KEY` not set (if using `--backend api`)
- Worktree creation failed (check git status)

### "Chat stuck on thinking..."

1. Check if Claude process launched:
```bash
pgrep -f "claude.*chat"
```

2. Check logs for errors:
```bash
tail -20 /tmp/saw-serve.log | grep "\[chat\]"
```

3. Restart server:
```bash
pkill -f "saw serve"
./saw serve &>/tmp/saw-serve.log &
```

### "Merge conflict detected"

This means I1 was violated (overlapping file ownership). Check the file ownership table in the IMPL doc:

```bash
./saw status --impl docs/IMPL/IMPL-feature.md --missing
```

If two agents claim the same file, edit the IMPL doc to reassign ownership, then re-run the wave.

## License

MIT

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Links

- **Protocol spec**: [scout-and-wave](https://github.com/blackwell-systems/scout-and-wave)
- **Go engine**: [scout-and-wave-go](https://github.com/blackwell-systems/scout-and-wave-go)
- **Buy me a coffee**: [buymeacoffee.com/blackwellsystems](https://buymeacoffee.com/blackwellsystems)
