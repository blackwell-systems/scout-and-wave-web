# IMPL: Typed Block Parser & v0.10.0 Protocol Support
<!-- SAW:COMPLETE 2026-03-07 -->

## Suitability Assessment

Verdict: SUITABLE
test_command: `go test -race -count=1 ./...`
lint_command: `go vet ./...`

Five distinct work areas map cleanly to disjoint file ownership across five agents. The three Go-layer tasks (parser refactor, types additions, and validator) touch separate files with well-defined interfaces between them. The API layer (`doc_status` surfacing) depends only on completed types, and the web UI (`PreMortem` panel) depends only on the API types. All interfaces can be fully specified before implementation begins: the `IMPLDoc` struct additions are the shared type crossing agent boundaries, and they are defined in the scaffold. Build+test cycles run `go test -race ./...` with 32 existing tests — long enough for parallelization to pay off. Wave structure: Wave 1 (scaffold) unblocks Wave 2 (3 parallel agents: parser, types+state, validator), which unblocks Wave 3 (2 parallel agents: API and web UI).

Pre-implementation scan results:
- Total items: 5 requirements
- Already implemented: 1 item (doc_status field in `implListEntry` and `IMPLDocResponse` — the struct fields and list-endpoint logic exist; the `"active"` vs `"complete"` casing per the lowercase spec is already wired)
- Partially implemented: 1 item (typed-block parser — the parser already reads fenced blocks for YAML-block tracking but does NOT use `type=impl-*` annotations to locate sections; heading-based detection is the only path)
- To-do: 3 items (PreMortem field+parser, ScoutValidating state, Go validator)

Agent adjustments:
- Agent D (API doc_status): changed to "verify + surface correctly" — `doc_status` is already returned by `handleListImpls` and `handleGetImpl`; work is to verify the value is `"active"` (lowercase) as the spec requires vs the current `"ACTIVE"` (uppercase), and ensure `handleGetImpl` propagates it from `doc.DocStatus`; add/verify tests
- Agent A (parser refactor): "complete the implementation" — typed-block fence detection loop exists but anchor dispatch does not; add typed-block section dispatch while keeping heading fallback
- Agents B, C, E proceed as planned (to-do)

Estimated time saved: ~25 minutes (avoided duplicate implementations on doc_status and partial re-implementation of fenced-block scanner)

Estimated times:
- Scout phase: ~15 min (large codebase read, five areas of work)
- Agent execution: ~40 min (5 agents × ~15 min avg, accounting for Wave 2 parallelism of 3 agents)
- Merge & verification: ~8 min (5 agents, 2 waves)
- Total SAW time: ~63 min

Sequential baseline: ~90 min (5 agents × ~18 min avg sequential time)
Time savings: ~27 min (30% faster)

Recommendation: Clear speedup. Proceed with SAW.

---

## Scaffolds

The `PreMortem` struct and `ValidationError` struct must exist before Wave 2 launches. Agent A (parser) will populate `IMPLDoc.PreMortem`; Agent C (validator) will return `[]ValidationError`. Both types must be defined in `pkg/types/types.go` by the Scaffold Agent before either agent starts.

| File | Contents | Import path | Status |
|------|----------|-------------|--------|
| `pkg/types/types.go` | Add `PreMortemRow struct`, `PreMortem struct`, `ValidationError struct` — exact fields below | `github.com/blackwell-systems/scout-and-wave-go/pkg/types` | pending |

**Scaffold Agent instructions:** Add the following to `pkg/types/types.go` (append after `ScaffoldFile`):

```go
// PreMortemRow is one row of the ## Pre-Mortem risk table.
type PreMortemRow struct {
    Scenario   string
    Likelihood string
    Impact     string
    Mitigation string
}

// PreMortem holds the parsed ## Pre-Mortem section.
type PreMortem struct {
    OverallRisk string        // "low", "medium", or "high"
    Rows        []PreMortemRow
}

// ValidationError is one error returned by ValidateIMPLDoc (E16 Go validator).
type ValidationError struct {
    BlockType  string // e.g. "impl-file-ownership", "impl-dep-graph", "impl-wave-structure", "impl-completion-report"
    LineNumber int    // line number of the opening fence in the IMPL doc
    Message    string // human-readable description of the violation
}
```

Also add `PreMortem *PreMortem` field to `IMPLDoc` after `PostMergeChecklistText`:

```go
PreMortem *PreMortem // parsed ## Pre-Mortem section; nil if absent
```

And add `ScoutValidating` state constant to the `State` iota block in `pkg/types/types.go` between `ScoutPending` and `NotSuitable`:

```go
ScoutValidating  // Scout has written the IMPL doc; E16 validation in progress (SCOUT_VALIDATING)
```

And add `"ScoutValidating"` case to `State.String()`.

---

## Pre-Mortem

**Overall risk:** medium

**Failure modes:**

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| Parser refactor breaks heading-based fallback for pre-v0.10.0 docs; existing parser tests regress | medium | high | Agent A must run all 19 existing parser tests (not just new ones) before declaring complete; the fallback path must be tested explicitly with a fixture that has no typed blocks |
| ScoutValidating iota insertion renumbers existing State constants; callers that switch on integer values rather than named constants break silently | low | high | Scaffold Agent inserts ScoutValidating between ScoutPending and NotSuitable using iota; Agent B verifies all State.String() cases in pkg/types/types.go compile and the String() switch is updated; no external package uses raw integer state values (confirmed by grep) |
| Agent C (validator) and Agent A (parser) independently define ValidationError or PreMortemRow structs; merge produces duplicate type declarations | high | high | Scaffold Agent creates both types in pkg/types/types.go BEFORE Wave 2 launches; agent prompts explicitly forbid defining these types themselves |
| doc_status casing mismatch ("ACTIVE" vs "active") persists because Agent D only verifies list endpoint but not GET /impl/{slug} endpoint | medium | medium | Agent D prompt requires verifying both endpoints and adding/updating tests for both; the IMPLDocResponse.DocStatus field must return lowercase "active" to match the spec |
| Web UI PreMortem panel (Agent E) imports a type shape that differs from what Agent A actually parses; panel renders nothing silently | low | medium | Interface contract for PreMortemPanel props is defined precisely in this IMPL doc; Agent E reads the scaffold types.go to verify field names before building the component |
| Go validator (Agent C) logic diverges from bash reference implementation; different error messages confuse orchestrators | medium | medium | Agent C prompt cites the exact validate-impl.sh logic and requires matching error message prefixes; integration test compares output on shared fixture |

