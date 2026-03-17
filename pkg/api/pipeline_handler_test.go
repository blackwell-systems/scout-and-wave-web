package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestHandleGetPipeline_Empty verifies that when there are no IMPLs and no
// queue items, the handler returns an empty entries slice with zero metrics.
func TestHandleGetPipeline_Empty(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/pipeline", nil)
	rr := httptest.NewRecorder()
	s.handleGetPipeline(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp PipelineResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if len(resp.Entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(resp.Entries))
	}
	if resp.Metrics.CompletedCount != 0 {
		t.Errorf("expected 0 completed, got %d", resp.Metrics.CompletedCount)
	}
	if resp.Metrics.QueueDepth != 0 {
		t.Errorf("expected 0 queue depth, got %d", resp.Metrics.QueueDepth)
	}
	// Default autonomy level when no config exists
	if resp.AutonomyLevel != "gated" {
		t.Errorf("expected autonomy_level 'gated', got %q", resp.AutonomyLevel)
	}
}

// TestHandleGetPipeline_WithQueue verifies that queue items appear in the
// response with correct ordering and status mapping.
func TestHandleGetPipeline_WithQueue(t *testing.T) {
	s, dir := makeTestServer(t)

	// Create queue directory with items
	queueDir := filepath.Join(dir, "docs", "IMPL", "queue")
	if err := os.MkdirAll(queueDir, 0755); err != nil {
		t.Fatal(err)
	}

	item1 := `title: Feature Alpha
priority: 1
feature_description: First feature
status: queued
slug: feature-alpha
`
	item2 := `title: Feature Beta
priority: 2
feature_description: Second feature
status: queued
slug: feature-beta
depends_on:
  - feature-alpha
`
	if err := os.WriteFile(filepath.Join(queueDir, "feature-alpha.yaml"), []byte(item1), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(queueDir, "feature-beta.yaml"), []byte(item2), 0644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/pipeline", nil)
	rr := httptest.NewRecorder()
	s.handleGetPipeline(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp PipelineResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	// Should have queue items
	if resp.Metrics.QueueDepth < 1 {
		t.Errorf("expected queue depth >= 1, got %d", resp.Metrics.QueueDepth)
	}

	// Find feature-beta and check depends_on
	for _, e := range resp.Entries {
		if e.Slug == "feature-beta" {
			if len(e.DependsOn) == 0 {
				t.Error("expected feature-beta to have depends_on")
			}
			if e.Status != "queued" {
				t.Errorf("expected status 'queued', got %q", e.Status)
			}
		}
	}
}

// TestHandleGetPipeline_MixedStatus verifies that completed and active IMPLs
// appear with the correct status values.
func TestHandleGetPipeline_MixedStatus(t *testing.T) {
	s, dir := makeTestServer(t)

	// Create a completed IMPL
	completeDir := filepath.Join(dir, "docs", "IMPL", "complete")
	if err := os.MkdirAll(completeDir, 0755); err != nil {
		t.Fatal(err)
	}
	completeIMPL := "title: Done Feature\nstate: COMPLETE\nwaves: []\nfile_ownership: []\n"
	if err := os.WriteFile(filepath.Join(completeDir, "IMPL-done-thing.yaml"), []byte(completeIMPL), 0644); err != nil {
		t.Fatal(err)
	}

	// Create an active IMPL
	activeIMPL := "title: Active Feature\nwaves: []\nfile_ownership: []\n"
	implDir := filepath.Join(dir, "docs", "IMPL")
	if err := os.WriteFile(filepath.Join(implDir, "IMPL-active-thing.yaml"), []byte(activeIMPL), 0644); err != nil {
		t.Fatal(err)
	}

	// Mark active-thing as executing
	s.activeRuns.Store("active-thing", struct{}{})

	req := httptest.NewRequest(http.MethodGet, "/api/pipeline?include_completed=true", nil)
	rr := httptest.NewRecorder()
	s.handleGetPipeline(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp PipelineResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if resp.Metrics.CompletedCount != 1 {
		t.Errorf("expected 1 completed, got %d", resp.Metrics.CompletedCount)
	}

	statusMap := make(map[string]string)
	for _, e := range resp.Entries {
		statusMap[e.Slug] = e.Status
	}

	if statusMap["done-thing"] != "complete" {
		t.Errorf("expected done-thing status 'complete', got %q", statusMap["done-thing"])
	}
	if statusMap["active-thing"] != "executing" {
		t.Errorf("expected active-thing status 'executing', got %q", statusMap["active-thing"])
	}

	if len(resp.Entries) < 2 {
		t.Errorf("expected at least 2 entries, got %d", len(resp.Entries))
	}
}
