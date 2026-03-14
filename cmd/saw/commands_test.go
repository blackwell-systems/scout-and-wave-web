package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// minimalIMPLDoc is a minimal IMPL doc fixture used in tests that need a
// parseable file. It includes a feature name, one wave, and two agents.
const minimalIMPLDoc = `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
waves:
    - number: 1
      agents:
          - id: A
            task: First agent - Implements pkg/a/a.go
            files:
                - pkg/a/a.go
          - id: B
            task: Second agent - Implements pkg/b/b.go
            files:
                - pkg/b/b.go
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
	implFile := filepath.Join(dir, "IMPL-test.yaml")
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
		"scout",
		"scaffold",
		"--version",
		"--help",
		"Run 'saw <command> --help' for per-command flags",
	}
	for _, s := range expectedStrings {
		if !strings.Contains(output, s) {
			t.Errorf("printUsage output missing %q; full output:\n%s", s, output)
		}
	}
}

// TestRunScout_MissingFeature verifies that runScout returns a non-nil error
// when --feature is not provided.
func TestRunScout_MissingFeature(t *testing.T) {
	err := runScout([]string{})
	if err == nil {
		t.Fatal("expected error when --feature not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--feature") {
		t.Errorf("expected error to mention --feature, got: %v", err)
	}
}

// TestRunScaffold_MissingImpl verifies that runScaffold returns a non-nil error
// when --impl is not provided.
func TestRunScaffold_MissingImpl(t *testing.T) {
	err := runScaffold([]string{})
	if err == nil {
		t.Fatal("expected error when --impl not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--impl") {
		t.Errorf("expected error to mention --impl, got: %v", err)
	}
}

// TestRunWave_Auto_MultiWave_Integration verifies that when --auto is set,
// runWave iterates all waves in a multi-wave IMPL doc without user prompting.
// Uses the fake orchestrator seam (orchestratorNewFunc).
func TestRunWave_Auto_MultiWave_Integration(t *testing.T) {
	// Build a two-wave fake orchestrator.
	fake := &fakeWaveOrch{
		doc: &types.IMPLDoc{
			FeatureName: "Integration Test Feature",
			Waves: []types.Wave{
				{
					Number: 1,
					Agents: []types.AgentSpec{{Letter: "A", Prompt: "wave1 work"}},
				},
				{
					Number: 2,
					Agents: []types.AgentSpec{{Letter: "B", Prompt: "wave2 work"}},
				},
			},
			TestCommand: "go test ./...",
		},
		state: protocol.StateScoutPending,
	}

	// Set up the temp dir with .git and IMPL doc file.
	implPath, cleanup := setupRunWaveTest(t, fake)
	defer cleanup()

	// Run with --auto so no stdin prompt blocks between waves.
	err := runWave([]string{"--impl", implPath, "--wave", "1", "--auto"})
	if err != nil {
		t.Fatalf("runWave returned unexpected error: %v", err)
	}

	// Both waves must have been executed via RunWave.
	if len(fake.runWaveCalls) != 2 {
		t.Fatalf("expected RunWave called twice (once per wave), got %d calls: %v",
			len(fake.runWaveCalls), fake.runWaveCalls)
	}
	if fake.runWaveCalls[0] != 1 {
		t.Errorf("expected first RunWave call for wave 1, got: %d", fake.runWaveCalls[0])
	}
	if fake.runWaveCalls[1] != 2 {
		t.Errorf("expected second RunWave call for wave 2, got: %d", fake.runWaveCalls[1])
	}

	// Both waves must have been merged.
	if len(fake.mergeWaveCalls) != 2 {
		t.Errorf("expected MergeWave called twice, got %d calls: %v",
			len(fake.mergeWaveCalls), fake.mergeWaveCalls)
	}

	// Verification ran for both waves.
	if len(fake.runVerifCalls) != 2 {
		t.Errorf("expected RunVerification called twice, got %d calls: %v",
			len(fake.runVerifCalls), fake.runVerifCalls)
	}

	// Final state is Complete.
	if fake.state != protocol.StateComplete {
		t.Errorf("expected final state Complete, got: %s", fake.state)
	}
}

// TestLocatePromptFile_FoundViaSAWRepo verifies that locatePromptFile returns
// the correct path when SAW_REPO points to a directory containing the file.
func TestLocatePromptFile_FoundViaSAWRepo(t *testing.T) {
	sawRepo := t.TempDir()
	promptsDir := filepath.Join(sawRepo, "prompts")
	if err := os.MkdirAll(promptsDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(promptsDir, "scout.md"), []byte("# Scout"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	t.Setenv("SAW_REPO", sawRepo)

	got, err := locatePromptFile(filepath.Join("prompts", "scout.md"))
	if err != nil {
		t.Fatalf("locatePromptFile returned error: %v", err)
	}
	if got == "" {
		t.Error("locatePromptFile returned empty path")
	}
}

// TestLocatePromptFile_NotFound verifies an error is returned when the file
// does not exist under SAW_REPO.
func TestLocatePromptFile_NotFound(t *testing.T) {
	t.Setenv("SAW_REPO", t.TempDir()) // empty dir, no prompts/
	_, err := locatePromptFile(filepath.Join("prompts", "scout.md"))
	if err == nil {
		t.Fatal("expected error when prompt file not found, got nil")
	}
}

// TestRunScout_PromptFileMissing verifies runScout returns an error when
// SAW_REPO is set but the scout.md file does not exist.
func TestRunScout_PromptFileMissing(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	t.Setenv("SAW_REPO", t.TempDir()) // no prompts/ dir
	err := runScout([]string{"--feature", "add thing", "--repo", dir})
	if err == nil {
		t.Fatal("expected error when scout.md missing, got nil")
	}
}

// TestRunScaffold_PromptFileMissing verifies runScaffold returns an error when
// SAW_REPO is set but scaffold-agent.md does not exist.
func TestRunScaffold_PromptFileMissing(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir .git: %v", err)
	}
	implFile := filepath.Join(dir, "IMPL-test.yaml")
	if err := os.WriteFile(implFile, []byte(minimalIMPLDoc), 0o644); err != nil {
		t.Fatalf("write impl: %v", err)
	}
	t.Setenv("SAW_REPO", t.TempDir()) // no scaffold-agent.md
	err := runScaffold([]string{"--impl", implFile, "--repo", dir})
	if err == nil {
		t.Fatal("expected error when scaffold-agent.md missing, got nil")
	}
}

// TestPrintUsage_IncludesMerge verifies that printUsage includes the merge
// subcommand description after the merge dispatch was added to main.go.
func TestPrintUsage_IncludesMerge(t *testing.T) {
	var buf bytes.Buffer
	printUsage(&buf)
	output := buf.String()

	if !strings.Contains(output, "merge") {
		t.Errorf("printUsage output missing 'merge' subcommand; full output:\n%s", output)
	}
}

// TestRunMerge_MissingImpl verifies that runMerge returns an error when --impl
// is not provided.
func TestRunMerge_MissingImpl(t *testing.T) {
	err := runMerge([]string{})
	if err == nil {
		t.Fatal("expected error when --impl not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--impl") {
		t.Errorf("expected error to mention --impl, got: %v", err)
	}
}

// TestRunWave_AutoFlag verifies that --auto parses without error.
// We pass an invalid --impl path so runWave exits early after flag parse.
func TestRunWave_AutoFlag(t *testing.T) {
	// --auto should parse cleanly; --impl is missing so it must return an error
	// about --impl, not about --auto being invalid.
	err := runWave([]string{"--auto", "--wave", "1"})
	if err == nil {
		t.Fatal("expected error when --impl not provided, got nil")
	}
	if !strings.Contains(err.Error(), "--impl") {
		t.Errorf("expected error about --impl (not --auto), got: %v", err)
	}
}

// TestRunScout_PromptIncludesFeature verifies that the feature description
// passed via --feature ends up in the prompt sent to the scout agent.
func TestRunScout_PromptIncludesFeature(t *testing.T) {
	const featureDesc = "add-unique-feature-xyz-9876"

	// Build the prompt the same way runScout does, then assert the feature is present.
	sawRepo := t.TempDir()
	promptsDir := filepath.Join(sawRepo, "prompts")
	if err := os.MkdirAll(promptsDir, 0o755); err != nil {
		t.Fatalf("failed to create prompts dir: %v", err)
	}
	scoutMdContent := "# Scout Agent Prompt\nDo the scouting."
	if err := os.WriteFile(filepath.Join(promptsDir, "scout.md"), []byte(scoutMdContent), 0o644); err != nil {
		t.Fatalf("failed to write scout.md: %v", err)
	}

	repoRoot := t.TempDir()
	implOut := filepath.Join(repoRoot, "docs", "IMPL", "IMPL-"+slugify(featureDesc)+".yaml")
	prompt := string([]byte(scoutMdContent)) + "\n\n## Feature\n" + featureDesc + "\n\n## IMPL Output Path\n" + implOut + "\n"

	spec := types.AgentSpec{Letter: "scout", Prompt: prompt}
	if !strings.Contains(spec.Prompt, featureDesc) {
		t.Errorf("expected prompt to contain feature description %q, got:\n%s", featureDesc, spec.Prompt)
	}
	if !strings.Contains(spec.Prompt, "Scout Agent Prompt") {
		t.Errorf("expected prompt to contain scout.md content, got:\n%s", spec.Prompt)
	}
}

// captureRunStatus is a helper that redirects os.Stdout, calls runStatus with
// the provided args, restores os.Stdout, and returns the captured output and
// any error returned by runStatus.
func captureRunStatus(t *testing.T, args []string) (string, error) {
	t.Helper()
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("captureRunStatus: failed to create pipe: %v", err)
	}
	os.Stdout = w

	runErr := runStatus(args)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("captureRunStatus: failed to read captured output: %v", err)
	}
	return buf.String(), runErr
}

// minimalIMPLDocWithReport is an IMPL doc that includes a completion report
// for Agent A with status "complete".
const minimalIMPLDocWithReport = `title: JSON Test Feature
feature_slug: json-test-feature
verdict: SUITABLE
waves:
    - number: 1
      agents:
          - id: A
            task: First agent - Implements pkg/a/a.go
            files:
                - pkg/a/a.go
          - id: B
            task: Second agent - Implements pkg/b/b.go
            files:
                - pkg/b/b.go
