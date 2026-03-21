package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

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

// TestCriticReviewStartedEvent verifies that critic_review_started is emitted
// before the subprocess runs.
func TestCriticReviewStartedEvent(t *testing.T) {
	broker := newGlobalBroker()
	s := &Server{globalBroker: broker}

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Override command to exit immediately
	origCmd := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "true")
	}
	defer func() { criticCommandFunc = origCmd }()

	done := make(chan struct{})
	go func() {
		s.runCriticAsync("test-slug", "/nonexistent/impl.yaml")
		close(done)
	}()

	// First event should be critic_review_started
	select {
	case msg := <-ch:
		if !strings.HasPrefix(msg, "critic_review_started:") {
			t.Fatalf("expected first event to be critic_review_started, got: %s", msg)
		}
		var payload map[string]string
		jsonStr := strings.TrimPrefix(msg, "critic_review_started:")
		if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
			t.Fatalf("failed to parse JSON: %v", err)
		}
		if payload["slug"] != "test-slug" {
			t.Fatalf("expected slug=test-slug, got %s", payload["slug"])
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for critic_review_started event")
	}

	<-done
}

// TestCriticReviewFailedEvent verifies that critic_review_failed is emitted
// when the subprocess exits with a non-zero code.
func TestCriticReviewFailedEvent(t *testing.T) {
	broker := newGlobalBroker()
	s := &Server{globalBroker: broker}

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Override command to fail
	origCmd := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "false")
	}
	defer func() { criticCommandFunc = origCmd }()

	done := make(chan struct{})
	go func() {
		s.runCriticAsync("fail-slug", "/nonexistent/impl.yaml")
		close(done)
	}()

	var gotStarted, gotFailed bool
	timeout := time.After(5 * time.Second)
	for !gotFailed {
		select {
		case msg := <-ch:
			if strings.HasPrefix(msg, "critic_review_started:") {
				gotStarted = true
			}
			if strings.HasPrefix(msg, "critic_review_failed:") {
				gotFailed = true
				var payload map[string]interface{}
				jsonStr := strings.TrimPrefix(msg, "critic_review_failed:")
				if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				if payload["slug"] != "fail-slug" {
					t.Fatalf("expected slug=fail-slug, got %v", payload["slug"])
				}
				if payload["error"] == nil || payload["error"] == "" {
					t.Fatal("expected non-empty error field")
				}
			}
		case <-timeout:
			t.Fatal("timed out waiting for critic_review_failed event")
		}
	}

	if !gotStarted {
		t.Fatal("expected critic_review_started before critic_review_failed")
	}

	<-done
}

// TestCriticTimeoutBehavior verifies that the critic times out and emits
// critic_review_failed with an appropriate timeout error message.
func TestCriticTimeoutBehavior(t *testing.T) {
	broker := newGlobalBroker()
	s := &Server{globalBroker: broker}

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Set a short timeout for testing
	origTimeout := criticTimeout
	criticTimeout = 100 * time.Millisecond
	defer func() { criticTimeout = origTimeout }()

	// Override command to sleep longer than timeout
	origCmd := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "sleep", "30")
	}
	defer func() { criticCommandFunc = origCmd }()

	done := make(chan struct{})
	go func() {
		s.runCriticAsync("timeout-slug", "/nonexistent/impl.yaml")
		close(done)
	}()

	var gotTimeout bool
	timeout := time.After(5 * time.Second)
	for !gotTimeout {
		select {
		case msg := <-ch:
			if strings.HasPrefix(msg, "critic_review_failed:") {
				var payload map[string]interface{}
				jsonStr := strings.TrimPrefix(msg, "critic_review_failed:")
				if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				errMsg, ok := payload["error"].(string)
				if !ok {
					t.Fatal("expected error to be a string")
				}
				if !strings.Contains(errMsg, "timed out") {
					t.Fatalf("expected timeout error message, got: %s", errMsg)
				}
				gotTimeout = true
			}
		case <-timeout:
			t.Fatal("timed out waiting for critic timeout event")
		}
	}

	<-done
}

// TestCriticOutputStreaming verifies that stdout from the subprocess is
// streamed as critic_output SSE events.
func TestCriticOutputStreaming(t *testing.T) {
	broker := newGlobalBroker()
	s := &Server{globalBroker: broker}

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Override command to produce output
	origCmd := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "echo", "hello from critic")
	}
	defer func() { criticCommandFunc = origCmd }()

	done := make(chan struct{})
	go func() {
		s.runCriticAsync("output-slug", "/nonexistent/impl.yaml")
		close(done)
	}()

	var gotOutput bool
	timeout := time.After(5 * time.Second)
