package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

func TestRunSetCompletion_MissingArgs(t *testing.T) {
	// No args.
	err := runSetCompletion([]string{})
	if err == nil {
		t.Fatal("expected error when args are missing, got nil")
	}
	if !strings.Contains(err.Error(), "required") {
		t.Errorf("expected error to contain %q, got: %v", "required", err)
	}

	// Only one arg.
	err = runSetCompletion([]string{"manifest.yaml"})
	if err == nil {
		t.Fatal("expected error when agent-id is missing, got nil")
	}
	if !strings.Contains(err.Error(), "required") {
		t.Errorf("expected error to contain %q, got: %v", "required", err)
	}
}

func TestRunSetCompletion_InvalidStatus(t *testing.T) {
	// Create a temporary manifest.
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	// Create a minimal manifest with one wave and one agent.
	manifest := &protocol.IMPLManifest{
		Title:       "Test Feature",
		FeatureSlug: "test-feature",
		Waves: []protocol.Wave{
			{
				Number: 1,
				Agents: []protocol.Agent{
					{ID: "A", Task: "Test agent"},
				},
			},
		},
	}

	if err := protocol.Save(manifest, manifestPath); err != nil {
		t.Fatalf("failed to create test manifest: %v", err)
	}

	// Create a YAML with invalid status.
	yamlContent := `status: invalid_status
branch: test-branch
commit: abc123
`
	stdinPath := filepath.Join(tmpDir, "stdin.yaml")
	if err := os.WriteFile(stdinPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write stdin file: %v", err)
	}

	// Redirect stdin.
	oldStdin := os.Stdin
	defer func() { os.Stdin = oldStdin }()
	stdinFile, err := os.Open(stdinPath)
	if err != nil {
		t.Fatalf("failed to open stdin file: %v", err)
	}
	defer stdinFile.Close()
	os.Stdin = stdinFile

	// Run set-completion.
	err = runSetCompletion([]string{manifestPath, "A"})
	if err == nil {
		t.Fatal("expected error for invalid status, got nil")
	}
	if !strings.Contains(err.Error(), "invalid status") {
		t.Errorf("expected error to contain %q, got: %v", "invalid status", err)
	}
}

func TestRunSetCompletion_AgentNotFound(t *testing.T) {
	// Create a temporary manifest.
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	// Create a minimal manifest with one wave and one agent.
	manifest := &protocol.IMPLManifest{
		Title:       "Test Feature",
		FeatureSlug: "test-feature",
		Waves: []protocol.Wave{
			{
				Number: 1,
				Agents: []protocol.Agent{
					{ID: "A", Task: "Test agent"},
				},
			},
		},
	}

	if err := protocol.Save(manifest, manifestPath); err != nil {
		t.Fatalf("failed to create test manifest: %v", err)
	}

	// Create a valid YAML for a non-existent agent.
	yamlContent := `status: complete
branch: test-branch
commit: abc123
`
	stdinPath := filepath.Join(tmpDir, "stdin.yaml")
	if err := os.WriteFile(stdinPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write stdin file: %v", err)
	}

	// Redirect stdin.
	oldStdin := os.Stdin
	defer func() { os.Stdin = oldStdin }()
	stdinFile, err := os.Open(stdinPath)
	if err != nil {
		t.Fatalf("failed to open stdin file: %v", err)
	}
	defer stdinFile.Close()
	os.Stdin = stdinFile

	// Run set-completion with a non-existent agent ID.
	err = runSetCompletion([]string{manifestPath, "Z"})
	if err == nil {
		t.Fatal("expected error for non-existent agent, got nil")
	}
	// The protocol package should return ErrAgentNotFound.
	if !strings.Contains(err.Error(), "agent") && !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected error to mention agent not found, got: %v", err)
	}
}

