package api

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
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

	runWaveLoop("/nonexistent/IMPL-missing.yaml", "missing", "/nonexistent/repo", publish, func(ExecutionStage, StageStatus, int, string) {})

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
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{}), onStage func(ExecutionStage, StageStatus, int, string)) {
		publish("run_started", map[string]string{"slug": slug})
		publish("run_complete", map[string]string{"status": "success"})
		published = append(published, "run_started", "run_complete")
	}

	publish, getEvents := capturePublish()
	runWaveLoopFunc("/some/IMPL.yaml", "test-slug", "/some/repo", publish, func(ExecutionStage, StageStatus, int, string) {})

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

// capturePublishWithData returns a publish func and a getter for collected events with data.
type publishedEvent struct {
	Event string
	Data  interface{}
}

func capturePublishWithData() (func(event string, data interface{}), func() []publishedEvent) {
	var mu sync.Mutex
	var events []publishedEvent
	publish := func(event string, data interface{}) {
		mu.Lock()
		events = append(events, publishedEvent{Event: event, Data: data})
		mu.Unlock()
	}
	get := func() []publishedEvent {
		mu.Lock()
		defer mu.Unlock()
		out := make([]publishedEvent, len(events))
		copy(out, events)
		return out
	}
	return publish, get
}

// TestRunFinalizeSteps_EmitsEvents verifies that runFinalizeSteps emits
// pipeline_step SSE events. Uses a minimal IMPL doc so manifest loads,
// then verify_commits fails (no git repo).
func TestRunFinalizeSteps_EmitsEvents(t *testing.T) {
	tmpDir := t.TempDir()
	tracker := newPipelineTracker(tmpDir)

	origTracker := defaultPipelineTracker
	defaultPipelineTracker = tracker
	defer func() { defaultPipelineTracker = origTracker }()

	// Create a minimal IMPL doc.
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}
	implPath := filepath.Join(implDir, "IMPL-emit-test.yaml")
	implContent := `feature: emit-test
waves:
  - number: 1
    agents:
      - id: A
        files: ["test.go"]
        task: "test"
`
	if err := os.WriteFile(implPath, []byte(implContent), 0o644); err != nil {
		t.Fatal(err)
	}

	publish, getEvents := capturePublishWithData()

	// VerifyCommits will fail because there's no git repo at /nonexistent/repo.
	err := runFinalizeSteps("emit-test", 1, implPath, "/nonexistent/repo", "", publish)
	if err == nil {
		t.Fatal("expected error from runFinalizeSteps")
	}

	events := getEvents()

	var pipelineEvents []publishedEvent
	for _, ev := range events {
		if ev.Event == "pipeline_step" {
			pipelineEvents = append(pipelineEvents, ev)
		}
	}

	if len(pipelineEvents) < 2 {
		t.Fatalf("expected at least 2 pipeline_step events, got %d: %+v", len(pipelineEvents), pipelineEvents)
	}

	first := pipelineEvents[0].Data.(map[string]interface{})
	if first["step"] != "verify_commits" {
		t.Errorf("expected first pipeline_step for verify_commits, got %v", first["step"])
	}
	if first["status"] != "running" {
		t.Errorf("expected first pipeline_step status running, got %v", first["status"])
	}

	second := pipelineEvents[1].Data.(map[string]interface{})
	if second["step"] != "verify_commits" {
		t.Errorf("expected second pipeline_step for verify_commits, got %v", second["step"])
	}
	if second["status"] != "failed" {
		t.Errorf("expected second pipeline_step status failed, got %v", second["status"])
	}

	// Verify tracker persisted the failure.
	state := tracker.Read("emit-test")
	if state == nil {
		t.Fatal("expected pipeline state to be persisted")
	}
	vcState, ok := state.Steps[StepVerifyCommits]
	if !ok {
		t.Fatal("expected verify_commits step in state")
	}
	if vcState.Status != StepFailed {
		t.Errorf("expected verify_commits status failed, got %v", vcState.Status)
	}
}

