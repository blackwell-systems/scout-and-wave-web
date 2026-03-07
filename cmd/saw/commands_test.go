package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// minimalIMPLDoc is a minimal IMPL doc fixture used in tests that need a
// parseable file. It includes a feature name, one wave, and two agents.
const minimalIMPLDoc = `# IMPL: Test Feature

## Wave 1

### Agent A: First agent
Implements pkg/a/a.go.

### Agent B: Second agent
Implements pkg/b/b.go.
`

// TestRunWave_MissingImpl verifies that runWave returns an error when --impl
// is not provided.
func TestRunWave_MissingImpl(t *testing.T) {
	err := runWave([]string{"--wave", "1"})
	if err == nil {
		t.Fatal("expected error when --impl not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--impl") {
		t.Errorf("expected error to mention --impl, got: %v", err)
	}
}

// TestRunStatus_MissingImpl verifies that runStatus returns an error when
// --impl is not provided.
func TestRunStatus_MissingImpl(t *testing.T) {
	err := runStatus([]string{})
	if err == nil {
		t.Fatal("expected error when --impl not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--impl") {
		t.Errorf("expected error to mention --impl, got: %v", err)
	}
}

// TestRunStatus_ParsesDoc writes a minimal IMPL doc to a temp file and
// verifies that runStatus prints the feature name and agent statuses.
func TestRunStatus_ParsesDoc(t *testing.T) {
	// Write the IMPL doc to a temp file.
	dir := t.TempDir()
	implFile := filepath.Join(dir, "IMPL-test.md")
	if err := os.WriteFile(implFile, []byte(minimalIMPLDoc), 0o644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	// Capture stdout by redirecting os.Stdout.
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	os.Stdout = w

	runErr := runStatus([]string{"--impl", implFile})

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("failed to read captured output: %v", err)
	}
	output := buf.String()

	if runErr != nil {
		t.Fatalf("runStatus returned unexpected error: %v", runErr)
	}

	if !strings.Contains(output, "IMPL: Test Feature") {
		t.Errorf("output missing feature name; got:\n%s", output)
	}
	if !strings.Contains(output, "Wave 1") {
		t.Errorf("output missing wave section; got:\n%s", output)
	}
	if !strings.Contains(output, "Agent A") {
		t.Errorf("output missing Agent A; got:\n%s", output)
	}
	if !strings.Contains(output, "Agent B") {
		t.Errorf("output missing Agent B; got:\n%s", output)
	}
	// Both agents have no completion report, so both should show "pending".
	if !strings.Contains(output, "pending") {
		t.Errorf("output should show 'pending' for agents without reports; got:\n%s", output)
	}
}

// TestFindRepoRoot_Found creates a temp directory tree with a .git directory
// and verifies that findRepoRoot locates it when called from a subdirectory.
func TestFindRepoRoot_Found(t *testing.T) {
	root := t.TempDir()

	// Create .git in root.
	gitDir := filepath.Join(root, ".git")
	if err := os.Mkdir(gitDir, 0o755); err != nil {
		t.Fatalf("failed to create .git dir: %v", err)
	}

	// Create a deep subdirectory.
	sub := filepath.Join(root, "a", "b", "c")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatalf("failed to create subdirectory: %v", err)
	}

	got, err := findRepoRoot(sub)
	if err != nil {
		t.Fatalf("findRepoRoot returned unexpected error: %v", err)
	}

	// Resolve the expected root to handle any OS-level symlinks in TempDir.
	wantResolved, _ := filepath.EvalSymlinks(root)
	gotResolved, _ := filepath.EvalSymlinks(got)
	if gotResolved != wantResolved {
		t.Errorf("findRepoRoot = %q, want %q", got, root)
	}
}

// TestFindRepoRoot_NotFound verifies that findRepoRoot returns an error when
// there is no .git directory anywhere in the directory tree.
func TestFindRepoRoot_NotFound(t *testing.T) {
	// Use a directory that definitely has no .git (a deep temp sub-path).
	dir := filepath.Join(t.TempDir(), "no", "git", "here")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	_, err := findRepoRoot(dir)
	if err == nil {
		t.Fatal("expected error when no .git found, got nil")
	}
}

// TestPrintUsage verifies that printUsage writes expected strings to the
// provided writer.
func TestPrintUsage(t *testing.T) {
	var buf bytes.Buffer
	printUsage(&buf)
	output := buf.String()

	expectedStrings := []string{
		"Usage: saw <command> [flags]",
		"wave",
		"status",
		"--impl",
		"--wave",
		"--version",
		"--help",
	}
	for _, s := range expectedStrings {
		if !strings.Contains(output, s) {
			t.Errorf("printUsage output missing %q; full output:\n%s", s, output)
		}
	}
}