---

## Known Issues

None identified.

---

## Dependency Graph

```yaml type=impl-dep-graph
Wave 1 (1 agent, scaffold):
    [S] pkg/types/types.go
         Add PreMortemRow, PreMortem, ValidationError structs; PreMortem field on IMPLDoc; ScoutValidating state
         ✓ root (no dependencies on other agents)

Wave 2 (3 parallel agents, implementation):
    [A] pkg/protocol/parser.go
         Add typed-block anchor dispatch (type=impl-*); parse ## Pre-Mortem section
         pkg/protocol/parser_test.go (new tests)
         depends on: [S]

    [B] pkg/types/types.go
         (Wave 1 scaffold created the types; Agent B owns String() and any follow-on state wiring)
         NOTE: Agent B scope is pkg/types/types_test.go only — adding unit tests for ScoutValidating state
         ✓ root (scaffold already created the types; B adds tests)

    [C] pkg/protocol/validator.go (new file)
         Go implementation of E16 typed-block validator; returns []types.ValidationError
         pkg/protocol/validator_test.go (new file)
         depends on: [S]

Wave 3 (2 parallel agents, integration):
    [D] pkg/api/impl.go
         Verify/fix doc_status casing ("active"/"complete" lowercase); surface PreMortem in IMPLDocResponse
         pkg/api/types.go (add PreMortemEntry, PreMortemRowEntry response types)
         pkg/api/server_test.go (verify doc_status and PreMortem in API responses)
         depends on: [A] [S]

    [E] web/src/types.ts
         Add PreMortemRow, PreMortem interfaces
         web/src/components/review/PreMortemPanel.tsx (new file)
         web/src/components/ReviewScreen.tsx (add pre-mortem panel toggle + render)
         depends on: [D]
```

Ownership conflict note: `pkg/types/types.go` is modified by the Scaffold Agent in Wave 1 only. Agent B in Wave 2 is scoped to `pkg/types/types_test.go` exclusively — it does NOT modify `types.go` (the scaffold owns that file). This preserves disjoint ownership.

---

## Interface Contracts

### Cross-agent type contracts (defined by Scaffold Agent)

```go
// In pkg/types/types.go

type PreMortemRow struct {
    Scenario   string
    Likelihood string
    Impact     string
    Mitigation string
}

type PreMortem struct {
    OverallRisk string        // "low", "medium", or "high"
    Rows        []PreMortemRow
}

type ValidationError struct {
    BlockType  string // "impl-file-ownership" | "impl-dep-graph" | "impl-wave-structure" | "impl-completion-report"
    LineNumber int    // 1-based line number of the opening ``` type=impl-* fence
    Message    string
}

// New field added to IMPLDoc:
// PreMortem *PreMortem  // nil if ## Pre-Mortem section absent

// New state constant added to State iota (between ScoutPending and NotSuitable):
// ScoutValidating State = 1  // iota shifts existing values by 1
```

### Agent A → Agent D (parser output consumed by API)

Agent A adds `PreMortem *types.PreMortem` to `types.IMPLDoc`. Agent D reads this field and maps it to the API response. The parser populates this field by scanning the `## Pre-Mortem` section for:
1. A line matching `**Overall risk:** low|medium|high` → `PreMortem.OverallRisk`
2. Markdown table rows with 4 columns (Scenario | Likelihood | Impact | Mitigation) → `PreMortem.Rows`

### Agent A typed-block dispatch (new parser behavior)

```go
// New function added to pkg/protocol/parser.go:
// parseTypedBlock reads the content of a fenced code block opened with
// ```yaml type=impl-{blockType} and dispatches to the appropriate section parser.
// Returns the blockType string (e.g. "impl-file-ownership") and the content lines.
func parseTypedBlockContent(scanner *bufio.Scanner) (lines []string)
// (internal helper — not exported)

// Typed block dispatch added to the main scanner loop in ParseIMPLDoc.
// When a line matches: strings.HasPrefix(trimmed, "```") && strings.Contains(trimmed, "type=impl-")
// Extract blockType from the annotation, read content via parseTypedBlockContent,
// dispatch to the appropriate section parser (file-ownership, dep-graph, wave-structure).
// The heading-based section parsers remain as fallback when no typed blocks are present.
```

### Agent C → orchestrator (validator function signature)

```go
// In pkg/protocol/validator.go (new file):

// ValidateIMPLDoc runs E16 typed-block validation on a parsed IMPLDoc.
// It re-reads the raw file at path to check line numbers and block content.
// Returns nil slice if all blocks are valid or no typed blocks exist.
// Returns one ValidationError per violation (multiple errors may be returned).
func ValidateIMPLDoc(path string) ([]types.ValidationError, error)
```

### Agent D API response additions

```go
// New types added to pkg/api/types.go:

type PreMortemRowEntry struct {
    Scenario   string `json:"scenario"`
    Likelihood string `json:"likelihood"`
    Impact     string `json:"impact"`
    Mitigation string `json:"mitigation"`
}

type PreMortemEntry struct {
    OverallRisk string             `json:"overall_risk"`
    Rows        []PreMortemRowEntry `json:"rows"`
}

// IMPLDocResponse gains a new field:
// PreMortem *PreMortemEntry `json:"pre_mortem,omitempty"`

// doc_status values: "active" (lowercase) or "complete" (lowercase)
// Current code returns "ACTIVE"/"COMPLETE" — Agent D must fix casing.
```

### Agent E web UI types

```typescript
// New interfaces added to web/src/types.ts:

interface PreMortemRow {
  scenario: string
  likelihood: string
  impact: string
  mitigation: string
}

