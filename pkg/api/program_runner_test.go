package api

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// TestRunProgramTier_TierNotFound verifies that an invalid tier number returns an error.
func TestRunProgramTier_TierNotFound(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a minimal PROGRAM manifest with one tier
	programDir := filepath.Join(tmpDir, "docs", "PROGRAM")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(programDir, "PROGRAM-test.yaml")
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
tiers:
  - number: 1
    impls: ["impl-a"]
    description: "First tier"
impls:
  - slug: impl-a
    title: "Implementation A"
    tier: 1
    status: complete
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(programContent), 0o644); err != nil {
		t.Fatal(err)
	}

	publish, _ := capturePublish()

	// Request tier 99 which doesn't exist
	err := runProgramTier(programPath, "test-program", 99, tmpDir, publish)
	if err == nil {
		t.Fatal("expected error for invalid tier number")
	}

	expectedMsg := "tier 99 not found in manifest"
	if err.Error() != expectedMsg {
		t.Errorf("expected error %q, got %q", expectedMsg, err.Error())
	}
}

// TestRunProgramTier_PublishesEvents verifies the correct event sequence.
func TestRunProgramTier_PublishesEvents(t *testing.T) {
	// Save and restore the real runWaveLoopFunc
	orig := runWaveLoopFunc
	defer func() { runWaveLoopFunc = orig }()

	tmpDir := t.TempDir()

	// Create a PROGRAM manifest
	programDir := filepath.Join(tmpDir, "docs", "PROGRAM")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(programDir, "PROGRAM-test.yaml")
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
tiers:
  - number: 1
    impls: ["impl-a"]
    description: "First tier"
impls:
  - slug: impl-a
    title: "Implementation A"
    tier: 1
    status: complete
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(programContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create the IMPL doc
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}

	implPath := filepath.Join(implDir, "IMPL-impl-a.yaml")
	implContent := `feature: impl-a
waves: []
`
	if err := os.WriteFile(implPath, []byte(implContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Override runWaveLoopFunc to simulate successful execution
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{}), onStage func(ExecutionStage, StageStatus, int, string)) {
		publish("run_started", map[string]string{"slug": slug})
		publish("run_complete", map[string]string{"status": "success"})
	}

	publish, getEvents := capturePublish()

	err := runProgramTier(programPath, "test-program", 1, tmpDir, publish)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	events := getEvents()

	// Expected sequence:
	// 1. program_tier_started
	// 2. program_impl_started
	// 3. run_started (from mock runWaveLoopFunc)
	// 4. run_complete (from mock runWaveLoopFunc)
	// 5. program_impl_complete
	// 6. program_tier_complete

	expectedSequence := []string{
		"program_tier_started",
		"program_impl_started",
		"run_started",
		"run_complete",
		"program_impl_complete",
		"program_tier_complete",
	}

	if len(events) < len(expectedSequence) {
		t.Fatalf("expected at least %d events, got %d: %v", len(expectedSequence), len(events), events)
	}

	for i, expected := range expectedSequence {
		if events[i] != expected {
			t.Errorf("event[%d]: expected %q, got %q", i, expected, events[i])
		}
	}
}

// TestRunProgramTier_GateFailure verifies program_blocked event on gate failure.
func TestRunProgramTier_GateFailure(t *testing.T) {
	// Save and restore the real runWaveLoopFunc
	orig := runWaveLoopFunc
	defer func() { runWaveLoopFunc = orig }()

	tmpDir := t.TempDir()

	// Create a PROGRAM manifest with a failing tier gate
	programDir := filepath.Join(tmpDir, "docs", "PROGRAM")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(programDir, "PROGRAM-test.yaml")
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
tiers:
  - number: 1
    impls: ["impl-a"]
    description: "First tier"
impls:
  - slug: impl-a
    title: "Implementation A"
    tier: 1
    status: complete
tier_gates:
  - type: required_gate
    command: "exit 1"
    required: true
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(programContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create the IMPL doc
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}

	implPath := filepath.Join(implDir, "IMPL-impl-a.yaml")
	implContent := `feature: impl-a
waves: []
`
	if err := os.WriteFile(implPath, []byte(implContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Override runWaveLoopFunc to simulate successful execution
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{}), onStage func(ExecutionStage, StageStatus, int, string)) {
		publish("run_started", map[string]string{"slug": slug})
		publish("run_complete", map[string]string{"status": "success"})
	}

	publish, getEvents := capturePublishWithData()

	err := runProgramTier(programPath, "test-program", 1, tmpDir, publish)
	if err == nil {
		t.Fatal("expected error due to gate failure")
	}

	events := getEvents()

	// Find the program_blocked event
	var foundBlocked bool
	for _, ev := range events {
		if ev.Event == "program_blocked" {
			foundBlocked = true
			data, ok := ev.Data.(map[string]interface{})
			if !ok {
				t.Fatal("program_blocked event data is not a map")
			}
			if data["program_slug"] != "test-program" {
				t.Errorf("expected program_slug=test-program, got %v", data["program_slug"])
			}
			if data["reason"] != "tier gates failed" {
				t.Errorf("expected reason='tier gates failed', got %v", data["reason"])
			}
			break
		}
	}

	if !foundBlocked {
		t.Error("expected program_blocked event to be published")
	}
}

