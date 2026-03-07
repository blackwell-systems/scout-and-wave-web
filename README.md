# scout-and-wave-go

Go implementation of the [Scout-and-Wave protocol](https://github.com/blackwell-systems/scout-and-wave) for parallel agent coordination.

## Overview

SAW coordinates multiple AI agents working in parallel on non-overlapping parts of a codebase. Each agent gets an isolated git worktree; the orchestrator merges, verifies, and sequences waves automatically.

## Installation

```bash
go install github.com/blackwell-systems/scout-and-wave-go/cmd/saw@latest
```

## Usage

```bash
# Analyze a codebase and produce an IMPL doc
saw scout --feature "add OAuth support"

# Create shared type scaffold files from an IMPL doc
saw scaffold --impl docs/IMPL/IMPL-oauth.md

# Execute all waves automatically (no prompts)
saw wave --impl docs/IMPL/IMPL-oauth.md --auto

# Execute from a specific wave number
saw wave --impl docs/IMPL/IMPL-oauth.md --wave 2 --auto

# Merge a single wave manually (recovery)
saw merge --impl docs/IMPL/IMPL-oauth.md --wave 1

# Check wave/agent status
saw status --impl docs/IMPL/IMPL-oauth.md
saw status --impl docs/IMPL/IMPL-oauth.md --json
saw status --impl docs/IMPL/IMPL-oauth.md --missing

# Print version
saw --version
```

## Architecture

```
cmd/saw/           # CLI entry point (wave, status, scout, scaffold, merge)
pkg/
├── orchestrator/  # 10-state machine + wave coordination + merge procedure
├── protocol/      # IMPL doc parser + completion report extraction
├── worktree/      # Git worktree create/remove/cleanup
└── agent/         # Anthropic API client + agent runner + completion polling
internal/
└── git/           # Git CLI wrappers (worktree, merge, diff, rev-parse)
```

## Protocol Compliance

Implements [SAW Protocol v0.8.0](https://github.com/blackwell-systems/scout-and-wave/tree/main/protocol):

| Invariant | Description | Status |
|-----------|-------------|--------|
| I1 | Disjoint file ownership enforced pre-merge | ✅ |
| I2 | Interface contracts precede parallel execution | ✅ |
| I3 | Wave N+1 blocked until Wave N merged + verified | ✅ |
| I4 | IMPL doc is single source of truth | ✅ |
| I5 | Agents commit before reporting | ✅ (enforced by merge trip wire) |
| I6 | Role separation: orchestrator does not do agent work | ✅ |

**10-state machine:**

```
ScoutPending → Reviewed → ScaffoldPending → WavePending → WaveExecuting
                                                 ↑              ↓
                                            WaveVerified ← WaveMerging
                                                 ↓
                                             Complete
```

Terminal states: `NotSuitable`, `Complete`. Recovery state: `Blocked`.

## Protocol Reference

- [invariants.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/invariants.md) — Six correctness guarantees (I1–I6)
- [state-machine.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/state-machine.md) — Ten states and transitions
- [participants.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/participants.md) — Four participant roles
- [message-formats.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/message-formats.md) — YAML schemas

## License

MIT
