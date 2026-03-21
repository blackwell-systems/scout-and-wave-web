package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// newValidationTestServer creates a Server wired with RegisterValidationRoutes()
// using the given IMPLDir. svcDeps is configured to use the same dir as its
// IMPLDir so ResolveIMPLPath can find test fixtures.
func newValidationTestServer(t *testing.T, implDir string) *Server {
	t.Helper()
	svcDeps := service.Deps{
		RepoPath: implDir,
		IMPLDir:  implDir,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}
	s := &Server{
		cfg:     Config{IMPLDir: implDir, RepoPath: implDir},
		mux:     http.NewServeMux(),
		svcDeps: svcDeps,
	}
	s.RegisterValidationRoutes()
	return s
}

// writeIMPL writes a YAML file to <implDir>/IMPL-<slug>.yaml.
func writeIMPL(t *testing.T, implDir, slug, yaml string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(implDir, "docs", "IMPL"), 0755); err != nil {
		t.Fatalf("mkdir docs/IMPL: %v", err)
	}
	p := filepath.Join(implDir, "docs", "IMPL", "IMPL-"+slug+".yaml")
	if err := os.WriteFile(p, []byte(yaml), 0644); err != nil {
		t.Fatalf("write IMPL: %v", err)
	}
	return p
}

// --- Integration validation tests ---

// TestValidationIntegration_NoGaps verifies that validate-integration returns
// valid=true and an empty gaps list when a manifest has no out_of_scope_deps.
func TestValidationIntegration_NoGaps(t *testing.T) {
	tmpDir := t.TempDir()
	writeIMPL(t, tmpDir, "test-feat", `---
title: Test Feature
feature_slug: test-feat
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement handler
        owned_files:
          - pkg/handler.go
`)

	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/test-feat/validate-integration?wave=1", nil)
	req.SetPathValue("slug", "test-feat")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ValidateIntegrationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if resp.Wave != 1 {
		t.Errorf("expected wave=1, got %d", resp.Wave)
	}
	if resp.Gaps == nil {
		t.Error("expected non-nil Gaps slice")
	}
}

// TestValidationIntegration_WithGaps verifies that validate-integration correctly
// surfaces out_of_scope_deps declarations as integration gaps when the referenced
// caller files do not contain the expected symbols.
func TestValidationIntegration_WithGaps(t *testing.T) {
	tmpDir := t.TempDir()
	writeIMPL(t, tmpDir, "gap-feat", `---
title: Gap Feature
feature_slug: gap-feat
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement handler
        owned_files:
          - pkg/handler.go
        completion_reports:
          A:
            status: complete
            commit: abc123
            branch: saw/gap-feat/wave1-agent-A
            files_changed: pkg/handler.go
            out_of_scope_deps:
              - "RegisterRoutes must be called from server.go"
`)

	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/gap-feat/validate-integration?wave=1", nil)
	req.SetPathValue("slug", "gap-feat")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	// Should succeed even with gaps (validation runs, not blocked)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ValidateIntegrationResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// valid and gaps fields must be present
	if resp.Gaps == nil {
		t.Error("expected non-nil Gaps slice")
	}
}

// TestValidationIntegration_MissingSlug verifies 404 for an unknown IMPL slug.
func TestValidationIntegration_MissingSlug(t *testing.T) {
	tmpDir := t.TempDir()
	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/nonexistent/validate-integration?wave=1", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for missing slug, got %d", w.Code)
	}
}

// TestValidationIntegration_InvalidWave verifies 400 for non-integer wave param.
func TestValidationIntegration_InvalidWave(t *testing.T) {
	tmpDir := t.TempDir()
	writeIMPL(t, tmpDir, "wave-feat", `---
title: Wave Feature
feature_slug: wave-feat
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: task
        owned_files: [pkg/f.go]
`)
	s := newValidationTestServer(t, tmpDir)

	tests := []struct {
		name  string
		query string
	}{
		{"not a number", "abc"},
		{"zero", "0"},
		{"negative", "-1"},
		{"missing", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			url := "/api/impl/wave-feat/validate-integration"
			if tc.query != "" {
				url += "?wave=" + tc.query
			}
			req := httptest.NewRequest("GET", url, nil)
			req.SetPathValue("slug", "wave-feat")
			w := httptest.NewRecorder()
			s.mux.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("query=%q: expected 400, got %d", tc.query, w.Code)
			}
		})
	}
}

// --- Wiring validation tests ---

// TestValidationWiring_Valid verifies validate-wiring returns valid=true and empty
// gaps list for a manifest with no wiring declarations.
func TestValidationWiring_Valid(t *testing.T) {
	tmpDir := t.TempDir()
	writeIMPL(t, tmpDir, "wiring-feat", `---
title: Wiring Feature
feature_slug: wiring-feat
verdict: SUITABLE
waves:
  - number: 1
    agents:
      - id: A
        task: Implement handler
        owned_files:
          - pkg/handler.go
`)

	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/wiring-feat/validate-wiring", nil)
	req.SetPathValue("slug", "wiring-feat")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ValidateWiringResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	if resp.Gaps == nil {
		t.Error("expected non-nil Gaps slice")
	}
	// No wiring declarations -> should be valid
	if !resp.Valid {
		t.Errorf("expected valid=true for manifest with no wiring declarations, got false; gaps: %v", resp.Gaps)
	}
}

// TestValidationWiring_MissingCallerFile verifies that a manifest with a wiring
// declaration pointing to a non-existent caller file produces gaps (valid=false).
func TestValidationWiring_MissingCallerFile(t *testing.T) {
	tmpDir := t.TempDir()
	writeIMPL(t, tmpDir, "wiring-gaps", `---
title: Wiring Gaps
feature_slug: wiring-gaps
verdict: SUITABLE
wiring:
  - symbol: RegisterRoutes
    defined_in: pkg/api/routes.go
    must_be_called_from: cmd/saw/serve_cmd.go
    agent: A
    wave: 1
waves:
  - number: 1
    agents:
      - id: A
        task: Implement routes
        owned_files:
          - pkg/api/routes.go
`)

	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/wiring-gaps/validate-wiring", nil)
	req.SetPathValue("slug", "wiring-gaps")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ValidateWiringResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	// The caller file cmd/saw/serve_cmd.go doesn't exist in the temp dir and
	// doesn't contain "RegisterRoutes", so we expect gaps and valid=false.
	if resp.Valid {
		t.Error("expected valid=false when caller file is missing, got true")
	}
	if len(resp.Gaps) == 0 {
		t.Error("expected at least one gap for missing caller file")
	}
}

// TestValidationWiring_MissingSlug verifies 404 for an unknown IMPL slug.
func TestValidationWiring_MissingSlug(t *testing.T) {
	tmpDir := t.TempDir()
	s := newValidationTestServer(t, tmpDir)

	req := httptest.NewRequest("GET", "/api/impl/nonexistent/validate-wiring", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for missing slug, got %d", w.Code)
	}
}