interface PreMortem {
  overall_risk: string
  rows: PreMortemRow[]
}

// IMPLDocResponse gains:
// pre_mortem?: PreMortem

// IMPLListEntry doc_status values change to lowercase "active" | "complete"
// (Agent E must update any === 'COMPLETE' comparisons to === 'complete')
```

---

## File Ownership

```yaml type=impl-file-ownership
| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| `pkg/types/types.go` | Scaffold | 0 | — |
| `pkg/protocol/parser.go` | A | 2 | Scaffold |
| `pkg/protocol/parser_test.go` | A | 2 | Scaffold |
| `pkg/types/types_test.go` (new) | B | 2 | Scaffold |
| `pkg/protocol/validator.go` (new) | C | 2 | Scaffold |
| `pkg/protocol/validator_test.go` (new) | C | 2 | Scaffold |
| `pkg/api/impl.go` | D | 3 | A, Scaffold |
| `pkg/api/types.go` | D | 3 | A, Scaffold |
| `pkg/api/server_test.go` | D | 3 | A, Scaffold |
| `web/src/types.ts` | E | 3 | D |
| `web/src/components/review/PreMortemPanel.tsx` (new) | E | 3 | D |
| `web/src/components/ReviewScreen.tsx` | E | 3 | D |
```

---

## Wave Structure

```yaml type=impl-wave-structure
Wave 0:  [S]                       <- 1 agent (scaffold types)
            | (S complete)
Wave 2:  [A] [B] [C]               <- 3 parallel agents (parser, type tests, validator)
            | (A complete)
Wave 3:  [D] [E]                   <- 2 parallel agents (API, web UI)
```

Note: Wave numbering follows the convention that the Scaffold Agent runs as "Wave 0" (pre-Wave 1). The feature has no Wave 1 proper — Wave 2 is the first implementation wave. This is intentional: the Scaffold Agent is a prerequisite, not a parallel wave.

---

## Wave 0

Wave 0 delivers the shared type scaffold. The Scaffold Agent creates the three new types and the state constant in `pkg/types/types.go`. No Wave 2 agent may start until this wave is merged and `go build ./...` passes.

### Agent S - Scaffold Types

**role:** scaffold
**wave:** 0
**files_owned:**
- `pkg/types/types.go`

**task:**
You are the Scaffold Agent for the `typed-block-parser` feature. Your sole job is to add shared types to `pkg/types/types.go` so that Wave 2 agents (parser, type tests, and validator) can compile against them. Do not implement any logic beyond what is specified here.

**Read** `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types.go` first.

**Changes to make:**

1. Insert `ScoutValidating` into the `State` iota block between `ScoutPending` and `NotSuitable`:

```go
const (
    ScoutPending    State = iota // Scout agent is analyzing the codebase (SCOUT_PENDING)
    ScoutValidating              // Scout has written the IMPL doc; E16 validation in progress (SCOUT_VALIDATING)
    NotSuitable                  // feature was rejected by the suitability gate; terminal
    // ... rest unchanged
)
```

2. Add a `"ScoutValidating"` case to `State.String()`:

```go
case ScoutValidating:
    return "ScoutValidating"
```

3. Append after the `ScaffoldFile` struct:

```go
// PreMortemRow is one row of the ## Pre-Mortem risk table.
type PreMortemRow struct {
    Scenario   string
    Likelihood string
    Impact     string
    Mitigation string
}

// PreMortem holds the parsed ## Pre-Mortem section.
type PreMortem struct {
    OverallRisk string        // "low", "medium", or "high"
    Rows        []PreMortemRow
}

// ValidationError is one error returned by ValidateIMPLDoc (E16 Go validator).
type ValidationError struct {
    BlockType  string // e.g. "impl-file-ownership", "impl-dep-graph", "impl-wave-structure", "impl-completion-report"
    LineNumber int    // 1-based line number of the opening fence in the IMPL doc
    Message    string // human-readable description of the violation
}
```

4. Add `PreMortem *PreMortem` field to `IMPLDoc` after `PostMergeChecklistText`:

```go
PostMergeChecklistText string
PreMortem              *PreMortem // parsed ## Pre-Mortem section; nil if absent
```

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/types/... -count=1
```

**completion_report:**
```yaml type=impl-completion-report
status: complete
worktree: main
branch: main
commit: f8521b721147467055aad26ed6194e95804acdac
files_changed:
  - pkg/types/types.go
files_created: []
interface_deviations: none
verification: "go build ./... && go vet ./... && go test ./pkg/types/... -count=1"
notes: "Added ScoutValidating state, PreMortemRow, PreMortem, ValidationError structs, PreMortem field to IMPLDoc"
```
```

---

## Wave 2

Wave 2 launches after the Scaffold Agent completes and `go build ./...` passes. Three agents run in parallel: Agent A refactors the parser, Agent B adds type tests, Agent C implements the validator. Agents A and C both depend on the scaffold types; Agent B only depends on the scaffold being in place to compile.

### Agent A - Parser Typed-Block Dispatch & PreMortem

**role:** implementer
**wave:** 2
**files_owned:**
- `pkg/protocol/parser.go`
- `pkg/protocol/parser_test.go`

**task:**
You are implementing typed-block anchor dispatch and `## Pre-Mortem` parsing in `pkg/protocol/parser.go`.

**Context:** The current parser detects sections exclusively by heading text (`### File Ownership`, `### Dependency Graph`, etc.) using a line-by-line state machine. The v0.10.0 protocol introduces typed fenced code blocks — e.g. ` ```yaml type=impl-file-ownership ` — as the canonical way to locate structured sections. The heading-based approach must remain as a fallback for pre-v0.10.0 docs.

**Read these files before starting:**
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/protocol/parser.go` (the full existing implementation)
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/protocol/parser_test.go` (all existing tests — you must not break any)
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types.go` (confirm `PreMortem`, `PreMortemRow`, `ValidationError` types exist from scaffold)

**Changes to make:**

**1. Typed-block dispatch in the main scanner loop.**