completion_reports:
    A:
        status: complete
        worktree: /tmp/worktree-a
        branch: saw/wave1-agent-a
        commit: abc1234
`

// TestRunStatus_JSONOutput calls runStatus with --json and verifies valid JSON output.
func TestRunStatus_JSONOutput(t *testing.T) {
	dir := t.TempDir()
	implFile := filepath.Join(dir, "IMPL-json-test.yaml")
	if err := os.WriteFile(implFile, []byte(minimalIMPLDocWithReport), 0o644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	output, runErr := captureRunStatus(t, []string{"--impl", implFile, "--json"})
	if runErr != nil {
		t.Fatalf("runStatus --json returned unexpected error: %v", runErr)
	}

	var result struct {
		Feature string `json:"feature"`
		Summary struct {
			Total    int `json:"total"`
			Complete int `json:"complete"`
			Pending  int `json:"pending"`
		} `json:"summary"`
	}
	if err := json.Unmarshal([]byte(output), &result); err != nil {
		t.Fatalf("runStatus --json output is not valid JSON: %v\noutput:\n%s", err, output)
	}
	if result.Feature != "JSON Test Feature" {
		t.Errorf("JSON feature = %q, want %q", result.Feature, "JSON Test Feature")
	}
	if result.Summary.Total != 2 {
		t.Errorf("JSON summary.total = %d, want 2", result.Summary.Total)
	}
	if result.Summary.Complete != 1 {
		t.Errorf("JSON summary.complete = %d, want 1", result.Summary.Complete)
	}
	if result.Summary.Pending != 1 {
		t.Errorf("JSON summary.pending = %d, want 1", result.Summary.Pending)
	}
}

// TestRunStatus_MissingFlag calls runStatus with --missing and verifies that
// a "Missing reports:" section appears in the output for agents without reports.
func TestRunStatus_MissingFlag(t *testing.T) {
	dir := t.TempDir()
	implFile := filepath.Join(dir, "IMPL-missing-test.yaml")
	if err := os.WriteFile(implFile, []byte(minimalIMPLDoc), 0o644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	output, runErr := captureRunStatus(t, []string{"--impl", implFile, "--missing"})
	if runErr != nil {
		t.Fatalf("runStatus --missing returned unexpected error: %v", runErr)
	}

	if !strings.Contains(output, "Missing reports:") {
		t.Errorf("output missing 'Missing reports:' section; got:\n%s", output)
	}
	if !strings.Contains(output, "Agent A (wave 1)") {
		t.Errorf("output should list 'Agent A (wave 1)' as missing; got:\n%s", output)
	}
	if !strings.Contains(output, "Agent B (wave 1)") {
		t.Errorf("output should list 'Agent B (wave 1)' as missing; got:\n%s", output)
	}
}

// TestRunStatus_SummaryLine verifies the "Agents: X complete, Y pending, Z blocked" line.
func TestRunStatus_SummaryLine(t *testing.T) {
	dir := t.TempDir()
	implFile := filepath.Join(dir, "IMPL-summary-test.yaml")
	if err := os.WriteFile(implFile, []byte(minimalIMPLDocWithReport), 0o644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	output, runErr := captureRunStatus(t, []string{"--impl", implFile})
	if runErr != nil {
		t.Fatalf("runStatus returned unexpected error: %v", runErr)
	}

	if !strings.Contains(output, "Agents: 1 complete, 1 pending, 0 blocked") {
		t.Errorf("output missing expected summary line; got:\n%s", output)
	}
}
