package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// TestLoadManifest_ValidYAML tests loading a valid YAML manifest.
func TestLoadManifest_ValidYAML(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
test_command: go test ./...
lint_command: golangci-lint run
file_ownership:
  - file: pkg/example/foo.go
    agent: A
    wave: 1
    action: new
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	manifest, err := LoadManifest(tmpFile)
	if err != nil {
		t.Fatalf("LoadManifest failed: %v", err)
	}

	if manifest.Title != "Test Feature" {
		t.Errorf("expected title 'Test Feature', got %q", manifest.Title)
	}
	if manifest.FeatureSlug != "test-feature" {
		t.Errorf("expected slug 'test-feature', got %q", manifest.FeatureSlug)
	}
	if len(manifest.Waves) != 1 {
		t.Errorf("expected 1 wave, got %d", len(manifest.Waves))
	}
	if len(manifest.FileOwnership) != 1 {
		t.Errorf("expected 1 file ownership entry, got %d", len(manifest.FileOwnership))
	}
}

// TestLoadManifest_MissingFile tests loading a nonexistent file.
func TestLoadManifest_MissingFile(t *testing.T) {
	_, err := LoadManifest("/nonexistent/path/to/manifest.yaml")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// TestLoadManifest_InvalidYAML tests loading a file with invalid YAML syntax.
func TestLoadManifest_InvalidYAML(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files: [this is not valid yaml syntax
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	_, err := LoadManifest(tmpFile)
	if err == nil {
		t.Fatal("expected error for invalid YAML, got nil")
	}
}

// TestValidateManifest_Valid tests validation of a valid manifest.
func TestValidateManifest_Valid(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
test_command: go test ./...
lint_command: golangci-lint run
file_ownership:
  - file: pkg/example/foo.go
    agent: A
    wave: 1
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	validationErrs, err := ValidateManifest(tmpFile)
	if err != nil {
		t.Fatalf("ValidateManifest failed: %v", err)
	}

	if validationErrs != nil {
		t.Errorf("expected no validation errors, got %d errors: %+v", len(validationErrs), validationErrs)
	}
}

// TestValidateManifest_Invalid tests validation of an invalid manifest.
func TestValidateManifest_Invalid(t *testing.T) {
	// Missing required title field
	yamlContent := `feature_slug: test-feature
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	validationErrs, err := ValidateManifest(tmpFile)
	if err != nil {
		t.Fatalf("ValidateManifest failed: %v", err)
	}

	if validationErrs == nil || len(validationErrs) == 0 {
		t.Error("expected validation errors for manifest without title, got none")
	}
}

// TestValidateManifest_MissingFile tests validation with a nonexistent file.
func TestValidateManifest_MissingFile(t *testing.T) {
	_, err := ValidateManifest("/nonexistent/path/to/manifest.yaml")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// TestValidateManifest_DetectsUnknownKeys tests that ValidateManifest catches
// unknown top-level keys, which the old implementation missed.
func TestValidateManifest_DetectsUnknownKeys(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
test_command: go test ./...
lint_command: go vet ./...
bogus_field: true
file_ownership:
  - file: pkg/example/foo.go
    agent: A
    wave: 1
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	validationErrs, err := ValidateManifest(tmpFile)
	if err != nil {
		t.Fatalf("ValidateManifest failed: %v", err)
	}

	if validationErrs == nil || len(validationErrs) == 0 {
		t.Fatal("expected validation errors for manifest with unknown key 'bogus_field', got none")
	}

	// Verify at least one error mentions the unknown key
	found := false
	for _, e := range validationErrs {
		if strings.Contains(e.Code, "UNKNOWN_KEY") || strings.Contains(e.Message, "bogus_field") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected an error about unknown key 'bogus_field', got: %+v", validationErrs)
	}
}

// TestGetManifestWave_ValidWave tests retrieving a valid wave from a manifest.
func TestGetManifestWave_ValidWave(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
  - number: 2
    agents:
      - id: B
        task: Implement bar
        files:
          - pkg/example/bar.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	wave, err := GetManifestWave(tmpFile, 1)
	if err != nil {
		t.Fatalf("GetManifestWave failed: %v", err)
	}

	if wave.Number != 1 {
		t.Errorf("expected wave number 1, got %d", wave.Number)
	}
	if len(wave.Agents) != 1 {
		t.Errorf("expected 1 agent, got %d", len(wave.Agents))
	}
	if wave.Agents[0].ID != "A" {
		t.Errorf("expected agent ID 'A', got %q", wave.Agents[0].ID)
	}

	wave2, err := GetManifestWave(tmpFile, 2)
	if err != nil {
		t.Fatalf("GetManifestWave(2) failed: %v", err)
	}
	if wave2.Number != 2 {
		t.Errorf("expected wave number 2, got %d", wave2.Number)
	}
	if wave2.Agents[0].ID != "B" {
		t.Errorf("expected agent ID 'B', got %q", wave2.Agents[0].ID)
	}
}

// TestGetManifestWave_InvalidWaveNumber tests retrieving an invalid wave number.
func TestGetManifestWave_InvalidWaveNumber(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	// Test wave number 0 (too low)
	_, err := GetManifestWave(tmpFile, 0)
	if err == nil {
		t.Error("expected error for wave number 0, got nil")
	}

	// Test wave number 99 (too high)
	_, err = GetManifestWave(tmpFile, 99)
	if err == nil {
		t.Error("expected error for wave number 99, got nil")
	}
}

// TestGetManifestWave_MissingFile tests retrieving a wave from a nonexistent file.
func TestGetManifestWave_MissingFile(t *testing.T) {
	_, err := GetManifestWave("/nonexistent/path/to/manifest.yaml", 1)
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// TestSetManifestCompletion_Success tests setting a completion report for an agent.
func TestSetManifestCompletion_Success(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	report := protocol.CompletionReport{
		Status:   "complete",
		Worktree: ".claude/worktrees/wave1-agent-A",
		Branch:   "wave1-agent-A",
		Commit:   "abc123",
		FilesChanged: []string{
			"pkg/example/foo.go",
		},
		Verification: "PASS",
	}

	err := SetManifestCompletion(tmpFile, "A", report)
	if err != nil {
		t.Fatalf("SetManifestCompletion failed: %v", err)
	}

	// Verify the report was saved by loading the manifest again
	manifest, err := LoadManifest(tmpFile)
	if err != nil {
		t.Fatalf("LoadManifest after completion failed: %v", err)
	}

	savedReport, exists := manifest.CompletionReports["A"]
	if !exists {
		t.Fatal("completion report not found in saved manifest")
	}
	if savedReport.Status != "complete" {
		t.Errorf("expected status 'complete', got %q", savedReport.Status)
	}
	if savedReport.Commit != "abc123" {
		t.Errorf("expected commit 'abc123', got %q", savedReport.Commit)
	}
}

// TestSetManifestCompletion_UnknownAgent tests setting a completion report for a nonexistent agent.
func TestSetManifestCompletion_UnknownAgent(t *testing.T) {
	yamlContent := `title: Test Feature
feature_slug: test-feature
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement foo
        files:
          - pkg/example/foo.go
`
	tmpFile := createTempYAML(t, yamlContent)
	defer os.Remove(tmpFile)

	report := protocol.CompletionReport{
		Status: "complete",
	}

	err := SetManifestCompletion(tmpFile, "Z", report)
	if err == nil {
		t.Fatal("expected error for unknown agent ID, got nil")
	}
}

// TestSetManifestCompletion_MissingFile tests setting a completion report with a nonexistent file.
func TestSetManifestCompletion_MissingFile(t *testing.T) {
	report := protocol.CompletionReport{
		Status: "complete",
	}

	err := SetManifestCompletion("/nonexistent/path/to/manifest.yaml", "A", report)
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// createTempYAML creates a temporary YAML file with the given content for testing.
func createTempYAML(t *testing.T, content string) string {
	t.Helper()
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "manifest.yaml")
	if err := os.WriteFile(tmpFile, []byte(content), 0644); err != nil {
		t.Fatalf("failed to create temp YAML file: %v", err)
	}
	return tmpFile
}