In `ParseIMPLDoc`, the existing code toggles `inYAMLBlock` on any ` ``` ` fence. Extend this to detect typed blocks:

```go
// When a line matches strings.HasPrefix(trimmed, "```") && strings.Contains(trimmed, "type=impl-"):
//   - extract blockType: the substring after "type=" up to end-of-line or first space
//   - read block content (lines until closing ```) using a helper
//   - dispatch to the typed-block section parser
//   - do NOT set inYAMLBlock for these fences (the helper consumes them)
```

The typed-block dispatch must check the blockType string and call the corresponding section parser:

| `blockType` | Action |
|---|---|
| `impl-file-ownership` | Parse table rows from block content into `doc.FileOwnership` (reuse `parseFileOwnershipRow` logic but feed it from block lines rather than scanner) |
| `impl-dep-graph` | Store raw block content as `doc.DependencyGraphText` |
| `impl-wave-structure` | Store raw block content (ignored by parser beyond storage) |
| `impl-completion-report` | Skip (completion reports are parsed by `ParseCompletionReport`, not `ParseIMPLDoc`) |

When a typed block is found and dispatched, the heading-based fallback for that section must NOT overwrite it. Implement this with a set of `bool` flags: `hasTypedFileOwnership`, `hasTypedDepGraph`. When these are true, skip the corresponding heading-based parse.

**2. Parse `## Pre-Mortem` section.**

Add a new case to the top-level switch for heading `## Pre-Mortem` (or `### Pre-Mortem` — handle both):

```go
case trimmed == "## Pre-Mortem" || trimmed == "### Pre-Mortem":
    flushAgent()
    doc.PreMortem = parsePreMortemSection(scanner)
    state = stateTop
```

Implement `parsePreMortemSection(scanner *bufio.Scanner) *types.PreMortem`:
- Scan lines until next `##` or `###` header or end of file
- Look for a line matching `**Overall risk:**` (case-insensitive) and extract the risk level ("low", "medium", "high")
- Parse markdown table rows: skip header row (`| Scenario |`) and separator row (`|---|`); for each data row split on `|` and extract 4 columns
- Return nil if no table rows found (section present but empty)

**3. Typed file-ownership block parsing.**

When the typed block `impl-file-ownership` is detected, the block content is a set of lines. Feed each line starting with `|` to `parseFileOwnershipRow`. The existing `parseFileOwnershipRow` function signature is compatible — it takes a single line string plus the ownership map and col4 pointer.

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/protocol/... -count=1 -run TestParse
```

All 19 existing `TestParse*` tests must pass. Add new tests:
- `TestParseIMPLDoc_TypedBlockFileOwnership` — fixture with ` ```yaml type=impl-file-ownership ` block; verify `doc.FileOwnership` is populated
- `TestParseIMPLDoc_TypedBlockFallback` — fixture with heading-only format (no typed blocks); verify existing behavior unchanged
- `TestParseIMPLDoc_PreMortem` — fixture with `## Pre-Mortem` section including table; verify `doc.PreMortem.OverallRisk` and `doc.PreMortem.Rows`
- `TestParseIMPLDoc_TypedBlockDepGraph` — fixture with ` ```yaml type=impl-dep-graph `; verify `doc.DependencyGraphText` contains block content

### Agent A - Completion Report

**Status:** complete

**Files changed:**
- pkg/protocol/parser.go (modified, +278/-3 lines)
- pkg/protocol/parser_test.go (modified, +191/-0 lines)

**Interface deviations:** none

**Out of scope dependencies:** none

**Verification:**
- [x] Build passed: `go build ./...`
- [x] Vet passed: `go vet ./...`
- [x] Tests passed: `go test ./pkg/protocol/... -count=1 -run TestParse` (21/21)

**Commits:**
- 7564f1c: feat(parser): typed-block dispatch and PreMortem section parsing

**Notes:**
Typed-block dispatch uses a `readUntilClosingFence` helper that consumes the scanner lines so the main loop does not see the block interior. `hasTypedFileOwnership` and `hasTypedDepGraph` bool flags prevent heading-based fallback from overwriting typed-block results. `parsePreMortemSection` handles both `## Pre-Mortem` and `### Pre-Mortem` headings, extracts `**Overall risk:**` case-insensitively, and skips header/separator table rows. Returns nil when section is absent or empty.

```yaml type=impl-completion-report
status: complete
worktree: wave2-agent-A
branch: wave2-agent-A
commit: "7564f1c"
files_changed:
  - pkg/protocol/parser.go
  - pkg/protocol/parser_test.go
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added:
  - TestParseIMPLDoc_TypedBlockFileOwnership
  - TestParseIMPLDoc_TypedBlockFallback
  - TestParseIMPLDoc_PreMortem
  - TestParseIMPLDoc_TypedBlockDepGraph
verification: "go build ./... && go vet ./... && go test ./pkg/protocol/... -count=1 -run TestParse"
notes: "Typed-block dispatch via readUntilClosingFence helper; guard flags prevent heading fallback overwrite; parsePreMortemSection handles both ## and ### headings; 21/21 TestParse* pass"
```

---

### Agent B - ScoutValidating State Tests

**role:** implementer
**wave:** 2
**files_owned:**
- `pkg/types/types_test.go` (new file)

**task:**
You are adding unit tests for the `types` package. The Scaffold Agent has already added `ScoutValidating` to the `State` iota and `PreMortem`/`ValidationError` structs to `pkg/types/types.go`. Your job is to write tests that verify this is correct.

**Read these files before starting:**
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types.go` (confirm all scaffold additions are present)

**Create** `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types_test.go`:

Tests to write:

1. `TestStateString` — verify every `State` constant returns the expected string from `.String()`:
   - `ScoutPending` → `"ScoutPending"`
   - `ScoutValidating` → `"ScoutValidating"`
   - `NotSuitable` → `"NotSuitable"`
   - `Reviewed` → `"Reviewed"`
   - (continue for all remaining constants)

2. `TestStateOrdering` — verify `ScoutValidating` sits between `ScoutPending` and `NotSuitable`:
   ```go
   if !(ScoutPending < ScoutValidating && ScoutValidating < NotSuitable) {
       t.Errorf("ScoutValidating must be between ScoutPending and NotSuitable")
   }
   ```

3. `TestPreMortemZeroValue` — verify `PreMortem{}` has empty `OverallRisk` and nil `Rows` (zero-value safety).

4. `TestValidationErrorFields` — verify `ValidationError` fields can be set and read: `BlockType`, `LineNumber`, `Message`.

5. `TestIMPLDocPreMortemField` — verify `IMPLDoc` has a `PreMortem *PreMortem` field (set to a non-nil value and read it back).

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/types/... -count=1 -v
```

