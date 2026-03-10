package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurrentWave_MissingManifestPath(t *testing.T) {
	err := runCurrentWave([]string{})
	if err == nil {
		t.Fatal("expected error when manifest path is not provided, got nil")
	}
	if !strings.Contains(err.Error(), "required") {
		t.Errorf("expected error to contain %q, got: %v", "required", err)
	}
}

func TestCurrentWave_InvalidManifest(t *testing.T) {
	err := runCurrentWave([]string{"/nonexistent/manifest.yaml"})
	if err == nil {
		t.Fatal("expected error for nonexistent manifest path, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected error to contain %q, got: %v", "not found", err)
	}
}

func TestCurrentWave_ValidManifest(t *testing.T) {
	// Create a temporary manifest file for testing
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	// Create a manifest with 2 waves, first incomplete
	manifestContent := `title: Test Manifest
waves:
  - number: 1
    agents:
      - id: agent-A
        description: First agent
  - number: 2
    agents:
      - id: agent-B
        description: Second agent
completion_reports: {}
`
	if err := os.WriteFile(manifestPath, []byte(manifestContent), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runCurrentWave([]string{manifestPath})

	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Read captured output
	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := strings.TrimSpace(string(buf[:n]))

	if output != "1" {
		t.Errorf("expected output %q, got %q", "1", output)
	}
}

func TestCurrentWave_AllComplete(t *testing.T) {
	// Create a temporary manifest file with all waves complete
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	manifestContent := `title: Test Manifest
waves:
  - number: 1
    agents:
      - id: agent-A
        description: First agent
  - number: 2
    agents:
      - id: agent-B
        description: Second agent
completion_reports:
  agent-A:
    status: complete
    wave: 1
    agent: agent-A
  agent-B:
    status: complete
    wave: 2
    agent: agent-B
`
	if err := os.WriteFile(manifestPath, []byte(manifestContent), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runCurrentWave([]string{manifestPath})

	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Read captured output
	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := strings.TrimSpace(string(buf[:n]))

	if output != "complete" {
		t.Errorf("expected output %q, got %q", "complete", output)
	}
}

func TestCurrentWave_PartialWaveComplete(t *testing.T) {
	// Create a manifest where wave 1 is complete but wave 2 has incomplete agents
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "manifest.yaml")

	manifestContent := `title: Test Manifest
waves:
  - number: 1
    agents:
      - id: agent-A
        description: First agent
  - number: 2
    agents:
      - id: agent-B
        description: Second agent
      - id: agent-C
        description: Third agent
completion_reports:
  agent-A:
    status: complete
    wave: 1
    agent: agent-A
  agent-B:
    status: complete
    wave: 2
    agent: agent-B
`
	if err := os.WriteFile(manifestPath, []byte(manifestContent), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := runCurrentWave([]string{manifestPath})

	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Read captured output
	buf := make([]byte, 1024)
	n, _ := r.Read(buf)
	output := strings.TrimSpace(string(buf[:n]))

	if output != "2" {
		t.Errorf("expected output %q (wave 2 incomplete), got %q", "2", output)
	}
}
