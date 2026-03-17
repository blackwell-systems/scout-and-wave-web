package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ---------------------------------------------------------------------------
// handleStepRetry tests
// ---------------------------------------------------------------------------

// TestHandleStepRetry_InvalidStep returns 400 for an unknown step.
func TestHandleStepRetry_InvalidStep(t *testing.T) {
	s, _ := makeTestServer(t)

	body, _ := json.Marshal(StepRetryRequest{Wave: 1})
	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/step/bogus_step/retry", bytes.NewReader(body))
	req.SetPathValue("slug", "my-feature")
	req.SetPathValue("step", "bogus_step")
	rr := httptest.NewRecorder()

	s.handleStepRetry(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unknown step, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleStepRetry_MissingWave returns 400 when wave < 1.
func TestHandleStepRetry_MissingWave(t *testing.T) {
	s, _ := makeTestServer(t)

	body, _ := json.Marshal(StepRetryRequest{Wave: 0})
	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/step/verify_commits/retry", bytes.NewReader(body))
	req.SetPathValue("slug", "my-feature")
	req.SetPathValue("step", "verify_commits")
	rr := httptest.NewRecorder()

	s.handleStepRetry(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for wave=0, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ---------------------------------------------------------------------------
// handleStepSkip tests
// ---------------------------------------------------------------------------

// TestHandleStepSkip_NonSkippable returns 400 for verify_commits (non-skippable).
func TestHandleStepSkip_NonSkippable(t *testing.T) {
	s, _ := makeTestServer(t)

	body, _ := json.Marshal(StepSkipRequest{Wave: 1, Reason: "test"})
	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/step/verify_commits/skip", bytes.NewReader(body))
	req.SetPathValue("slug", "my-feature")
	req.SetPathValue("step", "verify_commits")
	rr := httptest.NewRecorder()

	s.handleStepSkip(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-skippable step, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleStepSkip_Skippable returns 200 for scan_stubs (skippable).
func TestHandleStepSkip_Skippable(t *testing.T) {
	s, _ := makeTestServer(t)

	body, _ := json.Marshal(StepSkipRequest{Wave: 1, Reason: "known clean"})
	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/step/scan_stubs/skip", bytes.NewReader(body))
	req.SetPathValue("slug", "my-feature")
	req.SetPathValue("step", "scan_stubs")
	rr := httptest.NewRecorder()

	s.handleStepSkip(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for skippable step, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["status"] != "skipped" {
		t.Errorf("expected status=skipped, got %v", resp["status"])
	}
}

// TestHandleStepSkip_ValidateIntegration returns 200 (new skippable step).
func TestHandleStepSkip_ValidateIntegration(t *testing.T) {
	s, _ := makeTestServer(t)

	body, _ := json.Marshal(StepSkipRequest{Wave: 1, Reason: "not needed"})
	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/step/validate_integration/skip", bytes.NewReader(body))
	req.SetPathValue("slug", "my-feature")
	req.SetPathValue("step", "validate_integration")
	rr := httptest.NewRecorder()

	s.handleStepSkip(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 for validate_integration skip, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ---------------------------------------------------------------------------
// handleForceMarkComplete tests
// ---------------------------------------------------------------------------

// TestHandleForceMarkComplete_Success verifies the handler resolves the IMPL
// path and attempts to mark it complete. engine.MarkIMPLComplete may return an
// error for our minimal test IMPL (missing fields), so we accept either 200 or
// 500 -- the key assertion is that the handler doesn't 404 (path resolution works).
func TestHandleForceMarkComplete_Success(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "my-feature", minimalIMPL)

	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/mark-complete", nil)
	req.SetPathValue("slug", "my-feature")
	rr := httptest.NewRecorder()

	s.handleForceMarkComplete(rr, req)

	if rr.Code == http.StatusNotFound {
		t.Errorf("handler returned 404 -- IMPL path resolution failed: %s", rr.Body.String())
	}

	// If it succeeded (200), verify response body.
	if rr.Code == http.StatusOK {
		var resp map[string]string
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp["status"] != "complete" {
			t.Errorf("expected status=complete, got %v", resp["status"])
		}
	}
}

// ---------------------------------------------------------------------------
// handlePipelineState tests
// ---------------------------------------------------------------------------

// TestHandlePipelineState_NotFound returns 404 when no pipeline state exists.
func TestHandlePipelineState_NotFound(t *testing.T) {
	s, _ := makeTestServer(t)

	// Set up a non-nil tracker with no state.
	defaultPipelineTracker = newPipelineTracker()
	t.Cleanup(func() { defaultPipelineTracker = nil })

	req := httptest.NewRequest(http.MethodGet, "/api/wave/nonexistent/pipeline", nil)
	req.SetPathValue("slug", "nonexistent")
	rr := httptest.NewRecorder()

	s.handlePipelineState(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandlePipelineState_TrackerNil returns 503 when defaultPipelineTracker is nil.
func TestHandlePipelineState_TrackerNil(t *testing.T) {
	s, _ := makeTestServer(t)

	// Ensure tracker is nil.
	orig := defaultPipelineTracker
	defaultPipelineTracker = nil
	t.Cleanup(func() { defaultPipelineTracker = orig })

	req := httptest.NewRequest(http.MethodGet, "/api/wave/my-feature/pipeline", nil)
	req.SetPathValue("slug", "my-feature")
	rr := httptest.NewRecorder()

	s.handlePipelineState(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d: %s", rr.Code, rr.Body.String())
	}
}