```yaml type=impl-completion-report
status: complete
worktree: wave2-agent-B
branch: wave2-agent-B
commit: "48e9500"
files_changed: []
files_created:
  - pkg/types/types_test.go
interface_deviations: none
out_of_scope_deps: []
tests_added:
  - TestStateString
  - TestStateOrdering
  - TestPreMortemZeroValue
  - TestValidationErrorFields
  - TestIMPLDocPreMortemField
verification: "go build ./... && go vet ./... && go test ./pkg/types/... -count=1 -v"
notes: "All 5 tests pass. TestStateString covers all 11 State constants including the Unknown fallback. ScoutValidating ordering verified. PreMortem and ValidationError zero-value and field access confirmed. IMPLDoc.PreMortem pointer field set and read successfully."
```

---

### Agent C - E16 Go Validator

**role:** implementer
**wave:** 2
**files_owned:**
- `pkg/protocol/validator.go` (new file)
- `pkg/protocol/validator_test.go` (new file)

**task:**
You are implementing the Go equivalent of the E16 bash validator (`validate-impl.sh`). This validator takes an IMPL doc path and returns a `[]types.ValidationError`.

**Read these files before starting:**
- `/Users/dayna.blackwell/code/scout-and-wave/implementations/claude-code/scripts/validate-impl.sh` — the reference implementation. Your Go code must produce equivalent errors for the same violations.
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types.go` — confirm `ValidationError` struct exists from scaffold.
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/protocol/parser.go` — understand the existing file I/O patterns and scanner usage.

**Create** `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/protocol/validator.go`:

```go
package protocol

// ValidateIMPLDoc runs E16 typed-block validation on the IMPL doc at path.
// It reads the file directly (not via ParseIMPLDoc) to preserve line numbers.
// Returns nil slice if all blocks are valid or no typed blocks exist.
// Returns one types.ValidationError per violation; multiple errors may be returned.
func ValidateIMPLDoc(path string) ([]types.ValidationError, error)
```

**Block detection:** Scan the file line by line. When a line matches the pattern ` ```yaml type=impl-{blockType} `, record the line number and extract the block content (lines until the closing ` ``` `). Dispatch to the appropriate validator:

**`impl-file-ownership` validation:**
- Must have a header row containing `| File ` substring
- Must have at least one data row (not header, not separator `|---|`)
- Each data row must have at least 4 pipe characters

**`impl-dep-graph` validation:**
- Must have at least one line matching `^Wave [0-9]+`
- Must have at least one line matching `\[[A-Z]\]`
- Each agent block (starting with `    [X]`) must contain either `✓ root` or `depends on:` in its associated lines

**`impl-wave-structure` validation:**
- Must have at least one line matching `^Wave [0-9]+:`
- Must have at least one `[A-Z]` agent reference

**`impl-completion-report` validation:**
- Must contain all required fields on their own lines: `status:`, `worktree:`, `branch:`, `commit:`, `files_changed:`, `interface_deviations:`, `verification:`
- `status:` value must be `complete`, `partial`, or `blocked` (not the template placeholder `complete | partial | blocked`)

**Error message format** must match the bash script's error message prefixes exactly:
- `"impl-file-ownership block (line N): missing header row — ..."`
- `"impl-dep-graph block (line N): missing 'Wave N (...):' header — ..."`
- etc.

**Create** `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/protocol/validator_test.go` with tests:

1. `TestValidateIMPLDoc_NoTypedBlocks` — file with no typed blocks returns nil, nil
2. `TestValidateIMPLDoc_ValidFileOwnership` — valid `impl-file-ownership` block passes
3. `TestValidateIMPLDoc_MissingFileOwnershipHeader` — missing header row returns one error with correct BlockType and LineNumber
4. `TestValidateIMPLDoc_MissingFileOwnershipDataRow` — header but no data rows returns error
5. `TestValidateIMPLDoc_ValidDepGraph` — valid `impl-dep-graph` block passes
6. `TestValidateIMPLDoc_DepGraphMissingWaveHeader` — returns error
7. `TestValidateIMPLDoc_AgentMissingRootOrDependsOn` — agent with neither `✓ root` nor `depends on:` returns error
8. `TestValidateIMPLDoc_ValidWaveStructure` — valid `impl-wave-structure` passes
9. `TestValidateIMPLDoc_ValidCompletionReport` — complete status, all required fields passes
10. `TestValidateIMPLDoc_CompletionReportBadStatus` — template placeholder status returns error
11. `TestValidateIMPLDoc_MultipleErrors` — fixture with two invalid blocks returns two errors

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/protocol/... -count=1 -run TestValidate
```

### Agent C - Completion Report

```yaml type=impl-completion-report
status: complete
worktree: wave2-agent-C
branch: wave2-agent-C
commit: "aab1824"
files_changed: []
files_created:
  - pkg/protocol/validator.go
  - pkg/protocol/validator_test.go
interface_deviations: none
out_of_scope_deps: []
tests_added:
  - TestValidateIMPLDoc_NoTypedBlocks
  - TestValidateIMPLDoc_ValidFileOwnership
  - TestValidateIMPLDoc_MissingFileOwnershipHeader
  - TestValidateIMPLDoc_MissingFileOwnershipDataRow
  - TestValidateIMPLDoc_ValidDepGraph
  - TestValidateIMPLDoc_DepGraphMissingWaveHeader
  - TestValidateIMPLDoc_AgentMissingRootOrDependsOn
  - TestValidateIMPLDoc_ValidWaveStructure
  - TestValidateIMPLDoc_ValidCompletionReport
  - TestValidateIMPLDoc_CompletionReportBadStatus
  - TestValidateIMPLDoc_MultipleErrors
