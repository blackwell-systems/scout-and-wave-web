# saw CLI Reference

`saw` is the Scout-and-Wave web orchestration binary. It provides both a web UI (via `saw serve`) and a CLI for SAW operations.

```
saw [command] [args] [flags]
saw --version
saw --help
```

## Quick Reference

| Command | Category | Description |
|---------|----------|-------------|
| `serve` | Web UI | Start HTTP server with web interface |
| `scout` | Orchestration | Generate IMPL doc from feature description |
| `scaffold` | Orchestration | Create interface scaffolds from IMPL doc |
| `wave` | Orchestration | Execute agents for a wave |
| `merge` | Orchestration | Merge agent worktrees after wave completion |
| `status` | Status | Show wave/agent completion status |
| `current-wave` | Status | Return first incomplete wave number |
| `merge-wave` | Status | Check if wave is ready to merge (JSON output) |
| `validate` | Validation | Validate YAML manifest against protocol |
| `extract-context` | Context | Extract agent-specific context as JSON |
| `set-completion` | Status | Register completion report for an agent |
| `render` | Format | Render YAML manifest as markdown |
| `mark-complete` | Status | Write SAW:COMPLETE marker to IMPL doc |
| `run-gates` | Quality | Run quality gate checks for a wave |
| `check-conflicts` | Quality | Detect file ownership conflicts |
| `update-agent-prompt` | Maintenance | Update agent's task prompt in manifest |
| `validate-scaffolds` | Quality | Validate scaffold file status |
| `freeze-check` | Quality | Check for interface freeze violations |
| `analyze-deps` | Analysis | Analyze Go repository dependencies |
| `analyze-suitability` | Analysis | Scan codebase for pre-implementation status |
| `detect-cascades` | Analysis | Detect cascade candidates from type renames |
| `detect-scaffolds` | Analysis | Detect shared types needing scaffold files |
| `extract-commands` | Analysis | Extract build/test/lint commands from CI configs |

---

## Web UI

### serve

Start the HTTP server with React web interface for reviewing IMPL docs and monitoring wave execution.

```bash
saw serve [flags]
```

**Flags:**
- `--addr string` -- Listen address (default: `localhost:7432`)
- `--impl-dir string` -- IMPL doc directory (default: `<repo>/docs/IMPL`)
- `--repo string` -- Repository root (default: auto-detect from cwd)
- `--no-browser` -- Skip opening browser automatically

**Behavior:**
- Serves web UI on specified address
- Scans `--impl-dir` for IMPL docs (markdown and YAML)
- Automatically opens browser unless `--no-browser` specified
- Provides SSE endpoints for live updates
- Embeds React frontend via `go:embed`

**Examples:**
```bash
# Start server with defaults (localhost:7432, auto-detect repo)
saw serve

# Custom port and repo path
saw serve --addr :8080 --repo /path/to/project

# Custom IMPL directory, don't open browser
saw serve --impl-dir /custom/impls --no-browser
```

**See also:** [API Reference](api-reference.md) for HTTP endpoints

---

## Orchestration

### scout

Run Scout agent to analyze codebase and generate an IMPL doc for a feature request.

```bash
saw scout --feature "description" [flags]
```

**Flags:**
- `--feature string` -- One-line feature description (required)
- `--backend string` -- Backend to use: `api`, `cli`, or `auto` (default: `auto`; env: `SAW_BACKEND`)
- `--impl string` -- Output path for IMPL doc (optional; default: auto-generated in `docs/IMPL/`)
- `--repo string` -- Repository root (optional; default: auto-detect from cwd)

**Backend Selection:**
- `api` -- Use Anthropic API directly (requires `ANTHROPIC_API_KEY`)
- `cli` -- Use Claude CLI (`claude --print`; requires Claude Max plan)
- `auto` -- Use `api` if `ANTHROPIC_API_KEY` set, else `cli` (default)

**Output:**
- Creates YAML IMPL manifest at specified or auto-generated path
- Returns path to generated IMPL doc on success