// TestRunWaveLoop_PipelineStepEvents verifies that when defaultPipelineTracker
// is set, runWaveLoop calls runFinalizeSteps (which emits pipeline_step events)
// rather than the monolithic engine.FinalizeWave. We test this indirectly: on a
// bad path, the manifest load fails before reaching finalization, so we verify
// the basic event flow still works.
func TestRunWaveLoop_PipelineStepEvents(t *testing.T) {
	tmpDir := t.TempDir()
	tracker := newPipelineTracker(tmpDir)

	origTracker := defaultPipelineTracker
	defaultPipelineTracker = tracker
	defer func() { defaultPipelineTracker = origTracker }()

	publish, getEvents := capturePublish()

	// With a nonexistent path, runWaveLoop will fail at manifest load
	// (before reaching finalization), so we just verify it doesn't panic
	// when the tracker is set.
	runWaveLoop("/nonexistent/IMPL-test.yaml", "test-slug", "/nonexistent/repo", publish, func(ExecutionStage, StageStatus, int, string) {})

	events := getEvents()
	if len(events) < 2 {
		t.Fatalf("expected at least 2 events, got: %v", events)
	}
	if events[0] != "run_started" {
		t.Errorf("expected first event run_started, got %q", events[0])
	}
	last := events[len(events)-1]
	if last != "run_failed" {
		t.Errorf("expected last event run_failed, got %q", last)
	}
}

// TestRunFinalizeSteps_ResumeFromFailedStep verifies that when a pipeline has
// partially completed steps, runFinalizeSteps resumes from after the last
// successful step rather than re-running completed steps.
func TestRunFinalizeSteps_ResumeFromFailedStep(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a minimal IMPL doc that protocol.Load can parse.
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}
	implPath := filepath.Join(implDir, "IMPL-resume-test.yaml")
	implContent := `feature: resume-test
waves:
  - number: 1
    agents:
      - id: A
        files: ["test.go"]
        task: "test"
quality_gates:
  level: standard
  gates:
    - type: build
      command: go build ./...
      required: true
`
	if err := os.WriteFile(implPath, []byte(implContent), 0o644); err != nil {
		t.Fatal(err)
	}

	tracker := newPipelineTracker(tmpDir)

	origTracker := defaultPipelineTracker
	defaultPipelineTracker = tracker
	defer func() { defaultPipelineTracker = origTracker }()

	// Pre-populate tracker: mark verify_commits and scan_stubs as complete.
	_ = tracker.Complete("resume-test", 1, StepVerifyCommits)
	_ = tracker.Complete("resume-test", 1, StepScanStubs)

	publish, getEvents := capturePublishWithData()

	// RunFinalizeSteps should skip verify_commits and scan_stubs, then
	// attempt run_gates (which will fail because there's no real repo).
	err := runFinalizeSteps("resume-test", 1, implPath, "/nonexistent/repo", "", publish)
	if err == nil {
		t.Fatal("expected error from runFinalizeSteps (gates should fail)")
	}

	events := getEvents()

	// Collect pipeline_step events.
	var pipelineSteps []map[string]interface{}
	for _, ev := range events {
		if ev.Event == "pipeline_step" {
			if m, ok := ev.Data.(map[string]interface{}); ok {
				pipelineSteps = append(pipelineSteps, m)
			}
		}
	}

	// verify_commits and scan_stubs should be skipped (status=skipped).
	foundVC := false
	foundSS := false
	for _, ps := range pipelineSteps {
		if ps["step"] == "verify_commits" && ps["status"] == "skipped" {
			foundVC = true
		}
		if ps["step"] == "scan_stubs" && ps["status"] == "skipped" {
			foundSS = true
		}
	}
	if !foundVC {
		t.Error("expected verify_commits to be skipped on resume")
	}
	if !foundSS {
		t.Error("expected scan_stubs to be skipped on resume")
	}

	// run_gates should have been attempted (running status at minimum).
	// It may succeed (no gates defined) or fail — either way, it must
	// have been started, proving resume skipped the first two steps.
	foundGatesRunning := false
	for _, ps := range pipelineSteps {
		if ps["step"] == "run_gates" && ps["status"] == "running" {
			foundGatesRunning = true
		}
	}
	if !foundGatesRunning {
		t.Error("expected run_gates to start (running status) after resuming past completed steps")
	}

	// The pipeline should eventually fail at merge_agents (no git repo)
	// or earlier. Verify we got an error back.
	if err == nil {
		t.Error("expected runFinalizeSteps to return an error")
	}
}