verification: "go build ./... && go vet ./... && go test ./pkg/protocol/... -count=1 -run TestValidate"
notes: "Implemented ValidateIMPLDoc with line-by-line scanning and per-block validators matching bash script error message prefixes. One deviation from bash behavior: status validation explicitly rejects the template placeholder 'complete | partial | blocked' (bash silently accepts it via pipe-stripping). All 11 tests pass."
```

---

## Wave 3

Wave 3 launches after Agent A (parser) completes and is merged. Agents D and E run in parallel: D updates the API layer to surface `PreMortem` and fix `doc_status` casing; E adds the web UI `PreMortemPanel`.

### Agent D - API PreMortem & doc_status Casing

**role:** implementer
**wave:** 3
**files_owned:**
- `pkg/api/impl.go`
- `pkg/api/types.go`
- `pkg/api/server_test.go`

**task:**
You are updating the API layer for two changes: (1) surfacing the parsed `PreMortem` in the `GET /api/impl/{slug}` response, and (2) fixing `doc_status` casing from uppercase `"ACTIVE"`/`"COMPLETE"` to lowercase `"active"`/`"complete"` as the spec requires.

**Read these files before starting:**
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/impl.go`
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/types.go`
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/api/server_test.go`
- `/Users/dayna.blackwell/code/scout-and-wave-go/pkg/types/types.go` (confirm PreMortem type is present)

**Changes to `pkg/api/types.go`:**

Add two new types:

```go
// PreMortemRowEntry is one row of the pre-mortem risk table.
type PreMortemRowEntry struct {
    Scenario   string `json:"scenario"`
    Likelihood string `json:"likelihood"`
    Impact     string `json:"impact"`
    Mitigation string `json:"mitigation"`
}

// PreMortemEntry is the pre-mortem section in the IMPL doc response.
type PreMortemEntry struct {
    OverallRisk string              `json:"overall_risk"`
    Rows        []PreMortemRowEntry `json:"rows"`
}
```

Add `PreMortem *PreMortemEntry` to `IMPLDocResponse`:

```go
PreMortem *PreMortemEntry `json:"pre_mortem,omitempty"`
```

**Changes to `pkg/api/impl.go`:**

1. Fix `doc_status` casing in `handleListImpls`: change `"ACTIVE"` → `"active"` and `"COMPLETE"` → `"complete"` in the `implListEntry` construction. Also update `implListEntry.DocStatus` comment to say `"active" or "complete"`.

2. Fix `doc_status` casing in `handleGetImpl`: change `"ACTIVE"` → `"active"` and `"COMPLETE"` → `"complete"` in the `docStatus` variable assignment.

3. Add `PreMortem` mapping in `handleGetImpl` after the `Scaffold` field:

```go
PreMortem: mapPreMortem(doc.PreMortem),
```

4. Add helper function `mapPreMortem`:

```go
func mapPreMortem(pm *types.PreMortem) *PreMortemEntry {
    if pm == nil {
        return nil
    }
    rows := make([]PreMortemRowEntry, 0, len(pm.Rows))
    for _, r := range pm.Rows {
        rows = append(rows, PreMortemRowEntry{
            Scenario:   r.Scenario,
            Likelihood: r.Likelihood,
            Impact:     r.Impact,
            Mitigation: r.Mitigation,
        })
    }
    return &PreMortemEntry{
        OverallRisk: pm.OverallRisk,
        Rows:        rows,
    }
}
```

**Changes to `pkg/api/server_test.go`:**

Add or update tests:
- `TestHandleListImpls_DocStatusLowercase` — verify `doc_status` is `"active"` (not `"ACTIVE"`) for an active IMPL doc
- `TestHandleListImpls_DocStatusComplete` — verify `doc_status` is `"complete"` for an IMPL doc with `SAW:COMPLETE` tag
- `TestHandleGetImpl_PreMortem` — verify `pre_mortem` field is populated when `## Pre-Mortem` section is present and nil/absent when not
- `TestHandleGetImpl_DocStatus` — verify `doc_status` in GET /api/impl/{slug} response is lowercase

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go
go build ./...
go vet ./...
go test ./pkg/api/... -count=1
```

### Agent D - Completion Report

**Status:** complete

**Files changed:**
- pkg/api/types.go (modified, +16/-1 lines)
- pkg/api/impl.go (modified, +37/-6 lines)
- pkg/api/server_test.go (modified, +186/-0 lines)

**Interface deviations:** none

**Out of scope dependencies:** none

**Verification:**
- [x] Build passed: `go build ./...`
- [x] Vet passed: `go vet ./...`
- [x] Tests passed: `go test ./pkg/api/... -count=1` (19 tests, all pass)

**Commits:**
- ab4cef8: feat(api): surface PreMortem in response, fix doc_status to lowercase

**Notes:**
Added PreMortemRowEntry and PreMortemEntry types, wired PreMortem field into IMPLDocResponse, fixed doc_status casing from uppercase to lowercase in both list and get handlers, added mapPreMortem helper, and added all four required tests.

```yaml type=impl-completion-report
status: complete
worktree: wave3-agent-D
branch: wave3-agent-D
commit: "ab4cef8"
files_changed:
  - pkg/api/impl.go
  - pkg/api/types.go
  - pkg/api/server_test.go
files_created: []
interface_deviations: none
out_of_scope_deps: []
tests_added:
  - TestHandleListImpls_DocStatusLowercase
  - TestHandleListImpls_DocStatusComplete
  - TestHandleGetImpl_PreMortem
  - TestHandleGetImpl_DocStatus