**Examples:**
```bash
# Generate IMPL doc with auto backend
saw scout --feature "add OAuth 2.0 authentication"

# Force API backend
export ANTHROPIC_API_KEY=sk-ant-...
saw scout --feature "add caching layer" --backend api

# Force CLI backend (Claude Max plan)
saw scout --feature "refactor database layer" --backend cli

# Specify output path
saw scout --feature "add rate limiting" --impl docs/IMPL/IMPL-rate-limit.yaml
```

**See also:** `scaffold` (next step after Scout)

---

### scaffold

Run Scaffold agent to create interface contract stubs from an IMPL doc (I2 enforcement).

```bash
saw scaffold --impl <path> [flags]
```

**Flags:**
- `--impl string` -- Path to IMPL doc (required)
- `--backend string` -- Backend to use: `api`, `cli`, or `auto` (default: `auto`; env: `SAW_BACKEND`)
- `--repo string` -- Repository root (optional; default: auto-detect from cwd)

**Behavior:**
- Reads `interface_contracts` section from IMPL manifest
- Creates empty type/interface files with doc comments
- Commits scaffold files to main branch before wave execution
- Ensures I2 invariant (interfaces precede implementation)

**Examples:**
```bash
# Create scaffolds with auto backend
saw scaffold --impl docs/IMPL/IMPL-oauth.yaml

# Force specific backend
saw scaffold --impl docs/IMPL/IMPL-caching.yaml --backend cli
```

**See also:** `wave` (next step after scaffolding)

---

### wave

Execute agents for a specific wave from an IMPL doc.

```bash
saw wave --impl <path> [flags]
```

**Flags:**
- `--impl string` -- Path to IMPL doc (required)
- `--wave int` -- Wave number to execute (default: `1`)
- `--auto` -- Skip inter-wave approval prompts (default: `false`)

**Behavior:**
- Creates git worktrees for each agent in the wave
- Runs agents in parallel with isolated working directories
- Waits for all agents to complete or fail
- Without `--auto`: pauses after each wave for human review
- With `--auto`: continues to next wave automatically after merge

**Examples:**
```bash
# Execute wave 1 (interactive, pause after completion)
saw wave --impl docs/IMPL/IMPL-oauth.yaml

# Execute wave 2 specifically
saw wave --impl docs/IMPL/IMPL-oauth.yaml --wave 2

# Execute all waves automatically (no pauses)
saw wave --impl docs/IMPL/IMPL-oauth.yaml --auto

# Start from wave 2, continue automatically
saw wave --impl docs/IMPL/IMPL-oauth.yaml --wave 2 --auto
```

**See also:** `merge`, `status`

---

### merge

Manually merge agent worktrees for a completed wave (recovery/debugging tool).

```bash
saw merge --impl <path> --wave <n>
```

**Flags:**
- `--impl string` -- Path to IMPL doc (required)
- `--wave int` -- Wave number to merge (default: `1`)

**Behavior:**
- Validates all agents in wave have commits (I5)
- Checks for file ownership conflicts (I1)
- Merges all agent branches to main
- Runs post-merge verification (test/lint gates if configured)
- Updates IMPL doc with merge status

**Examples:**
```bash
# Merge wave 1
saw merge --impl docs/IMPL/IMPL-oauth.yaml --wave 1

# Merge wave 3
saw merge --impl docs/IMPL/IMPL-oauth.yaml --wave 3
```

**Note:** Normally called automatically by `wave --auto`. Use this for manual recovery when `wave` is interrupted.

**See also:** `wave`, `status`

---

## Status & Reporting

### status

Show current wave/agent completion status from an IMPL doc.

```bash
saw status --impl <path> [flags]
```

**Flags:**
- `--impl string` -- Path to IMPL doc (required)
- `--json` -- Output JSON instead of human-readable text (default: `false`)
- `--missing` -- List only agents missing completion reports (default: `false`)

**Output (human-readable):**
```
IMPL: IMPL-oauth.yaml
Feature: Add OAuth 2.0 authentication
Status: In Progress

Wave 1: Complete (3/3 agents)
  A: OAuth client implementation
  B: Token storage layer
  C: Redirect handler

Wave 2: In Progress (1/2 agents)
  D: User profile endpoint
  E: Token refresh logic (pending)
```

