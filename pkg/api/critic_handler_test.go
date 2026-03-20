package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// makeMinimalIMPL writes a minimal valid IMPL YAML to implDir/IMPL-{slug}.yaml
// and returns the path.
func makeMinimalIMPL(t *testing.T, implDir, slug string) string {
	t.Helper()
	content := `title: Test Feature
feature_slug: ` + slug + `
verdict: SUITABLE
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
	p := filepath.Join(implDir, "IMPL-"+slug+".yaml")
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write IMPL YAML: %v", err)
	}
	return p
}

// TestHandleGetCriticReview_NoReview verifies that GET /api/impl/{slug}/critic-review
// returns 404 when no critic review has been written for the IMPL doc.
func TestHandleGetCriticReview_NoReview(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "test-feature"
	makeMinimalIMPL(t, implDir, slug)

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/impl/"+slug+"/critic-review", nil)
	req.SetPathValue("slug", slug)
	rr := httptest.NewRecorder()
	s.handleGetCriticReview(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] == "" {
		t.Error("expected non-empty error message in 404 response")
	}
}

// TestHandleGetCriticReview_WithReview verifies that GET /api/impl/{slug}/critic-review
// returns 200 with the correct JSON CriticResult after a review has been written.
func TestHandleGetCriticReview_WithReview(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "test-feature"
	implPath := makeMinimalIMPL(t, implDir, slug)

	// Write a critic review to the IMPL doc.
	review := protocol.CriticResult{
		Verdict: "PASS",
		Summary: "All agents passed review.",
		AgentReviews: map[string]protocol.AgentCriticReview{
			"A": {
				AgentID: "A",
				Verdict: "PASS",
				Issues:  nil,
			},
		},
		ReviewedAt: "2026-03-19T00:00:00Z",
		IssueCount: 0,
	}
	if err := protocol.WriteCriticReview(implPath, review); err != nil {
		t.Fatalf("WriteCriticReview failed: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/impl/"+slug+"/critic-review", nil)
	req.SetPathValue("slug", slug)
	rr := httptest.NewRecorder()
	s.handleGetCriticReview(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var got protocol.CriticResult
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got.Verdict != "PASS" {
		t.Errorf("expected verdict PASS, got %q", got.Verdict)
	}
	if got.Summary != "All agents passed review." {
		t.Errorf("expected summary %q, got %q", "All agents passed review.", got.Summary)
	}
	if got.IssueCount != 0 {
		t.Errorf("expected issue_count 0, got %d", got.IssueCount)
	}
	if _, ok := got.AgentReviews["A"]; !ok {
		t.Error("expected agent review for A in response")
	}
}

// TestHandleGetCriticReview_NotFound verifies that GET returns 404 when
// the IMPL doc does not exist at all.
func TestHandleGetCriticReview_NotFound(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/impl/nonexistent/critic-review", nil)
	req.SetPathValue("slug", "nonexistent")
	rr := httptest.NewRecorder()
	s.handleGetCriticReview(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rr.Code, rr.Body.String())
	}
}