func TestRunSetCompletion_Success(t *testing.T) {
	// Create a temporary manifest.
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	// Create a minimal manifest with one wave and one agent.
	manifest := &protocol.IMPLManifest{
		Title:       "Test Feature",
		FeatureSlug: "test-feature",
		Waves: []protocol.Wave{
			{
				Number: 1,
				Agents: []protocol.Agent{
					{ID: "A", Task: "Test agent"},
				},
			},
		},
	}

	if err := protocol.Save(manifest, manifestPath); err != nil {
		t.Fatalf("failed to create test manifest: %v", err)
	}

	// Create a valid YAML completion report.
	yamlContent := `status: complete
worktree: .claude/worktrees/wave1-agent-A
branch: wave1-agent-A
commit: abc123def456
files_changed:
  - cmd/saw/completion.go
  - cmd/saw/completion_test.go
tests_added:
  - TestRunSetCompletion
verification: PASS (go test)
`
	stdinPath := filepath.Join(tmpDir, "stdin.yaml")
	if err := os.WriteFile(stdinPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write stdin file: %v", err)
	}

	// Redirect stdin.
	oldStdin := os.Stdin
	defer func() { os.Stdin = oldStdin }()
	stdinFile, err := os.Open(stdinPath)
	if err != nil {
		t.Fatalf("failed to open stdin file: %v", err)
	}
	defer stdinFile.Close()
	os.Stdin = stdinFile

	// Run set-completion.
	err = runSetCompletion([]string{manifestPath, "A"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the manifest was updated.
	updatedManifest, err := protocol.Load(manifestPath)
	if err != nil {
		t.Fatalf("failed to load updated manifest: %v", err)
	}

	report, found := updatedManifest.CompletionReports["A"]
	if !found {
		t.Fatal("completion report for agent A not found in manifest")
	}

	if report.Status != "complete" {
		t.Errorf("expected status %q, got %q", "complete", report.Status)
	}
	if report.Branch != "wave1-agent-A" {
		t.Errorf("expected branch %q, got %q", "wave1-agent-A", report.Branch)
	}
	if report.Commit != "abc123def456" {
		t.Errorf("expected commit %q, got %q", "abc123def456", report.Commit)
	}
	if len(report.FilesChanged) != 2 {
		t.Errorf("expected 2 files changed, got %d", len(report.FilesChanged))
	}
	if len(report.TestsAdded) != 1 {
		t.Errorf("expected 1 test added, got %d", len(report.TestsAdded))
	}
	if report.Verification != "PASS (go test)" {
		t.Errorf("expected verification %q, got %q", "PASS (go test)", report.Verification)
	}
}

func TestRunSetCompletion_PartialStatus(t *testing.T) {
	// Create a temporary manifest.
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	// Create a minimal manifest with one wave and one agent.
	manifest := &protocol.IMPLManifest{
		Title:       "Test Feature",
		FeatureSlug: "test-feature",
		Waves: []protocol.Wave{
			{
				Number: 1,
				Agents: []protocol.Agent{
					{ID: "B", Task: "Test agent B"},
				},
			},
		},
	}

	if err := protocol.Save(manifest, manifestPath); err != nil {
		t.Fatalf("failed to create test manifest: %v", err)
	}

	// Create a YAML with partial status and failure_type.
	yamlContent := `status: partial
failure_type: fixable
branch: wave1-agent-B
commit: xyz789
verification: FAIL (tests incomplete)
`
	stdinPath := filepath.Join(tmpDir, "stdin.yaml")
	if err := os.WriteFile(stdinPath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write stdin file: %v", err)
	}

	// Redirect stdin.
	oldStdin := os.Stdin
	defer func() { os.Stdin = oldStdin }()
	stdinFile, err := os.Open(stdinPath)
	if err != nil {
		t.Fatalf("failed to open stdin file: %v", err)
	}
	defer stdinFile.Close()
	os.Stdin = stdinFile

	// Run set-completion.
	err = runSetCompletion([]string{manifestPath, "B"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the manifest was updated.
	updatedManifest, err := protocol.Load(manifestPath)
	if err != nil {
		t.Fatalf("failed to load updated manifest: %v", err)
	}

	report, found := updatedManifest.CompletionReports["B"]
	if !found {
		t.Fatal("completion report for agent B not found in manifest")
	}

	if report.Status != "partial" {
		t.Errorf("expected status %q, got %q", "partial", report.Status)
	}
	if report.FailureType != "fixable" {
		t.Errorf("expected failure_type %q, got %q", "fixable", report.FailureType)
	}
	if report.Verification != "FAIL (tests incomplete)" {
		t.Errorf("expected verification %q, got %q", "FAIL (tests incomplete)", report.Verification)
	}
}