// TestRunProgramTier_IMPLNotFound verifies program_blocked when IMPL doc is missing.
func TestRunProgramTier_IMPLNotFound(t *testing.T) {
	// Save and restore the real runWaveLoopFunc
	orig := runWaveLoopFunc
	defer func() { runWaveLoopFunc = orig }()

	tmpDir := t.TempDir()

	// Create a PROGRAM manifest
	programDir := filepath.Join(tmpDir, "docs", "PROGRAM")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(programDir, "PROGRAM-test.yaml")
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
tiers:
  - number: 1
    impls: ["missing-impl"]
    description: "First tier"
impls:
  - slug: missing-impl
    title: "Missing Implementation"
    tier: 1
    status: planning
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(programContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Do NOT create the IMPL doc — it's missing

	// Override runWaveLoopFunc (shouldn't be called)
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{}), onStage func(ExecutionStage, StageStatus, int, string)) {
		t.Fatal("runWaveLoopFunc should not be called when IMPL doc is missing")
	}

	publish, getEvents := capturePublishWithData()

	err := runProgramTier(programPath, "test-program", 1, tmpDir, publish)
	if err == nil {
		t.Fatal("expected error when IMPL doc is missing")
	}

	events := getEvents()

	// Find the program_blocked event
	var foundBlocked bool
	for _, ev := range events {
		if ev.Event == "program_blocked" {
			foundBlocked = true
			data, ok := ev.Data.(map[string]interface{})
			if !ok {
				t.Fatal("program_blocked event data is not a map")
			}
			if data["impl_slug"] != "missing-impl" {
				t.Errorf("expected impl_slug=missing-impl, got %v", data["impl_slug"])
			}
			reasonStr := fmt.Sprintf("%v", data["reason"])
			if reasonStr == "" {
				t.Error("expected non-empty reason in program_blocked event")
			}
			break
		}
	}

	if !foundBlocked {
		t.Error("expected program_blocked event to be published")
	}
}

// TestRunProgramTier_MultipleIMPLs verifies sequential execution of multiple IMPLs.
func TestRunProgramTier_MultipleIMPLs(t *testing.T) {
	// Save and restore the real runWaveLoopFunc
	orig := runWaveLoopFunc
	defer func() { runWaveLoopFunc = orig }()

	tmpDir := t.TempDir()

	// Create a PROGRAM manifest with two IMPLs
	programDir := filepath.Join(tmpDir, "docs", "PROGRAM")
	if err := os.MkdirAll(programDir, 0o755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(programDir, "PROGRAM-test.yaml")
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
tiers:
  - number: 1
    impls: ["impl-a", "impl-b"]
    description: "First tier"
impls:
  - slug: impl-a
    title: "Implementation A"
    tier: 1
    status: complete
  - slug: impl-b
    title: "Implementation B"
    tier: 1
    status: complete
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 2
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(programContent), 0o644); err != nil {
		t.Fatal(err)
	}

	// Create both IMPL docs
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0o755); err != nil {
		t.Fatal(err)
	}

	implPathA := filepath.Join(implDir, "IMPL-impl-a.yaml")
	implContentA := `feature: impl-a
waves: []
`
	if err := os.WriteFile(implPathA, []byte(implContentA), 0o644); err != nil {
		t.Fatal(err)
	}

	implPathB := filepath.Join(implDir, "IMPL-impl-b.yaml")
	implContentB := `feature: impl-b
waves: []
`
	if err := os.WriteFile(implPathB, []byte(implContentB), 0o644); err != nil {
		t.Fatal(err)
	}

	// Track execution order
	var mu sync.Mutex
	var executionOrder []string

	// Override runWaveLoopFunc to track execution order
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{}), onStage func(ExecutionStage, StageStatus, int, string)) {
		mu.Lock()
		executionOrder = append(executionOrder, slug)
		mu.Unlock()

		publish("run_started", map[string]string{"slug": slug})
		publish("run_complete", map[string]string{"status": "success"})
	}

	publish, getEvents := capturePublish()

	err := runProgramTier(programPath, "test-program", 1, tmpDir, publish)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify execution order
	if len(executionOrder) != 2 {
		t.Fatalf("expected 2 IMPLs to execute, got %d", len(executionOrder))
	}
	if executionOrder[0] != "impl-a" {
		t.Errorf("expected first IMPL to be impl-a, got %s", executionOrder[0])
	}
	if executionOrder[1] != "impl-b" {
		t.Errorf("expected second IMPL to be impl-b, got %s", executionOrder[1])
	}

	events := getEvents()

	// Count program_impl_started and program_impl_complete events
	var implStartedCount, implCompleteCount int
	for _, ev := range events {
		if ev == "program_impl_started" {
			implStartedCount++
		}
		if ev == "program_impl_complete" {
			implCompleteCount++
		}
	}

	if implStartedCount != 2 {
		t.Errorf("expected 2 program_impl_started events, got %d", implStartedCount)
	}
	if implCompleteCount != 2 {
		t.Errorf("expected 2 program_impl_complete events, got %d", implCompleteCount)
	}
}