**Output (JSON):**
```json
{
  "slug": "oauth",
  "feature": "Add OAuth 2.0 authentication",
  "total_waves": 2,
  "current_wave": 2,
  "status": "in_progress",
  "waves": [
    {"wave": 1, "total": 3, "complete": 3, "status": "complete"},
    {"wave": 2, "total": 2, "complete": 1, "status": "in_progress"}
  ]
}
```

**Examples:**
```bash
# Human-readable status
saw status --impl docs/IMPL/IMPL-oauth.yaml

# JSON output for scripting
saw status --impl docs/IMPL/IMPL-oauth.yaml --json

# Show only incomplete agents
saw status --impl docs/IMPL/IMPL-oauth.yaml --missing
```

**See also:** `current-wave`, `merge-wave`

---

### current-wave

Return the wave number of the first incomplete wave, or "complete" if all waves finished.

```bash
saw current-wave <manifest-path>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)

**Output:**
- Prints wave number (e.g., `2`) if incomplete waves remain
- Prints `complete` if all waves finished

**Exit codes:**
- `0` on success
- `1` if manifest not found or invalid

**Examples:**
```bash
# Get current wave
saw current-wave docs/IMPL/IMPL-oauth.yaml
# Output: 2

# Use in scripts
WAVE=$(saw current-wave docs/IMPL/IMPL-oauth.yaml)
if [ "$WAVE" = "complete" ]; then
  echo "All waves finished"
else
  echo "Continue from wave $WAVE"
fi
```

**See also:** `status`, `wave`

---

### merge-wave

Check if a wave is ready to merge and output JSON status (used internally by orchestrator).

```bash
saw merge-wave <manifest-path> <wave-number>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)
- `wave-number` -- Wave number to check (required)

**Output:** JSON object with `ready` (bool), `reason` (string if not ready), `agents` (array of agent IDs).

**Examples:**
```bash
saw merge-wave docs/IMPL/IMPL-oauth.yaml 1
# {"ready": true, "agents": ["A", "B", "C"]}

saw merge-wave docs/IMPL/IMPL-oauth.yaml 2
# {"ready": false, "reason": "Agent E has no completion report"}
```

**See also:** `status`, `merge`

---

## Validation & Quality

### validate

Validate a YAML IMPL manifest against protocol invariants (E1-E23).

```bash
saw validate <manifest-path>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)

**Output:** JSON object with `valid` (bool), `errors` (array of `{code, message, line?}`).

**Exit codes:**
- `0` if valid
- `1` if validation errors found

**Examples:**
```bash
saw validate docs/IMPL/IMPL-oauth.yaml

# Output (valid):
# {"valid": true, "errors": []}

# Output (invalid):
# {"valid": false, "errors": [
#   {"code": "E16C", "message": "Duplicate agent ID 'A' in wave 2", "line": 45}
# ]}
```

**See also:** `check-conflicts`, `validate-scaffolds`

---

### check-conflicts

Detect file ownership conflicts across agents in an IMPL manifest (I1 validation).

```bash
saw check-conflicts <manifest-path>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)

**Output:** JSON array of conflicts (empty if none). Each conflict includes `file`, `agents` (array of agent IDs claiming the file).

**Exit codes:**
- `0` if no conflicts
- `1` if conflicts found

**Examples:**
```bash
saw check-conflicts docs/IMPL/IMPL-oauth.yaml

# Output (no conflicts):
# []

# Output (conflicts):
# [
#   {"file": "pkg/auth/token.go", "agents": ["A", "C"]},
#   {"file": "internal/db/users.go", "agents": ["B", "D"]}
# ]
```

**See also:** `validate`

---

### run-gates

Run quality gate checks for a wave (test/lint commands from manifest).

```bash
saw run-gates --wave <n> [flags]
```

**Flags:**
- `--wave int` -- Wave number (required)
- `--repo-dir string` -- Repository directory (default: `.`)

**Behavior:**
- Reads quality gates from IMPL manifest
- Runs test and lint commands
- Returns exit code 0 if all gates pass, 1 if any fail

**Examples:**
```bash
saw run-gates --wave 1
saw run-gates --wave 2 --repo-dir /path/to/repo
```

**See also:** `validate`

---

### validate-scaffolds

Validate that scaffold files declared in manifest are committed to the repository.