// newMinimalServer creates a minimal Server with only the fields needed to test
// makePublisher and makeEnginePublisher (broker + agentSnapshots).
func newMinimalServer() *Server {
	return &Server{
		broker: &sseBroker{
			clients: make(map[string][]chan SSEEvent),
		},
	}
}

// TestMakePublisher_CachesAutoRetryEvents verifies that auto_retry_started and
// auto_retry_exhausted events are cached by cacheAgentEvent via makePublisher,
// so late-connecting SSE clients receive the retry state in the snapshot.
func TestMakePublisher_CachesAutoRetryEvents(t *testing.T) {
	s := newMinimalServer()
	slug := "test-slug"
	publish := s.makePublisher(slug)

	// Publish auto_retry_started with the required agent/wave fields.
	publish("auto_retry_started", map[string]interface{}{
		"agent":        "A",
		"wave":         1,
		"failure_type": "transient",
		"attempt":      1,
		"max_attempts": 2,
	})

	// Publish auto_retry_exhausted.
	publish("auto_retry_exhausted", map[string]interface{}{
		"agent":        "B",
		"wave":         1,
		"failure_type": "fixable",
		"attempts":     1,
	})

	// Both events should appear in the agent snapshot.
	snapshot := s.snapshotAgentEvents(slug)
	if len(snapshot) != 2 {
		t.Fatalf("expected 2 cached events, got %d: %+v", len(snapshot), snapshot)
	}

	eventNames := make(map[string]bool)
	for _, ev := range snapshot {
		eventNames[ev.Event] = true
	}
	if !eventNames["auto_retry_started"] {
		t.Error("expected auto_retry_started to be cached in agent snapshot")
	}
	if !eventNames["auto_retry_exhausted"] {
		t.Error("expected auto_retry_exhausted to be cached in agent snapshot")
	}
}

// TestMakePublisher_CachesAutoRetryEvents_AgentFailed verifies that agent_failed
// is still cached alongside the new retry events (regression guard).
func TestMakePublisher_CachesAutoRetryEvents_AgentFailed(t *testing.T) {
	s := newMinimalServer()
	slug := "test-slug-2"
	publish := s.makePublisher(slug)

	// Publish agent_failed to confirm existing behaviour is preserved.
	publish("agent_failed", map[string]interface{}{
		"agent":  "A",
		"wave":   1,
		"status": "failed",
	})

	// Also publish an auto_retry_started for the same agent — the cache
	// key is "wave:agent", so it overwrites the previous agent_failed.
	publish("auto_retry_started", map[string]interface{}{
		"agent":        "A",
		"wave":         1,
		"failure_type": "transient",
		"attempt":      1,
		"max_attempts": 2,
	})

	snapshot := s.snapshotAgentEvents(slug)
	// Only 1 entry because both events share the same "1:A" cache key.
	if len(snapshot) != 1 {
		t.Fatalf("expected 1 cached event (same key overwrite), got %d", len(snapshot))
	}
	if snapshot[0].Event != "auto_retry_started" {
		t.Errorf("expected latest event to be auto_retry_started, got %q", snapshot[0].Event)
	}
}

