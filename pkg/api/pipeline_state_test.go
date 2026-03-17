package api

import (
	"errors"
	"sync"
	"testing"
)

func TestPipelineTracker_StartComplete(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	if err := tr.Start("test-slug", 1, StepVerifyCommits); err != nil {
		t.Fatal(err)
	}

	state := tr.Read("test-slug")
	if state == nil {
		t.Fatal("expected state, got nil")
	}
	if state.Slug != "test-slug" {
		t.Errorf("slug = %q, want %q", state.Slug, "test-slug")
	}
	if state.Wave != 1 {
		t.Errorf("wave = %d, want 1", state.Wave)
	}
	s, ok := state.Steps[StepVerifyCommits]
	if !ok {
		t.Fatal("step not found")
	}
	if s.Status != StepRunning {
		t.Errorf("status = %q, want %q", s.Status, StepRunning)
	}

	if err := tr.Complete("test-slug", 1, StepVerifyCommits); err != nil {
		t.Fatal(err)
	}

	state = tr.Read("test-slug")
	s = state.Steps[StepVerifyCommits]
	if s.Status != StepComplete {
		t.Errorf("status = %q, want %q", s.Status, StepComplete)
	}
}

func TestPipelineTracker_FailAndRead(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	if err := tr.Start("fail-slug", 2, StepMergeAgents); err != nil {
		t.Fatal(err)
	}
	stepErr := errors.New("merge conflict in pkg/foo.go")
	if err := tr.Fail("fail-slug", 2, StepMergeAgents, stepErr); err != nil {
		t.Fatal(err)
	}

	state := tr.Read("fail-slug")
	if state == nil {
		t.Fatal("expected state, got nil")
	}
	s := state.Steps[StepMergeAgents]
	if s.Status != StepFailed {
		t.Errorf("status = %q, want %q", s.Status, StepFailed)
	}
	if s.Error != "merge conflict in pkg/foo.go" {
		t.Errorf("error = %q, want %q", s.Error, "merge conflict in pkg/foo.go")
	}
}

func TestPipelineTracker_Skip(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	if err := tr.Skip("skip-slug", 1, StepScanStubs); err != nil {
		t.Fatal(err)
	}

	state := tr.Read("skip-slug")
	if state == nil {
		t.Fatal("expected state, got nil")
	}
	s := state.Steps[StepScanStubs]
	if s.Status != StepSkipped {
		t.Errorf("status = %q, want %q", s.Status, StepSkipped)
	}
}

func TestPipelineTracker_LastSuccessfulStep(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	// Complete first 3 steps, fail the 4th.
	for _, step := range PipelineStepOrder[:3] {
		if err := tr.Complete("resume-slug", 1, step); err != nil {
			t.Fatal(err)
		}
	}
	if err := tr.Fail("resume-slug", 1, StepValidateIntegration, errors.New("validation error")); err != nil {
		t.Fatal(err)
	}

	last := tr.LastSuccessfulStep("resume-slug")
	if last != StepRunGates {
		t.Errorf("last = %q, want %q", last, StepRunGates)
	}
}

func TestPipelineTracker_LastSuccessfulStep_SkippedSteps(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	// verify_commits: complete
	if err := tr.Complete("skip-resume", 1, StepVerifyCommits); err != nil {
		t.Fatal(err)
	}
	// scan_stubs: skipped
	if err := tr.Skip("skip-resume", 1, StepScanStubs); err != nil {
		t.Fatal(err)
	}
	// run_gates: complete
	if err := tr.Complete("skip-resume", 1, StepRunGates); err != nil {
		t.Fatal(err)
	}
	// validate_integration: failed
	if err := tr.Fail("skip-resume", 1, StepValidateIntegration, errors.New("fail")); err != nil {
		t.Fatal(err)
	}

	last := tr.LastSuccessfulStep("skip-resume")
	if last != StepRunGates {
		t.Errorf("last = %q, want %q", last, StepRunGates)
	}
}

func TestPipelineTracker_Clear(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	if err := tr.Start("clear-slug", 1, StepVerifyCommits); err != nil {
		t.Fatal(err)
	}
	if state := tr.Read("clear-slug"); state == nil {
		t.Fatal("expected state before clear")
	}

	tr.Clear("clear-slug")

	if state := tr.Read("clear-slug"); state != nil {
		t.Errorf("expected nil after clear, got %+v", state)
	}
}

func TestPipelineTracker_ConcurrentAccess(t *testing.T) {
	dir := t.TempDir()
	tr := newPipelineTracker(dir)

	var wg sync.WaitGroup
	errs := make(chan error, len(PipelineStepOrder))

	for _, step := range PipelineStepOrder {
		wg.Add(1)
		go func(s PipelineStep) {
			defer wg.Done()
			if err := tr.Start("concurrent-slug", 1, s); err != nil {
				errs <- err
				return
			}
			if err := tr.Complete("concurrent-slug", 1, s); err != nil {
				errs <- err
			}
		}(step)
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("concurrent error: %v", err)
	}

	state := tr.Read("concurrent-slug")
	if state == nil {
		t.Fatal("expected state after concurrent ops")
	}
	// All steps should be complete.
	for _, step := range PipelineStepOrder {
		s, ok := state.Steps[step]
		if !ok {
			t.Errorf("step %q missing", step)
			continue
		}
		if s.Status != StepComplete {
			t.Errorf("step %q status = %q, want %q", step, s.Status, StepComplete)
		}
	}
}

func TestPipelineStepOrder(t *testing.T) {
	if len(PipelineStepOrder) != 8 {
		t.Errorf("PipelineStepOrder has %d entries, want 8", len(PipelineStepOrder))
	}

	expected := []PipelineStep{
		StepVerifyCommits, StepScanStubs, StepRunGates,
		StepValidateIntegration, StepMergeAgents, StepFixGoMod,
		StepVerifyBuild, StepCleanup,
	}
	for i, step := range expected {
		if PipelineStepOrder[i] != step {
			t.Errorf("PipelineStepOrder[%d] = %q, want %q", i, PipelineStepOrder[i], step)
		}
	}
}
