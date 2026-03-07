package protocol

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// ── fixture helpers ───────────────────────────────────────────────────────────

// writeTmpFile writes content to a temporary file and returns its path.
func writeTmpFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "IMPL-test.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writeTmpFile: %v", err)
	}
	return path
}

// ── minimal valid fixture ─────────────────────────────────────────────────────

const minimalIMPL = `# IMPL: Test Feature

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |
| pkg/bar/bar.go | B | 1 | — |

## Wave 1

### Agent A: Implement foo

#### 1. File Ownership

- pkg/foo/foo.go

Goal: implement foo.

### Agent B: Implement bar

#### 1. File Ownership

- pkg/bar/bar.go

Goal: implement bar.
`

// ── TestParseIMPLDoc_BasicStructure ──────────────────────────────────────────

func TestParseIMPLDoc_BasicStructure(t *testing.T) {
	path := writeTmpFile(t, minimalIMPL)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.FeatureName != "Test Feature" {
		t.Errorf("FeatureName = %q; want %q", doc.FeatureName, "Test Feature")
	}
	if len(doc.Waves) != 1 {
		t.Fatalf("wave count = %d; want 1", len(doc.Waves))
	}
	if doc.Waves[0].Number != 1 {
		t.Errorf("Wave.Number = %d; want 1", doc.Waves[0].Number)
	}
	if len(doc.Waves[0].Agents) != 2 {
		t.Errorf("agent count in Wave 1 = %d; want 2", len(doc.Waves[0].Agents))
	}
}

// ── TestParseIMPLDoc_FileOwnership ───────────────────────────────────────────

func TestParseIMPLDoc_FileOwnership(t *testing.T) {
	path := writeTmpFile(t, minimalIMPL)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	tests := []struct {
		file  string
		agent string
	}{
		{"pkg/foo/foo.go", "A"},
		{"pkg/bar/bar.go", "B"},
	}
	for _, tc := range tests {
		got, ok := doc.FileOwnership[tc.file]
		if !ok {
			t.Errorf("FileOwnership[%q] not found", tc.file)
			continue
		}
		if got.Agent != tc.agent {
			t.Errorf("FileOwnership[%q].Agent = %q; want %q", tc.file, got.Agent, tc.agent)
		}
	}
}

// ── TestParseIMPLDoc_AgentPrompts ─────────────────────────────────────────────

func TestParseIMPLDoc_AgentPrompts(t *testing.T) {
	path := writeTmpFile(t, minimalIMPL)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(doc.Waves) == 0 {
		t.Fatal("no waves parsed")
	}
	agents := doc.Waves[0].Agents
	if len(agents) < 2 {
		t.Fatalf("expected 2 agents, got %d", len(agents))
	}

	// Agent A
	agentA := agents[0]
	if agentA.Letter != "A" {
		t.Errorf("agents[0].Letter = %q; want %q", agentA.Letter, "A")
	}
	if len(agentA.FilesOwned) == 0 {
		t.Error("Agent A: FilesOwned is empty")
	} else if agentA.FilesOwned[0] != "pkg/foo/foo.go" {
		t.Errorf("Agent A FilesOwned[0] = %q; want %q", agentA.FilesOwned[0], "pkg/foo/foo.go")
	}
	if !strings.Contains(agentA.Prompt, "foo") {
		t.Errorf("Agent A prompt does not mention 'foo': %q", agentA.Prompt)
	}

	// Agent B
	agentB := agents[1]
	if agentB.Letter != "B" {
		t.Errorf("agents[1].Letter = %q; want %q", agentB.Letter, "B")
	}
	if len(agentB.FilesOwned) == 0 {
		t.Error("Agent B: FilesOwned is empty")
	} else if agentB.FilesOwned[0] != "pkg/bar/bar.go" {
		t.Errorf("Agent B FilesOwned[0] = %q; want %q", agentB.FilesOwned[0], "pkg/bar/bar.go")
	}
}

// ── TestParseIMPLDoc_MissingFile ─────────────────────────────────────────────