verification: "go build ./... && go vet ./... && go test ./pkg/api/... -count=1"
notes: "Surfaced PreMortem in GET /api/impl/{slug} response; fixed doc_status casing to lowercase in both list and get handlers; added mapPreMortem helper and 4 new tests. All 19 tests pass."
```

---

### Agent E - Web UI PreMortem Panel & doc_status Casing

**role:** implementer
**wave:** 3
**files_owned:**
- `web/src/types.ts`
- `web/src/components/review/PreMortemPanel.tsx` (new file)
- `web/src/components/ReviewScreen.tsx`

**task:**
You are adding the `PreMortem` panel to the web UI review screen and updating TypeScript types to match the new API response shape (including lowercase `doc_status`).

**Read these files before starting:**
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/types.ts`
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/components/ReviewScreen.tsx`
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/components/review/KnownIssuesPanel.tsx` (use as a style reference for table panels)
- `/Users/dayna.blackwell/code/scout-and-wave-go/web/src/App.tsx` (check doc_status comparisons)

**Changes to `web/src/types.ts`:**

1. Add new interfaces after `ScaffoldFileEntry`:

```typescript
export interface PreMortemRow {
  scenario: string
  likelihood: string
  impact: string
  mitigation: string
}

export interface PreMortem {
  overall_risk: string  // "low", "medium", or "high"
  rows: PreMortemRow[]
}
```

2. Add to `IMPLDocResponse`:

```typescript
pre_mortem?: PreMortem
```

3. Update `IMPLListEntry` comment to note `doc_status` is lowercase:

```typescript
export interface IMPLListEntry {
  slug: string
  doc_status: string // "active" or "complete" (lowercase)
}
```

4. Search `App.tsx` for comparisons using `'COMPLETE'` or `'ACTIVE'` strings and update them to lowercase `'complete'` / `'active'`. The existing code at line 120-121 already uses lowercase — verify these do not need updating.

**Create `web/src/components/review/PreMortemPanel.tsx`:**

A panel component matching the visual style of existing review panels (e.g. `KnownIssuesPanel.tsx`). The panel must:
- Accept prop: `preMortem: PreMortem | undefined`
- When `preMortem` is undefined or has no rows, render a "No pre-mortem recorded" empty state
- Display `overall_risk` as a badge with color coding: green for "low", yellow for "medium", red for "high"
- Render `rows` as a responsive table with columns: Scenario | Likelihood | Impact | Mitigation
- Use Tailwind classes consistent with existing panels

**Changes to `web/src/components/ReviewScreen.tsx`:**

1. Import `PreMortemPanel` from `./review/PreMortemPanel`

2. Add `'pre-mortem'` to the `PanelKey` union type:
```typescript
type PanelKey = 'pre-mortem' | 'file-ownership' | 'wave-structure' | ...
```

3. Add to the `panels` array as the **first entry** (per roadmap spec: PreMortem renders first):
```typescript
{ key: 'pre-mortem', label: 'Pre-Mortem' },
```

4. Add case to the `activePanels.map` switch:
```typescript
case 'pre-mortem':
  return <PreMortemPanel key={key} preMortem={impl.pre_mortem} />
```

5. Update the default `activePanels` state to include `'pre-mortem'`:
```typescript
const [activePanels, setActivePanels] = useState<PanelKey[]>(
  ['pre-mortem', 'wave-structure', 'dependency-graph']
)
```

**Note on `doc_status` in App.tsx:** The existing App.tsx code at lines 120-121 already filters using lowercase `'COMPLETE'`. After Agent D changes the API to return lowercase, verify the App.tsx comparisons are aligned. Do not break the existing active/completed grouping logic.

**verification:**
```bash
cd /Users/dayna.blackwell/code/scout-and-wave-go/web
npm install
npm run build
```

Build must complete with no TypeScript errors. If the project has a test command (`npm test`), run it:
```bash
npm test -- --run 2>/dev/null || echo "no test runner configured"
```

### Agent E - Completion Report

**Status:** complete

**Files changed:**
- web/src/types.ts (modified, +14/-3 lines)
- web/src/components/ReviewScreen.tsx (modified, +6/-3 lines)

**Files created:**
- web/src/components/review/PreMortemPanel.tsx (new file, +71 lines)

**Interface deviations:** none

**Out of scope dependencies:**
- web/src/App.tsx line 120-121 filters entries using `e.doc_status !== 'COMPLETE'` and `=== 'COMPLETE'` (uppercase). After Agent D changes the API to return lowercase "complete", these comparisons will silently fail. App.tsx is not in Agent E's owned files. The IMPL doc notes "The existing code at App.tsx:120-121 already uses lowercase — verify carefully before closing" — but it does NOT use lowercase; it uses uppercase 'COMPLETE'. This must be fixed by the Orchestrator post-merge or assigned to Agent D.
- Suggested owner: Orchestrator post-merge (or Agent D if prompt is updated before launch)

**Verification:**
- [x] TypeScript type check passed: `node_modules/.bin/tsc --noEmit` (no errors)
- [x] Build passed: `node_modules/.bin/vite build` completed successfully
- [x] No test runner configured: `npm test -- --run` not available

**Commits:**
- de4163f: feat(web): add PreMortemPanel, update types for v0.10.0 protocol

```yaml type=impl-completion-report
status: complete
worktree: wave3-agent-E
branch: wave3-agent-E
commit: "de4163f"
files_changed:
  - web/src/types.ts
  - web/src/components/ReviewScreen.tsx
files_created:
  - web/src/components/review/PreMortemPanel.tsx
interface_deviations: none
out_of_scope_deps:
  - "web/src/App.tsx uses uppercase 'COMPLETE' in doc_status comparisons (lines 120-121); must be lowercased post-merge when API returns lowercase"
tests_added: []
verification: "cd web && node_modules/.bin/tsc --noEmit && node_modules/.bin/vite build"
notes: "PreMortemPanel created with risk badge (green/yellow/red) and responsive table. TypeScript and vite build both pass. App.tsx doc_status casing fix is out of scope and must be handled separately."
```

---

## Wave Execution Loop

After each wave completes, work through the Orchestrator Post-Merge Checklist below in order.

The merge procedure detail is in `saw-merge.md`. Key principles:
- Read completion reports first — a `status: partial` or `status: blocked` blocks the merge entirely. No partial merges.
- Interface deviations with `downstream_action_required: true` must be propagated to downstream agent prompts before that wave launches.
- Post-merge verification is the real gate. Agents pass in isolation; the merged codebase surfaces cross-package failures none of them saw individually.
- Fix before proceeding. Do not launch the next wave with a broken build.