```bash
saw validate-scaffolds <manifest-path>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)

**Output:** JSON object with `valid` (bool), `missing` (array of missing file paths).

**Exit codes:**
- `0` if all scaffolds present
- `1` if any scaffolds missing

**Examples:**
```bash
saw validate-scaffolds docs/IMPL/IMPL-oauth.yaml

# Output (valid):
# {"valid": true, "missing": []}

# Output (missing):
# {"valid": false, "missing": ["pkg/auth/types.go", "internal/oauth/client.go"]}
```

**See also:** `scaffold`, `validate`

---

### freeze-check

Check IMPL manifest for interface contract freeze violations (E17).

```bash
saw freeze-check <manifest-path>
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)

**Behavior:**
- Verifies `frozen: true` interfaces are not modified after Wave 1
- Checks git history for commits to frozen files in later waves

**Output:** JSON object with `valid` (bool), `violations` (array).

**Examples:**
```bash
saw freeze-check docs/IMPL/IMPL-oauth.yaml
```

**See also:** `validate`

---

## Analysis

### analyze-deps

Analyze Go repository dependencies and produce a dependency graph.

```bash
saw analyze-deps [flags]
```

**Flags:**
- `--repo-dir string` -- Repository root directory (default: `.`)

**Behavior:**
- Parses Go module and import structure
- Produces dependency graph for use in IMPL planning
- Helps identify which packages are tightly coupled

**Examples:**
```bash
saw analyze-deps
saw analyze-deps --repo-dir /path/to/go/project
```

---

### analyze-suitability

Scan codebase for pre-implementation status of requirements.

```bash
saw analyze-suitability [flags]
```

**Flags:**
- `--repo-dir string` -- Repository root directory (default: `.`)

**Behavior:**
- Scans the codebase to determine what already exists
- Reports which features/requirements are partially or fully implemented
- Useful for Scout to avoid duplicating existing work

**Examples:**
```bash
saw analyze-suitability
saw analyze-suitability --repo-dir /path/to/project
```

---

### detect-cascades

Detect cascade candidates from type renames via AST analysis.

```bash
saw detect-cascades [flags]
```

**Flags:**
- `--repo-dir string` -- Repository root directory (default: `.`)

**Behavior:**
- Performs AST analysis on Go source files
- Identifies type renames that would cause cascading changes
- Helps avoid breaking changes during wave execution

**Examples:**
```bash
saw detect-cascades
saw detect-cascades --repo-dir /path/to/project
```

---

### detect-scaffolds

Detect shared types that need scaffold files from interface contracts.

```bash
saw detect-scaffolds [flags]
```

**Flags:**
- `--repo-dir string` -- Repository root directory (default: `.`)

**Behavior:**
- Analyzes interface contracts in IMPL manifests
- Identifies shared types referenced by multiple agents
- Suggests which files should be scaffolded before wave execution

**Examples:**
```bash
saw detect-scaffolds
saw detect-scaffolds --repo-dir /path/to/project
```

---

### extract-commands

Extract build/test/lint/format commands from CI configs and project manifests.

```bash
saw extract-commands [flags]
```

**Flags:**
- `--repo-dir string` -- Repository root directory (default: `.`)

**Behavior:**
- Scans CI configuration files (GitHub Actions, Makefile, etc.)
- Extracts build, test, lint, and format commands
- Used to populate quality gates in IMPL manifests

**Examples:**
```bash
saw extract-commands
saw extract-commands --repo-dir /path/to/project
```

---

## Context & Maintenance

### extract-context

Extract agent-specific context from an IMPL manifest as JSON (E23 context payload).

```bash
saw extract-context --impl <path> --agent <id>
```

**Flags:**
- `--impl string` -- Path to IMPL manifest (required)
- `--agent string` -- Agent ID to extract context for (required)

**Output:** JSON object containing:
- `task` -- Agent's task description
- `files` -- Array of files owned by agent
- `dependencies` -- Array of agent IDs this agent depends on
- `impl_doc_path` -- Path to IMPL manifest

**Examples:**
```bash
saw extract-context --impl docs/IMPL/IMPL-oauth.yaml --agent A

# Output:
# {
#   "task": "Implement OAuth client with authorization code flow",
#   "files": ["pkg/oauth/client.go", "pkg/oauth/config.go"],
#   "dependencies": [],
#   "impl_doc_path": "docs/IMPL/IMPL-oauth.yaml"
# }
```