func TestParseIMPLDoc_MissingFile(t *testing.T) {
	_, err := ParseIMPLDoc("/nonexistent/path/IMPL.md")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// ── TestValidateInvariants_Clean ─────────────────────────────────────────────

func TestValidateInvariants_Clean(t *testing.T) {
	doc := &types.IMPLDoc{
		Waves: []types.Wave{
			{
				Number: 1,
				Agents: []types.AgentSpec{
					{Letter: "A", FilesOwned: []string{"pkg/foo/foo.go", "pkg/foo/foo_test.go"}},
					{Letter: "B", FilesOwned: []string{"pkg/bar/bar.go"}},
				},
			},
		},
	}
	if err := ValidateInvariants(doc); err != nil {
		t.Errorf("expected no violation, got: %v", err)
	}
}

// ── TestValidateInvariants_Conflict ──────────────────────────────────────────

func TestValidateInvariants_Conflict(t *testing.T) {
	doc := &types.IMPLDoc{
		Waves: []types.Wave{
			{
				Number: 1,
				Agents: []types.AgentSpec{
					{Letter: "A", FilesOwned: []string{"pkg/shared/types.go"}},
					{Letter: "B", FilesOwned: []string{"pkg/shared/types.go"}},
				},
			},
		},
	}
	err := ValidateInvariants(doc)
	if err == nil {
		t.Fatal("expected I1 violation error, got nil")
	}
	if !strings.Contains(err.Error(), "I1 violation") {
		t.Errorf("error message should mention I1 violation; got: %v", err)
	}
	if !strings.Contains(err.Error(), "pkg/shared/types.go") {
		t.Errorf("error message should mention the conflicting file; got: %v", err)
	}
}

// ── completion report fixtures ────────────────────────────────────────────────

const implWithCompleteReport = `# IMPL: Demo

## Wave 1

### Agent A: Implement something

Some prompt text.

### Agent A - Completion Report

` + "```yaml" + `
status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: abc1234
files_changed: []
files_created:
  - pkg/protocol/parser.go
interface_deviations: []
out_of_scope_deps: []
tests_added:
  - TestFoo
verification: PASS
` + "```" + `
`

const implWithBlockedReport = `# IMPL: Demo

## Wave 1

### Agent B: Implement something else

Some prompt text.

### Agent B - Completion Report

` + "```yaml" + `
status: blocked
worktree: .claude/worktrees/wave1-agent-B
branch: wave1-agent-B
commit: ""
files_changed: []
files_created: []
interface_deviations:
  - description: "Cannot implement Foo without Bar"
    downstream_action_required: true
    affects:
      - C
      - D
out_of_scope_deps:
  - pkg/other/file.go needs update
tests_added: []
verification: FAIL
` + "```" + `
`

const implNoReport = `# IMPL: Demo

## Wave 1

### Agent C: Implement something else

Prompt only, no completion report yet.
`

// ── TestParseIMPLDoc_LintCommandBold ──────────────────────────────────────────

func TestParseIMPLDoc_LintCommandBold(t *testing.T) {
	content := `# IMPL: Test Feature

**Lint Command:** ` + "`go vet ./...`" + `

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.LintCommand != "go vet ./..." {
		t.Errorf("LintCommand = %q; want %q", doc.LintCommand, "go vet ./...")
	}
}

// ── TestParseIMPLDoc_LintCommandPlain ─────────────────────────────────────────

func TestParseIMPLDoc_LintCommandPlain(t *testing.T) {
	content := `# IMPL: Test Feature

lint_command: go vet ./...

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.LintCommand != "go vet ./..." {
		t.Errorf("LintCommand = %q; want %q", doc.LintCommand, "go vet ./...")
	}
}

// ── TestParseIMPLDoc_LintCommandEmpty ─────────────────────────────────────────

func TestParseIMPLDoc_LintCommandEmpty(t *testing.T) {
	content := `# IMPL: Test Feature

**Test Command:** ` + "`go test ./...`" + `

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.LintCommand != "" {
		t.Errorf("LintCommand = %q; want empty string", doc.LintCommand)
	}
}

// ── TestParseIMPLDoc_LintCommandStripped ──────────────────────────────────────

func TestParseIMPLDoc_LintCommandStripped(t *testing.T) {
	content := `# IMPL: Test Feature

Lint Command: ` + "`golangci-lint run ./...`" + `

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.LintCommand != "golangci-lint run ./..." {
		t.Errorf("LintCommand = %q; want %q", doc.LintCommand, "golangci-lint run ./...")
	}
}

// ── TestParseCompletionReport_Complete ───────────────────────────────────────

func TestParseCompletionReport_Complete(t *testing.T) {
	path := writeTmpFile(t, implWithCompleteReport)
	report, err := ParseCompletionReport(path, "A")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.Status != types.StatusComplete {
		t.Errorf("Status = %q; want %q", report.Status, types.StatusComplete)
	}
	if report.Commit != "abc1234" {
		t.Errorf("Commit = %q; want %q", report.Commit, "abc1234")
	}
	if report.Verification != "PASS" {
		t.Errorf("Verification = %q; want %q", report.Verification, "PASS")
	}
	if len(report.FilesCreated) != 1 || report.FilesCreated[0] != "pkg/protocol/parser.go" {
		t.Errorf("FilesCreated = %v; want [pkg/protocol/parser.go]", report.FilesCreated)
	}
	if len(report.TestsAdded) != 1 || report.TestsAdded[0] != "TestFoo" {
		t.Errorf("TestsAdded = %v; want [TestFoo]", report.TestsAdded)
	}
}

// ── TestParseCompletionReport_NotFound ───────────────────────────────────────

func TestParseCompletionReport_NotFound(t *testing.T) {
	path := writeTmpFile(t, implNoReport)
	_, err := ParseCompletionReport(path, "A")
	if err == nil {
		t.Fatal("expected ErrReportNotFound, got nil")
	}
	if !errors.Is(err, ErrReportNotFound) {
		t.Errorf("expected ErrReportNotFound; got: %v", err)
	}
}

// ── TestParseCompletionReport_Blocked ────────────────────────────────────────

func TestParseCompletionReport_Blocked(t *testing.T) {
	path := writeTmpFile(t, implWithBlockedReport)
	report, err := ParseCompletionReport(path, "B")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report.Status != types.StatusBlocked {
		t.Errorf("Status = %q; want %q", report.Status, types.StatusBlocked)
	}
	if report.Verification != "FAIL" {
		t.Errorf("Verification = %q; want %q", report.Verification, "FAIL")
	}
	if len(report.InterfaceDeviations) != 1 {
		t.Fatalf("InterfaceDeviations count = %d; want 1", len(report.InterfaceDeviations))
	}
	dev := report.InterfaceDeviations[0]
	if !dev.DownstreamActionRequired {
		t.Error("DownstreamActionRequired should be true")
	}
	if len(dev.Affects) != 2 {
		t.Errorf("Affects = %v; want [C D]", dev.Affects)
	}
	if len(report.OutOfScopeDeps) == 0 {
		t.Error("OutOfScopeDeps should not be empty")
	}
}

// ── TestParseIMPLDoc_KnownIssues_None ────────────────────────────────────────

func TestParseIMPLDoc_KnownIssues_None(t *testing.T) {
	content := `# IMPL: Test Feature

### Known Issues

None identified.

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(doc.KnownIssues) != 0 {
		t.Errorf("KnownIssues = %d items; want 0 (none identified)", len(doc.KnownIssues))
	}
}

// ── TestParseIMPLDoc_KnownIssues_WithText ────────────────────────────────────

func TestParseIMPLDoc_KnownIssues_WithText(t *testing.T) {
	content := `# IMPL: Test Feature

### Known Issues

The existing parser does not handle nested code blocks correctly.

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(doc.KnownIssues) != 1 {
		t.Fatalf("KnownIssues count = %d; want 1", len(doc.KnownIssues))
	}
	if !strings.Contains(doc.KnownIssues[0].Description, "nested code blocks") {
		t.Errorf("KnownIssues[0].Description = %q; want text about nested code blocks", doc.KnownIssues[0].Description)
	}
}

// ── TestParseIMPLDoc_ScaffoldsDetail ─────────────────────────────────────────

func TestParseIMPLDoc_ScaffoldsDetail(t *testing.T) {
	content := `# IMPL: Test Feature

### Scaffolds

| File | Contents | Import path | Status |
|------|----------|-------------|--------|
` + "| `pkg/types/types.go` | Interface definitions | `github.com/example/pkg/types` | committed |" + `
` + "| `pkg/api/api.go` | API contract | `github.com/example/pkg/api` | pending |" + `

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(doc.ScaffoldsDetail) != 2 {
		t.Fatalf("ScaffoldsDetail count = %d; want 2", len(doc.ScaffoldsDetail))
	}
	if doc.ScaffoldsDetail[0].FilePath != "pkg/types/types.go" {
		t.Errorf("ScaffoldsDetail[0].FilePath = %q; want %q", doc.ScaffoldsDetail[0].FilePath, "pkg/types/types.go")
	}
	if doc.ScaffoldsDetail[0].ImportPath != "github.com/example/pkg/types" {
		t.Errorf("ScaffoldsDetail[0].ImportPath = %q; want %q", doc.ScaffoldsDetail[0].ImportPath, "github.com/example/pkg/types")
	}
	if doc.ScaffoldsDetail[1].FilePath != "pkg/api/api.go" {
		t.Errorf("ScaffoldsDetail[1].FilePath = %q; want %q", doc.ScaffoldsDetail[1].FilePath, "pkg/api/api.go")
	}
}

// ── TestParseIMPLDoc_InterfaceContracts ──────────────────────────────────────

func TestParseIMPLDoc_InterfaceContracts(t *testing.T) {
	content := `# IMPL: Test Feature

### Interface Contracts

#### Backend interface

` + "```go" + `
type Backend interface {
    Run(ctx context.Context) error
}
` + "```" + `

All agents must implement this interface.

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.InterfaceContractsText == "" {
		t.Fatal("InterfaceContractsText is empty")
	}
	if !strings.Contains(doc.InterfaceContractsText, "Backend interface") {
		t.Errorf("InterfaceContractsText does not contain 'Backend interface': %q", doc.InterfaceContractsText)
	}
	if !strings.Contains(doc.InterfaceContractsText, "```go") {
		t.Errorf("InterfaceContractsText does not preserve code fences: %q", doc.InterfaceContractsText)
	}
	if !strings.Contains(doc.InterfaceContractsText, "Run(ctx context.Context)") {
		t.Errorf("InterfaceContractsText does not contain interface method: %q", doc.InterfaceContractsText)
	}
}

// ── TestParseIMPLDoc_DependencyGraph ─────────────────────────────────────────

func TestParseIMPLDoc_DependencyGraph(t *testing.T) {
	content := `# IMPL: Test Feature

### Dependency Graph

` + "```" + `
scaffold --> Wave 1 [A, B]
Wave 1   --> Wave 2 [C]
` + "```" + `

Roots: scaffold
Leaves: C

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.DependencyGraphText == "" {
		t.Fatal("DependencyGraphText is empty")
	}
	if !strings.Contains(doc.DependencyGraphText, "scaffold --> Wave 1") {
		t.Errorf("DependencyGraphText does not contain expected content: %q", doc.DependencyGraphText)
	}
	if !strings.Contains(doc.DependencyGraphText, "Roots: scaffold") {
		t.Errorf("DependencyGraphText should preserve prose after code fence: %q", doc.DependencyGraphText)
	}
}

// ── TestParseIMPLDoc_PostMergeChecklist ──────────────────────────────────────

func TestParseIMPLDoc_PostMergeChecklist(t *testing.T) {
	content := `# IMPL: Test Feature

### Orchestrator Post-Merge Checklist

**After Wave 1 completes:**

- [ ] Read Agent A completion report
- [ ] Merge Agent A
- [ ] Run verification: ` + "`go test ./...`" + `

---

### File Ownership

| file | agent-letter | wave | depends-on |
|------|-------------|------|------------|
| pkg/foo/foo.go | A | 1 | — |

## Wave 1

### Agent A: Implement foo

Goal: implement foo.
`
	path := writeTmpFile(t, content)
	doc, err := ParseIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if doc.PostMergeChecklistText == "" {
		t.Fatal("PostMergeChecklistText is empty")
	}
	if !strings.Contains(doc.PostMergeChecklistText, "After Wave 1 completes") {
		t.Errorf("PostMergeChecklistText does not contain expected header: %q", doc.PostMergeChecklistText)
	}
	if !strings.Contains(doc.PostMergeChecklistText, "Read Agent A completion report") {
		t.Errorf("PostMergeChecklistText does not contain checklist items: %q", doc.PostMergeChecklistText)
	}
}