---

## Orchestrator Post-Merge Checklist

After Wave 0 (Scaffold) completes:

- [ ] Read Scaffold Agent completion report — confirm `status: complete`; if `partial` or `blocked`, stop and resolve before merging
- [ ] Conflict prediction — only `pkg/types/types.go` changes; no conflicts expected
- [ ] Merge: `git merge --no-ff wave0-scaffold -m "Merge wave0-scaffold: add PreMortem, ValidationError types, ScoutValidating state"`
- [ ] Worktree cleanup: `git worktree remove <path>` + `git branch -d wave0-scaffold`
- [ ] Post-merge verification:
      - [ ] Linter auto-fix pass: n/a (no golangci-lint configured; `go vet` is check-mode only)
      - [ ] `go build ./... && go vet ./... && go test -race -count=1 ./...`
- [ ] Fix any cascade failures (none expected — only new types added)
- [ ] Tick status checkbox for Scaffold in Status table below
- [ ] Launch Wave 2: agents A, B, C in parallel

After Wave 2 (A + B + C) completes:

- [ ] Read completion reports for A, B, C — all must show `status: complete`
- [ ] Conflict prediction — A owns `parser.go` + `parser_test.go`; B owns `types_test.go`; C owns `validator.go` + `validator_test.go`; no overlap
- [ ] Review `interface_deviations` from Agent A — if parser's `PreMortem` field shape deviates from spec, update Agent D's prompt before launching Wave 3
- [ ] Merge Agent A: `git merge --no-ff wave2-agent-a -m "Merge wave2-agent-a: typed-block dispatch and PreMortem parsing"`
- [ ] Merge Agent B: `git merge --no-ff wave2-agent-b -m "Merge wave2-agent-b: types package tests"`
- [ ] Merge Agent C: `git merge --no-ff wave2-agent-c -m "Merge wave2-agent-c: E16 Go validator"`
- [ ] Worktree cleanup for A, B, C
- [ ] Post-merge verification:
      - [ ] `go build ./... && go vet ./... && go test -race -count=1 ./...`
- [ ] Fix any cascade failures — `pkg/api/impl.go` references `doc.PreMortem` which did not exist before; if it fails to compile, the Agent D prompt must note the field is now available
- [ ] Tick status checkboxes for A, B, C
- [ ] Launch Wave 3: agents D and E in parallel

After Wave 3 (D + E) completes:

- [ ] Read completion reports for D and E — both must show `status: complete`
- [ ] Conflict prediction — D owns `pkg/api/{impl.go,types.go,server_test.go}`; E owns `web/src/` files; no overlap
- [ ] Merge Agent D: `git merge --no-ff wave3-agent-d -m "Merge wave3-agent-d: API PreMortem and doc_status casing"`
- [ ] Merge Agent E: `git merge --no-ff wave3-agent-e -m "Merge wave3-agent-e: PreMortemPanel and web UI updates"`
- [ ] Worktree cleanup for D and E
- [ ] Post-merge verification:
      - [ ] `go build ./... && go vet ./... && go test -race -count=1 ./...`
      - [ ] `cd web && npm install && npm run build`
- [ ] Feature-specific steps:
      - [ ] Verify `GET /api/impl/{slug}` returns `doc_status: "active"` (lowercase) for an active doc
      - [ ] Verify `GET /api/impl` list returns `doc_status: "active"` and `"complete"` (lowercase)
      - [ ] Verify web UI picker renders active/complete grouping correctly with lowercase values
      - [ ] Verify PreMortem panel appears first in the review toggle bar
      - [ ] Smoke-test `ValidateIMPLDoc` on this IMPL doc: `go run -v . validate docs/IMPL/IMPL-typed-block-parser.md` (if CLI has validate subcommand; otherwise run the test suite)
- [ ] Commit: `git commit -m "feat: v0.10.0 protocol support — typed-block parser, PreMortem, ScoutValidating, E16 validator"`
- [ ] Tick status checkboxes for D, E, Orch

---

## Cascade Candidates

Files that will NOT be changed but reference interfaces whose semantics change:

- `pkg/api/impl.go` — calls `doc.DocStatus` which existed; no new import needed. Cascade risk: if `doc.PreMortem` field is nil (because Agent A is not merged yet), the `mapPreMortem(nil)` call must handle nil gracefully. Agents D's `mapPreMortem` function handles this.
- `web/src/App.tsx` — filters by `e.doc_status === 'COMPLETE'` at line 121. After Agent D changes the API to return lowercase `"complete"`, this comparison will silently fail (never matches). **Agent E must audit and fix this.** The existing code at App.tsx:120-121 already uses lowercase — verify carefully before closing.
- `pkg/protocol/updater.go` — if this file calls `ParseIMPLDoc` and uses `doc.Waves` or `doc.FileOwnership`, it should continue to work because the typed-block parser populates the same fields. No change needed, but verify during post-merge.
- `pkg/api/wave_runner.go` — consumes `types.State`; `ScoutValidating` insertion shifts the iota values of all subsequent constants by 1. Any code that uses raw integer comparisons (e.g. `state == 2`) would break. Grep confirmed no raw integer state comparisons exist in the codebase.

---

## Status

| Wave | Agent | Description | Status |
|------|-------|-------------|--------|
| 0 | Scaffold | Add PreMortem, ValidationError types; ScoutValidating state to pkg/types/types.go | DONE |
| 2 | A | Typed-block dispatch in parser; PreMortem section parsing; new parser tests | DONE |
| 2 | B | Unit tests for ScoutValidating state and new types in pkg/types | DONE |
| 2 | C | E16 Go validator (pkg/protocol/validator.go) + tests | DONE |
| 3 | D | API: PreMortem in response, doc_status lowercase, server tests | DONE |
| 3 | E | Web UI: PreMortemPanel, ReviewScreen integration, types.ts update | DONE |
| — | Orch | Post-merge verification, doc_status smoke test, binary build | DONE |
