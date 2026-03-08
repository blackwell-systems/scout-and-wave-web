package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

// writeTempFile creates a temp file with the given content and returns its path.
func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "IMPL-test.md")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writeTempFile: %v", err)
	}
	return path
}

// TestValidateIMPLDoc_NoTypedBlocks verifies that a file with no typed blocks
// returns nil, nil.
func TestValidateIMPLDoc_NoTypedBlocks(t *testing.T) {
	content := `# IMPL: My Feature

## Wave 1

### Agent A: Do something

Just some text, no typed blocks.
`
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if errs != nil {
		t.Fatalf("expected nil errors for file with no typed blocks, got: %v", errs)
	}
}

// TestValidateIMPLDoc_ValidFileOwnership verifies that a well-formed
// impl-file-ownership block passes with no errors.
func TestValidateIMPLDoc_ValidFileOwnership(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-file-ownership\n" +
		"| File | Agent | Wave | Depends On |\n" +
		"|------|-------|------|------------|\n" +
		"| pkg/foo/bar.go | A | 1 | — |\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no errors for valid file-ownership block, got: %v", errs)
	}
}

// TestValidateIMPLDoc_MissingFileOwnershipHeader verifies that a block missing
// the header row returns one error with the correct BlockType and LineNumber.
func TestValidateIMPLDoc_MissingFileOwnershipHeader(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-file-ownership\n" + // line 3
		"| pkg/foo/bar.go | A | 1 | — |\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 1 {
		t.Fatalf("expected 1 error, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-file-ownership" {
		t.Errorf("expected BlockType 'impl-file-ownership', got %q", errs[0].BlockType)
	}
	if errs[0].LineNumber != 3 {
		t.Errorf("expected LineNumber 3, got %d", errs[0].LineNumber)
	}
}

// TestValidateIMPLDoc_MissingFileOwnershipDataRow verifies that a block with a
// header but no data rows returns one error.
func TestValidateIMPLDoc_MissingFileOwnershipDataRow(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-file-ownership\n" + // line 3
		"| File | Agent | Wave | Depends On |\n" +
		"|------|-------|------|------------|\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 1 {
		t.Fatalf("expected 1 error, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-file-ownership" {
		t.Errorf("expected BlockType 'impl-file-ownership', got %q", errs[0].BlockType)
	}
}

// TestValidateIMPLDoc_ValidDepGraph verifies that a well-formed impl-dep-graph
// block passes with no errors.
func TestValidateIMPLDoc_ValidDepGraph(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-dep-graph\n" +
		"Wave 1 (parallel):\n" +
		"    [A] pkg/foo/bar.go\n" +
		"        ✓ root\n" +
		"    [B] pkg/foo/baz.go\n" +
		"        ✓ root\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no errors for valid dep-graph block, got: %v", errs)
	}
}

// TestValidateIMPLDoc_DepGraphMissingWaveHeader verifies that a dep-graph block
// without any "Wave N" header returns an error.
func TestValidateIMPLDoc_DepGraphMissingWaveHeader(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-dep-graph\n" + // line 3
		"    [A] pkg/foo/bar.go\n" +
		"        ✓ root\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 1 {
		t.Fatalf("expected 1 error, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-dep-graph" {
		t.Errorf("expected BlockType 'impl-dep-graph', got %q", errs[0].BlockType)
	}
	if errs[0].LineNumber != 3 {
		t.Errorf("expected LineNumber 3, got %d", errs[0].LineNumber)
	}
}

// TestValidateIMPLDoc_AgentMissingRootOrDependsOn verifies that an agent with
// neither "✓ root" nor "depends on:" returns an error.
func TestValidateIMPLDoc_AgentMissingRootOrDependsOn(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-dep-graph\n" + // line 3
		"Wave 1 (parallel):\n" +
		"    [A] pkg/foo/bar.go\n" +
		"        ✓ root\n" +
		"    [B] pkg/foo/baz.go\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 1 {
		t.Fatalf("expected 1 error for agent B missing root/depends, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-dep-graph" {
		t.Errorf("expected BlockType 'impl-dep-graph', got %q", errs[0].BlockType)
	}
}

// TestValidateIMPLDoc_ValidWaveStructure verifies that a well-formed
// impl-wave-structure block passes with no errors.
func TestValidateIMPLDoc_ValidWaveStructure(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-wave-structure\n" +
		"Wave 1: [A] [B]\n" +
		"Wave 2: [C]\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no errors for valid wave-structure block, got: %v", errs)
	}
}

// TestValidateIMPLDoc_ValidCompletionReport verifies that a complete-status
// report with all required fields passes with no errors.
func TestValidateIMPLDoc_ValidCompletionReport(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-completion-report\n" +
		"status: complete\n" +
		"worktree: wave1-agent-A\n" +
		"branch: wave1-agent-A\n" +
		"commit: \"abc1234\"\n" +
		"files_changed: []\n" +
		"interface_deviations: none\n" +
		"verification: go build ./...\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no errors for valid completion report, got: %v", errs)
	}
}

// TestValidateIMPLDoc_CompletionReportBadStatus verifies that the template
// placeholder status returns an error.
func TestValidateIMPLDoc_CompletionReportBadStatus(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-completion-report\n" + // line 3
		"status: complete | partial | blocked\n" +
		"worktree: wave1-agent-A\n" +
		"branch: wave1-agent-A\n" +
		"commit: \"abc1234\"\n" +
		"files_changed: []\n" +
		"interface_deviations: none\n" +
		"verification: go build ./...\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 1 {
		t.Fatalf("expected 1 error for bad status, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-completion-report" {
		t.Errorf("expected BlockType 'impl-completion-report', got %q", errs[0].BlockType)
	}
}

// TestValidateIMPLDoc_MultipleErrors verifies that a fixture with two invalid
// blocks returns two errors (one per block).
func TestValidateIMPLDoc_MultipleErrors(t *testing.T) {
	content := "# IMPL: Test\n\n" +
		"```yaml type=impl-file-ownership\n" + // line 3 — no header row
		"| pkg/foo/bar.go | A | 1 | — |\n" +
		"```\n\n" +
		"```yaml type=impl-wave-structure\n" + // line 7 — no Wave N: lines
		"just some text\n" +
		"```\n"
	path := writeTempFile(t, content)
	errs, err := ValidateIMPLDoc(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(errs) != 2 {
		t.Fatalf("expected 2 errors for two invalid blocks, got %d: %v", len(errs), errs)
	}
	if errs[0].BlockType != "impl-file-ownership" {
		t.Errorf("expected first error BlockType 'impl-file-ownership', got %q", errs[0].BlockType)
	}
	if errs[1].BlockType != "impl-wave-structure" {
		t.Errorf("expected second error BlockType 'impl-wave-structure', got %q", errs[1].BlockType)
	}
}
