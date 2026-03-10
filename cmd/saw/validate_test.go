package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

func TestValidate_ValidManifest(t *testing.T) {
	// Create a temporary valid manifest
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "valid-manifest.yaml")

	validYAML := `title: "Test Feature"
feature_slug: "test-feature"
verdict: "SUITABLE"
waves:
  - number: 1
    agents:
      - id: "A"
        files:
          - "file1.go"
        dependencies: []
file_ownership:
  - file: "file1.go"
    agent: "A"
    wave: 1
    depends_on: []
`
	if err := os.WriteFile(manifestPath, []byte(validYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Run validate command
	err := runValidate([]string{manifestPath})
	if err != nil {
		t.Fatalf("expected no error for valid manifest, got: %v", err)
	}
}

func TestValidate_InvalidManifest(t *testing.T) {
	// Create a temporary invalid manifest (missing title)
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "invalid-manifest.yaml")

	invalidYAML := `feature_slug: "test-feature"
verdict: "SUITABLE"
waves:
  - number: 1
    agents:
      - id: "A"
        files:
          - "file1.go"
        dependencies: []
file_ownership:
  - file: "file1.go"
    agent: "A"
    wave: 1
    depends_on: []
`
	if err := os.WriteFile(manifestPath, []byte(invalidYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Capture stderr to check validation errors
	// Note: runValidate calls os.Exit(1) on validation failure, which we can't test directly
	// Instead, we'll test the underlying logic by calling the SDK directly
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		t.Fatalf("failed to load manifest: %v", err)
	}

	validationErrors := protocol.Validate(manifest)
	if len(validationErrors) == 0 {
		t.Fatal("expected validation errors for invalid manifest, got none")
	}

	// Check that the error is about missing title
	found := false
	for _, e := range validationErrors {
		if e.Code == "I4_MISSING_FIELD" && e.Field == "title" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected I4_MISSING_FIELD error for title field, got: %+v", validationErrors)
	}
}

func TestValidate_FileNotFound(t *testing.T) {
	// Try to validate a non-existent file
	err := runValidate([]string{"/nonexistent/path/manifest.yaml"})
	if err == nil {
		t.Fatal("expected error for non-existent file, got nil")
	}

	// Check error message indicates file doesn't exist
	errMsg := err.Error()
	if !contains(errMsg, "manifest file not found") && !contains(errMsg, "no such file or directory") {
		t.Fatalf("expected file not found error, got: %v", err)
	}
}

func TestValidate_InvalidYAML(t *testing.T) {
	// Create a temporary file with invalid YAML
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "invalid-yaml.yaml")

	invalidYAML := `title: "Test Feature
feature_slug: unclosed quote`
	if err := os.WriteFile(manifestPath, []byte(invalidYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Run validate command
	err := runValidate([]string{manifestPath})
	if err == nil {
		t.Fatal("expected error for invalid YAML, got nil")
	}

	// Check that error is about parsing
	if !contains(err.Error(), "validate:") {
		t.Fatalf("expected parse error, got: %v", err)
	}
}

func TestValidate_MissingArgument(t *testing.T) {
	// Run validate without manifest path
	err := runValidate([]string{})
	if err == nil {
		t.Fatal("expected error for missing manifest path, got nil")
	}

	// Check error message
	if !contains(err.Error(), "manifest path is required") {
		t.Fatalf("expected 'manifest path is required' error, got: %v", err)
	}
}

func TestValidate_I1Violation(t *testing.T) {
	// Create a manifest with I1 violation (multiple agents owning same file in same wave)
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "i1-violation.yaml")

	i1ViolationYAML := `title: "Test Feature"
feature_slug: "test-feature"
verdict: "SUITABLE"
waves:
  - number: 1
    agents:
      - id: "A"
        files:
          - "shared.go"
        dependencies: []
      - id: "B"
        files:
          - "shared.go"
        dependencies: []
file_ownership:
  - file: "shared.go"
    agent: "A"
    wave: 1
    depends_on: []
  - file: "shared.go"
    agent: "B"
    wave: 1
    depends_on: []
`
	if err := os.WriteFile(manifestPath, []byte(i1ViolationYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Load and validate
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		t.Fatalf("failed to load manifest: %v", err)
	}

	validationErrors := protocol.Validate(manifest)
	if len(validationErrors) == 0 {
		t.Fatal("expected I1 violation error, got none")
	}

	// Check that we have an I1_VIOLATION error
	found := false
	for _, e := range validationErrors {
		if e.Code == "I1_VIOLATION" {
			found = true
			break
		}
	}
	if !found {
		errJSON, _ := json.MarshalIndent(validationErrors, "", "  ")
		t.Fatalf("expected I1_VIOLATION error, got: %s", string(errJSON))
	}
}

// Helper function to check if a string contains a substring
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
