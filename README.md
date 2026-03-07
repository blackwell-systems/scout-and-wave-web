# scout-and-wave-go

Go implementation of the [Scout-and-Wave protocol](https://github.com/blackwell-systems/scout-and-wave) for parallel agent coordination.

## Status

**v0.1.0** — Wave agent execution is fully implemented and tested.

## Installation

```bash
go install github.com/blackwell-systems/scout-and-wave-go/cmd/saw@latest
```

## Usage

```bash
# Execute a wave from an existing IMPL doc
saw wave --impl docs/IMPL/IMPL-my-feature.md

# Execute a specific wave number
saw wave --impl docs/IMPL/IMPL-my-feature.md --wave 2

# Check wave/agent status
saw status --impl docs/IMPL/IMPL-my-feature.md

# Print version
saw --version
```

## Architecture

```
cmd/saw/           # CLI entry point (wave, status subcommands)
pkg/
├── orchestrator/  # 7-state machine + wave coordination + merge procedure
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

**7-state machine:** `SuitabilityPending → Reviewed → WavePending → WaveExecuting → WaveVerified → Complete` (+ `NotSuitable`)

## MVP Scope

Phase 1 (this release):
- Parse existing IMPL docs and extract wave/agent structure
- Create git worktrees for isolated parallel execution
- Execute agents via Anthropic API (streaming)
- Merge wave branches with conflict detection and trip wire verification
- Post-merge verification gates (`go test ./...`)
- `saw wave` and `saw status` CLI commands

Deferred to Phase 2:
- Scout agent (codebase analysis + IMPL doc generation)
- Scaffold agent (shared type file creation)
- Interactive/manual approval prompts (auto mode only for now)

## Protocol Reference

- [invariants.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/invariants.md) — Six correctness guarantees (I1–I6)
- [state-machine.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/state-machine.md) — Seven states and transitions
- [participants.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/participants.md) — Four participant roles
- [message-formats.md](https://github.com/blackwell-systems/scout-and-wave/blob/main/protocol/message-formats.md) — YAML schemas

## License

MIT
