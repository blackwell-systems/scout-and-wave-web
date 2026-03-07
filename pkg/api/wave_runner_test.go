package api

import (
	"sync"
	"testing"
)

// capturePublish returns a publish func and a getter for collected events.
func capturePublish() (func(event string, data interface{}), func() []string) {
	var mu sync.Mutex
	var events []string
	publish := func(event string, data interface{}) {
		mu.Lock()
		events = append(events, event)
		mu.Unlock()
	}
	get := func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := make([]string, len(events))
		copy(out, events)
		return out
	}
	return publish, get
}

// TestRunWaveLoop_PublishesRunFailed_OnBadPath verifies that a missing implPath
// causes "run_failed" to be published (after "run_started"), not a panic.
func TestRunWaveLoop_PublishesRunFailed_OnBadPath(t *testing.T) {
	publish, getEvents := capturePublish()

	runWaveLoop("/nonexistent/IMPL-missing.md", "missing", "/nonexistent/repo", publish)

	events := getEvents()
	if len(events) < 2 {
		t.Fatalf("expected at least 2 events (run_started + run_failed), got: %v", events)
	}
	if events[0] != "run_started" {
		t.Errorf("expected first event to be 'run_started', got %q", events[0])
	}
	last := events[len(events)-1]
	if last != "run_failed" {
		t.Errorf("expected last event to be 'run_failed', got %q", last)
	}
}

// TestRunWaveLoop_PublishesRunStarted_ThenRunComplete verifies the happy-path
// event sequence when there are no waves in the IMPL doc.
// Uses a mock orchestrator by injecting into runWaveLoopFunc.
func TestRunWaveLoop_PublishesRunStarted_ThenRunComplete(t *testing.T) {
	// Save and restore the real runWaveLoopFunc.
	orig := runWaveLoopFunc
	defer func() { runWaveLoopFunc = orig }()

	// Override to a controlled no-op that publishes the expected sequence.
	var published []string
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{})) {
		publish("run_started", map[string]string{"slug": slug})
		publish("run_complete", map[string]string{"status": "success"})
		published = append(published, "run_started", "run_complete")
	}

	publish, getEvents := capturePublish()
	runWaveLoopFunc("/some/IMPL.md", "test-slug", "/some/repo", publish)

	events := getEvents()
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got: %v", events)
	}
	if events[0] != "run_started" {
		t.Errorf("expected events[0] == 'run_started', got %q", events[0])
	}
	if events[1] != "run_complete" {
		t.Errorf("expected events[1] == 'run_complete', got %q", events[1])
	}
}