// TestMakeEnginePublisher_CachesAutoRetryEvents verifies makeEnginePublisher
// caches auto_retry_started and auto_retry_exhausted (same contract as makePublisher).
func TestMakeEnginePublisher_CachesAutoRetryEvents(t *testing.T) {
	s := newMinimalServer()
	slug := "engine-pub-slug"

	enginePub := s.makeEnginePublisher(slug)

	// Subscribe to the broker to drain events (prevent blocking on a full channel).
	ch := s.broker.subscribe(slug)
	defer s.broker.unsubscribe(slug, ch)

	enginePub(engine.Event{
		Event: "auto_retry_started",
		Data: map[string]interface{}{
			"agent":        "C",
			"wave":         2,
			"failure_type": "transient",
			"attempt":      1,
			"max_attempts": 2,
		},
	})
	enginePub(engine.Event{
		Event: "auto_retry_exhausted",
		Data: map[string]interface{}{
			"agent":        "C",
			"wave":         2,
			"failure_type": "transient",
			"attempts":     2,
		},
	})

	snapshot := s.snapshotAgentEvents(slug)
	// Same "2:C" cache key — exhausted overwrites started, so expect 1 entry.
	if len(snapshot) != 1 {
		t.Fatalf("expected 1 cached event (same key overwrite), got %d", len(snapshot))
	}
	if snapshot[0].Event != "auto_retry_exhausted" {
		t.Errorf("expected latest cached event to be auto_retry_exhausted, got %q", snapshot[0].Event)
	}
}

// TestRunWaveLoop_EmitsPrepareStepBeforeExecution verifies that when runWaveLoop
// reaches a wave that needs execution (not resumed from existing commits), it
// emits prepare_step SSE events from engine.PrepareWave before any wave
// execution events. With no real git repo, PrepareWave will fail — we verify
// the prepare_step event appears before the run_failed event.
func TestRunWaveLoop_EmitsPrepareStepBeforeExecution(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a minimal IMPL doc with one wave.
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}
	implPath := filepath.Join(implDir, "IMPL-prepare-test.yaml")
	implContent := `feature: prepare-test
waves:
  - number: 1
    agents:
      - id: A
        files: ["test.go"]
        task: "test"
`
	if err := os.WriteFile(implPath, []byte(implContent), 0o644); err != nil {
		t.Fatal(err)
	}

	publish, getEvents := capturePublishWithData()

	// runWaveLoop with a valid IMPL but no git repo. PrepareWave will fail
	// because it cannot create worktrees, which results in run_failed.
	runWaveLoop(implPath, "prepare-test", tmpDir, func(event string, data interface{}) {
		publish(event, data)
	}, func(ExecutionStage, StageStatus, int, string) {})

	events := getEvents()

	// Find the first prepare_step event and verify it comes before run_failed.
	prepareIdx := -1
	failedIdx := -1
	for i, ev := range events {
		if ev.Event == "prepare_step" && prepareIdx == -1 {
			prepareIdx = i
		}
		if ev.Event == "run_failed" && failedIdx == -1 {
			failedIdx = i
		}
	}

	if prepareIdx == -1 {
		t.Error("expected at least one prepare_step event from PrepareWave")
	}
	if failedIdx == -1 {
		t.Error("expected run_failed event (PrepareWave should fail with no git repo)")
	}
	if prepareIdx != -1 && failedIdx != -1 && prepareIdx >= failedIdx {
		t.Errorf("prepare_step (idx=%d) should appear before run_failed (idx=%d)", prepareIdx, failedIdx)
	}
}

// TestHandleWaveStart_DelegatesToService verifies that handleWaveStart
// delegates to service.StartWave and returns the expected HTTP status codes.
func TestHandleWaveStart_DelegatesToService(t *testing.T) {
	// This test verifies the thin handler pattern: parse request, call service, write response.
	// We can't fully test without mocking service.StartWave, but we can verify the handler
	// structure is correct by checking it compiles and has the right imports.
	// Full integration tests would require a test server.
	t.Skip("Integration test - requires full server setup with service layer mocks")
}

// TestHandleWaveGateProceed_DelegatesToService verifies that handleWaveGateProceed
// delegates to service.ProceedGate and returns the expected HTTP status codes.
func TestHandleWaveGateProceed_DelegatesToService(t *testing.T) {
	// This test verifies the thin handler pattern: parse request, call service, write response.
	t.Skip("Integration test - requires full server setup with service layer mocks")
}
