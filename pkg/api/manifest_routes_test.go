package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

func TestHandleLoadManifest(t *testing.T) {
	// Create a temporary test manifest
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "IMPL-test.yaml")
	manifestYAML := `---
waves:
  - number: 1
    agents:
      - id: A
        files:
          - file1.go
`
	if err := os.WriteFile(manifestPath, []byte(manifestYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("GET", "/api/manifest/test", nil)
	req.SetPathValue("slug", "test")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var manifest protocol.IMPLManifest
	if err := json.Unmarshal(w.Body.Bytes(), &manifest); err != nil {
		t.Errorf("failed to parse response JSON: %v", err)
	}

	if len(manifest.Waves) != 1 {
		t.Errorf("expected 1 wave, got %d", len(manifest.Waves))
	}
}

func TestHandleLoadManifest_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("GET", "/api/manifest/nonexistent", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500 for missing file, got %d", w.Code)
	}
}

func TestHandleValidateManifest(t *testing.T) {
	// Create a valid test manifest
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "IMPL-test.yaml")
	manifestYAML := `---
title: Test Feature
feature_slug: test
verdict: SUITABLE
file_ownership:
  - file: file1.go
    agent: A
    wave: 1
    action: new
waves:
  - number: 1
    agents:
      - id: A
        task: Implement file1.go
        files:
          - file1.go
`
	if err := os.WriteFile(manifestPath, []byte(manifestYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("POST", "/api/manifest/test/validate", nil)
	req.SetPathValue("slug", "test")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Errorf("failed to parse response JSON: %v", err)
	}

	if valid, ok := response["valid"].(bool); !ok || !valid {
		t.Errorf("expected valid=true, got %v", response)
	}
}

func TestHandleGetManifestWave(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "IMPL-test.yaml")
	manifestYAML := `---
waves:
  - number: 1
    agents:
      - id: A
        files:
          - file1.go
  - number: 2
    agents:
      - id: B
        files:
          - file2.go
`
	if err := os.WriteFile(manifestPath, []byte(manifestYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("GET", "/api/manifest/test/wave/2", nil)
	req.SetPathValue("slug", "test")
	req.SetPathValue("number", "2")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var wave protocol.Wave
	if err := json.Unmarshal(w.Body.Bytes(), &wave); err != nil {
		t.Errorf("failed to parse response JSON: %v", err)
	}

	if wave.Number != 2 {
		t.Errorf("expected wave number 2, got %d", wave.Number)
	}
}

func TestHandleGetManifestWave_InvalidNumber(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "IMPL-test.yaml")
	manifestYAML := `---
waves:
  - number: 1
    agents:
      - id: A
        files:
          - file1.go
`
	if err := os.WriteFile(manifestPath, []byte(manifestYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("GET", "/api/manifest/test/wave/99", nil)
	req.SetPathValue("slug", "test")
	req.SetPathValue("number", "99")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for invalid wave number, got %d", w.Code)
	}
}

func TestHandleSetManifestCompletion(t *testing.T) {
	tmpDir := t.TempDir()
	manifestPath := filepath.Join(tmpDir, "IMPL-test.yaml")
	manifestYAML := `---
waves:
  - number: 1
    agents:
      - id: A
        files:
          - file1.go
`
	if err := os.WriteFile(manifestPath, []byte(manifestYAML), 0644); err != nil {
		t.Fatalf("failed to write test manifest: %v", err)
	}

	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	report := protocol.CompletionReport{
		Status: "complete",
		Commit: "abc123",
	}
	reportJSON, _ := json.Marshal(report)

	req := httptest.NewRequest("POST", "/api/manifest/test/completion/A", bytes.NewReader(reportJSON))
	req.SetPathValue("slug", "test")
	req.SetPathValue("agentID", "A")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var response map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Errorf("failed to parse response JSON: %v", err)
	}

	if response["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", response)
	}

	// Verify the manifest was updated
	updatedManifest, err := protocol.Load(manifestPath)
	if err != nil {
		t.Errorf("failed to reload manifest: %v", err)
	}

	if updatedManifest.CompletionReports == nil {
		t.Fatalf("completion reports map is nil")
	}

	completionReport, ok := updatedManifest.CompletionReports["A"]
	if !ok {
		t.Errorf("completion report for agent A was not set")
	} else if completionReport.Status != "complete" {
		t.Errorf("expected status=complete, got %s", completionReport.Status)
	}
}

func TestHandleSetManifestCompletion_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	server := &Server{
		cfg: Config{IMPLDir: tmpDir},
		mux: http.NewServeMux(),
	}
	server.RegisterManifestRoutes()

	req := httptest.NewRequest("POST", "/api/manifest/test/completion/A", bytes.NewReader([]byte("invalid json")))
	req.SetPathValue("slug", "test")
	req.SetPathValue("agentID", "A")
	w := httptest.NewRecorder()

	server.mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 for invalid JSON, got %d", w.Code)
	}
}