loop:
	for {
		select {
		case msg := <-ch:
			if strings.HasPrefix(msg, "critic_output:") {
				var payload map[string]interface{}
				jsonStr := strings.TrimPrefix(msg, "critic_output:")
				if err := json.Unmarshal([]byte(jsonStr), &payload); err != nil {
					t.Fatalf("failed to parse JSON: %v", err)
				}
				if payload["slug"] != "output-slug" {
					t.Fatalf("expected slug=output-slug, got %v", payload["slug"])
				}
				chunk, ok := payload["chunk"].(string)
				if !ok || !strings.Contains(chunk, "hello from critic") {
					t.Fatalf("expected chunk containing 'hello from critic', got: %v", payload["chunk"])
				}
				gotOutput = true
			}
		case <-timeout:
			break loop
		case <-done:
			// Drain remaining events briefly
			time.Sleep(50 * time.Millisecond)
			break loop
		}
	}

	if !gotOutput {
		t.Fatal("expected at least one critic_output event")
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

// makeIMPLWithCriticReport writes an IMPL YAML with a critic report containing
// the given agent reviews and returns the path.
func makeIMPLWithCriticReport(t *testing.T, implDir, slug string, reviews map[string]protocol.AgentCriticReview) string {
	t.Helper()
	implPath := makeMinimalIMPL(t, implDir, slug)
	result := protocol.CriticResult{
		Verdict:      protocol.CriticVerdictIssues,
		Summary:      "Issues found",
		AgentReviews: reviews,
		ReviewedAt:   "2026-03-20T00:00:00Z",
		IssueCount:   countIssues(reviews),
	}
	if err := protocol.WriteCriticReview(implPath, result); err != nil {
		t.Fatalf("WriteCriticReview failed: %v", err)
	}
	return implPath
}

func countIssues(reviews map[string]protocol.AgentCriticReview) int {
	n := 0
	for _, r := range reviews {
		n += len(r.Issues)
	}
	return n
}

// TestAutoFixCritic_NoReport verifies that the endpoint returns an error when
// no critic report exists for the IMPL doc.
func TestAutoFixCritic_NoReport(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "no-report"
	makeMinimalIMPL(t, implDir, slug)

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/impl/"+slug+"/auto-fix-critic", nil)
	req.SetPathValue("slug", slug)
	rr := httptest.NewRecorder()
	s.handleAutoFixCritic(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !strings.Contains(resp["error"], "no critic report") {
		t.Errorf("expected error about no critic report, got: %s", resp["error"])
	}
}

// TestAutoFixCritic_FileExistence verifies that file_existence errors with
// severity "error" and a file field get auto-fixed by adding file ownership.
func TestAutoFixCritic_FileExistence(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "file-fix"
	reviews := map[string]protocol.AgentCriticReview{
		"A": {
			AgentID: "A",
			Verdict: protocol.CriticVerdictIssues,
			Issues: []protocol.CriticIssue{
				{
					Check:       "file_existence",
					Severity:    protocol.CriticSeverityError,
					Description: "file pkg/missing/file.go not found in ownership",
					File:        "pkg/missing/file.go",
				},
			},
		},
	}
	makeIMPLWithCriticReport(t, implDir, slug, reviews)

	// Override command funcs to no-ops for test
	origValidate := validateCommandFunc
	validateCommandFunc = func(implPath string) *exec.Cmd {
		return exec.Command("true")
	}
	defer func() { validateCommandFunc = origValidate }()

	origCritic := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "true")
	}
	defer func() { criticCommandFunc = origCritic }()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	body := strings.NewReader(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/impl/"+slug+"/auto-fix-critic", body)
	req.SetPathValue("slug", slug)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.handleAutoFixCritic(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp AutoFixCriticResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.FixesApplied) != 1 {
		t.Fatalf("expected 1 fix applied, got %d", len(resp.FixesApplied))
	}
	if resp.FixesApplied[0].Check != "file_existence" {
		t.Errorf("expected check file_existence, got %s", resp.FixesApplied[0].Check)
	}
	if resp.FixesApplied[0].AgentID != "A" {
		t.Errorf("expected agent_id A, got %s", resp.FixesApplied[0].AgentID)
	}
	if len(resp.FixesFailed) != 0 {
		t.Errorf("expected 0 failed fixes, got %d", len(resp.FixesFailed))
	}

	// Verify file ownership was actually added to the manifest
	manifest, err := protocol.Load(filepath.Join(implDir, "IMPL-"+slug+".yaml"))
	if err != nil {
		t.Fatalf("failed to reload manifest: %v", err)
	}
	found := false
	for _, fo := range manifest.FileOwnership {
		if fo.File == "pkg/missing/file.go" && fo.Agent == "A" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected file ownership for pkg/missing/file.go to be added to manifest")
	}
}

// TestAutoFixCritic_UnfixableError verifies that unknown check types land in
// fixes_failed with reason "no auto-fix available".
func TestAutoFixCritic_UnfixableError(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "unfixable"
	reviews := map[string]protocol.AgentCriticReview{
		"B": {
			AgentID: "B",
			Verdict: protocol.CriticVerdictIssues,
			Issues: []protocol.CriticIssue{
				{
					Check:       "unknown_check_type",
					Severity:    protocol.CriticSeverityError,
					Description: "some unknown issue",
				},
			},
		},
	}
	makeIMPLWithCriticReport(t, implDir, slug, reviews)

	origValidate := validateCommandFunc
	validateCommandFunc = func(implPath string) *exec.Cmd {
		return exec.Command("true")
	}
	defer func() { validateCommandFunc = origValidate }()

	origCritic := criticCommandFunc
	criticCommandFunc = func(ctx context.Context, implPath string) *exec.Cmd {
		return exec.CommandContext(ctx, "true")
	}
	defer func() { criticCommandFunc = origCritic }()

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	body := strings.NewReader(`{}`)
	req := httptest.NewRequest(http.MethodPost, "/api/impl/"+slug+"/auto-fix-critic", body)
	req.SetPathValue("slug", slug)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.handleAutoFixCritic(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp AutoFixCriticResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.FixesApplied) != 0 {
		t.Errorf("expected 0 fixes applied, got %d", len(resp.FixesApplied))
	}
	if len(resp.FixesFailed) != 1 {
		t.Fatalf("expected 1 failed fix, got %d", len(resp.FixesFailed))
	}
	if resp.FixesFailed[0].Check != "unknown_check_type" {
		t.Errorf("expected check unknown_check_type, got %s", resp.FixesFailed[0].Check)
	}
	if resp.FixesFailed[0].Reason != "no auto-fix available" {
		t.Errorf("expected reason 'no auto-fix available', got %s", resp.FixesFailed[0].Reason)
	}
}

// TestAutoFixCritic_DryRun verifies that dry_run returns planned fixes
// without actually applying them to the manifest.
func TestAutoFixCritic_DryRun(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatalf("failed to create implDir: %v", err)
	}

	slug := "dry-run"
	reviews := map[string]protocol.AgentCriticReview{
		"A": {
			AgentID: "A",
			Verdict: protocol.CriticVerdictIssues,
			Issues: []protocol.CriticIssue{
				{
					Check:       "file_existence",
					Severity:    protocol.CriticSeverityError,
					Description: "file pkg/dry/run.go not found",
					File:        "pkg/dry/run.go",
				},
			},
		},
	}
	implPath := makeIMPLWithCriticReport(t, implDir, slug, reviews)

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  implDir,
		RepoPath: dir,
	})

	body := strings.NewReader(`{"dry_run": true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/impl/"+slug+"/auto-fix-critic", body)
	req.SetPathValue("slug", slug)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	s.handleAutoFixCritic(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp AutoFixCriticResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.FixesApplied) != 1 {
		t.Fatalf("expected 1 planned fix, got %d", len(resp.FixesApplied))
	}
	if resp.NewResult != nil {
		t.Error("expected nil new_result for dry run")
	}
	if !resp.AllResolved {
		t.Error("expected all_resolved=true when all issues are fixable in dry run")
	}

	// Verify manifest was NOT modified (file ownership should not have changed)
	manifest, err := protocol.Load(implPath)
	if err != nil {
		t.Fatalf("failed to reload manifest: %v", err)
	}
	for _, fo := range manifest.FileOwnership {
		if fo.File == "pkg/dry/run.go" {
			t.Error("dry run should not have modified the manifest, but found pkg/dry/run.go in file ownership")
		}
	}
}