**See also:** API endpoint `GET /api/impl/{slug}/agent/{letter}/context`

---

### set-completion

Register a completion report for an agent in a manifest (reads YAML from stdin).

```bash
saw set-completion <manifest-path> <agent-id> < completion-report.yaml
```

**Arguments:**
- `manifest-path` -- Path to YAML IMPL manifest (required)
- `agent-id` -- Agent ID (e.g., `A`, `B`) (required)

**Input:** Reads completion report YAML from stdin with fields:
- `status` -- `complete`, `blocked`, or `partial`
- `summary` -- Brief completion summary
- `files_modified` -- Array of file paths
- `tests_added` -- Number of tests added
- `notes` -- Additional notes (optional)

**Examples:**
```bash
cat <<EOF | saw set-completion docs/IMPL/IMPL-oauth.yaml A
status: complete
summary: Implemented OAuth client with PKCE flow
files_modified:
  - pkg/oauth/client.go
  - pkg/oauth/config.go
tests_added: 12
notes: Added integration tests with mock server
EOF
```

**See also:** API endpoint `POST /api/manifest/{slug}/completion/{agentID}`

---

### update-agent-prompt

Update an agent's task prompt in a manifest (interactive editor).

```bash
saw update-agent-prompt --agent <id> < manifest.yaml > updated.yaml
```

**Flags:**
- `--agent string` -- Agent ID (required)

**Behavior:**
- Reads manifest from stdin
- Opens `$EDITOR` with agent's current task prompt
- Writes updated manifest to stdout

**Examples:**
```bash
saw update-agent-prompt --agent B < docs/IMPL/IMPL-oauth.yaml > /tmp/updated.yaml
mv /tmp/updated.yaml docs/IMPL/IMPL-oauth.yaml
```

**See also:** `render`

---

## Format Conversion

### render

Render a YAML IMPL manifest as markdown (for human readability).

```bash
saw render < manifest.yaml > output.md
```

**Input:** Reads YAML manifest from stdin
**Output:** Writes markdown to stdout

**Behavior:**
- Converts YAML manifest to markdown format
- Preserves wave structure, agent tasks, file ownership tables
- Compatible with original markdown IMPL doc format

**Examples:**
```bash
# Render to stdout
saw render < docs/IMPL/IMPL-oauth.yaml

# Save to file
saw render < docs/IMPL/IMPL-oauth.yaml > /tmp/IMPL-oauth.md
```

---

### mark-complete

Write `SAW:COMPLETE` marker to an IMPL doc with completion date.

```bash
saw mark-complete --date <YYYY-MM-DD> < manifest.yaml > updated.yaml
```

**Flags:**
- `--date string` -- Completion date in `YYYY-MM-DD` format (default: today)

**Input:** Reads manifest from stdin
**Output:** Writes updated manifest to stdout with completion marker

**Examples:**
```bash
saw mark-complete < docs/IMPL/IMPL-oauth.yaml > /tmp/complete.yaml
mv /tmp/complete.yaml docs/IMPL/IMPL-oauth.yaml

# Custom date
saw mark-complete --date 2026-03-15 < docs/IMPL/IMPL-oauth.yaml > /tmp/complete.yaml
```

**See also:** `status`

---

## Global Flags

All commands support:
- `--repo-dir string` -- Repository root directory (default: `.`)
- `--version` -- Print version and exit
- `--help` -- Print help and exit

---

## Environment Variables

| Variable | Commands | Description |
|----------|----------|-------------|
| `SAW_BACKEND` | `scout`, `scaffold` | Default backend: `api`, `cli`, or `auto` |
| `ANTHROPIC_API_KEY` | All (when using API backend) | Anthropic API key |

---

## Exit Codes

- `0` -- Success
- `1` -- Error (validation failure, missing arguments, command failure)

---

## See Also

- [API Reference](api-reference.md) -- HTTP endpoints for web UI
- [Configuration Reference](configuration.md) -- `saw.config.json` structure
- [Protocol Specification](https://github.com/blackwell-systems/scout-and-wave) -- SAW protocol invariants
