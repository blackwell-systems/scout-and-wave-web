package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// PipelineStep identifies a discrete step in the post-agent finalization
// pipeline. Values match the step order from engine/finalize.go FinalizeWave.
type PipelineStep string

const (
	StepVerifyCommits       PipelineStep = "verify_commits"
	StepScanStubs           PipelineStep = "scan_stubs"
	StepRunGates            PipelineStep = "run_gates"
	StepValidateIntegration PipelineStep = "validate_integration"
	StepMergeAgents         PipelineStep = "merge_agents"
	StepFixGoMod            PipelineStep = "fix_go_mod"
	StepVerifyBuild         PipelineStep = "verify_build"
	StepCleanup             PipelineStep = "cleanup"
)

// PipelineStepOrder defines the canonical ordering of finalization steps.
var PipelineStepOrder = []PipelineStep{
	StepVerifyCommits, StepScanStubs, StepRunGates,
	StepValidateIntegration, StepMergeAgents, StepFixGoMod,
	StepVerifyBuild, StepCleanup,
}

// StepStatus is the lifecycle status of a single pipeline step.
type StepStatus string

const (
	StepPending  StepStatus = "pending"
	StepRunning  StepStatus = "running"
	StepComplete StepStatus = "complete"
	StepFailed   StepStatus = "failed"
	StepSkipped  StepStatus = "skipped"
)

// StepState records the current state of a single pipeline step.
type StepState struct {
	Status    StepStatus `json:"status"`
	Error     string     `json:"error,omitempty"`
	Timestamp time.Time  `json:"timestamp"`
}

// PipelineState is the persisted state for a wave's finalization pipeline.
type PipelineState struct {
	Slug      string                    `json:"slug"`
	Wave      int                       `json:"wave"`
	Steps     map[PipelineStep]StepState `json:"steps"`
	UpdatedAt time.Time                 `json:"updated_at"`
}

// pipelineTracker persists step-level finalization state per slug to
// .saw-state/<slug>-pipeline.json inside the IMPL directory.
// Safe for concurrent use.
type pipelineTracker struct {
	mu      sync.Mutex
	implDir string
}

func newPipelineTracker(implDir string) *pipelineTracker {
	return &pipelineTracker{implDir: implDir}
}

func (t *pipelineTracker) stateDir() string {
	return filepath.Join(t.implDir, ".saw-state")
}

func (t *pipelineTracker) statePath(slug string) string {
	return filepath.Join(t.stateDir(), slug+"-pipeline.json")
}

// Start marks a step as running.
func (t *pipelineTracker) Start(slug string, wave int, step PipelineStep) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	state, err := t.loadOrInit(slug, wave)
	if err != nil {
		return err
	}

	state.Steps[step] = StepState{
		Status:    StepRunning,
		Timestamp: time.Now(),
	}
	state.UpdatedAt = time.Now()
	return t.saveLocked(slug, state)
}

// Complete marks a step as complete.
func (t *pipelineTracker) Complete(slug string, wave int, step PipelineStep) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	state, err := t.loadOrInit(slug, wave)
	if err != nil {
		return err
	}

	state.Steps[step] = StepState{
		Status:    StepComplete,
		Timestamp: time.Now(),
	}
	state.UpdatedAt = time.Now()
	return t.saveLocked(slug, state)
}

// Fail marks a step as failed with an error message.
func (t *pipelineTracker) Fail(slug string, wave int, step PipelineStep, stepErr error) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	state, err := t.loadOrInit(slug, wave)
	if err != nil {
		return err
	}

	errMsg := ""
	if stepErr != nil {
		errMsg = stepErr.Error()
	}
	state.Steps[step] = StepState{
		Status:    StepFailed,
		Error:     errMsg,
		Timestamp: time.Now(),
	}
	state.UpdatedAt = time.Now()
	return t.saveLocked(slug, state)
}

// Skip marks a step as skipped.
func (t *pipelineTracker) Skip(slug string, wave int, step PipelineStep) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	state, err := t.loadOrInit(slug, wave)
	if err != nil {
		return err
	}

	state.Steps[step] = StepState{
		Status:    StepSkipped,
		Timestamp: time.Now(),
	}
	state.UpdatedAt = time.Now()
	return t.saveLocked(slug, state)
}

// Read returns the current PipelineState for a slug. Returns nil if none exists.
func (t *pipelineTracker) Read(slug string) *PipelineState {
	t.mu.Lock()
	defer t.mu.Unlock()

	data, err := os.ReadFile(t.statePath(slug))
	if err != nil {
		return nil
	}
	var state PipelineState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil
	}
	return &state
}

// Clear removes persisted state for a slug (called at run start).
func (t *pipelineTracker) Clear(slug string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	_ = os.Remove(t.statePath(slug))
}

// LastSuccessfulStep returns the last step (in pipeline order) that completed
// or was skipped. Returns empty string if no steps have succeeded.
// Both StepComplete and StepSkipped count as "passed" for resume purposes.
func (t *pipelineTracker) LastSuccessfulStep(slug string) PipelineStep {
	t.mu.Lock()
	defer t.mu.Unlock()

	data, err := os.ReadFile(t.statePath(slug))
	if err != nil {
		return ""
	}
	var state PipelineState
	if err := json.Unmarshal(data, &state); err != nil {
		return ""
	}

	var last PipelineStep
	for _, step := range PipelineStepOrder {
		s, ok := state.Steps[step]
		if !ok {
			break
		}
		if s.Status == StepComplete || s.Status == StepSkipped {
			last = step
		} else {
			// If a step is not complete/skipped, stop scanning.
			break
		}
	}
	return last
}

// loadOrInit loads existing state or initializes a new PipelineState.
// Must be called with mu held.
func (t *pipelineTracker) loadOrInit(slug string, wave int) (*PipelineState, error) {
	if err := os.MkdirAll(t.stateDir(), 0o755); err != nil {
		return nil, err
	}

	data, err := os.ReadFile(t.statePath(slug))
	if err != nil {
		return &PipelineState{
			Slug:  slug,
			Wave:  wave,
			Steps: make(map[PipelineStep]StepState),
		}, nil
	}
	var state PipelineState
	if err := json.Unmarshal(data, &state); err != nil {
		return &PipelineState{
			Slug:  slug,
			Wave:  wave,
			Steps: make(map[PipelineStep]StepState),
		}, nil
	}
	if state.Steps == nil {
		state.Steps = make(map[PipelineStep]StepState)
	}
	return &state, nil
}

// saveLocked persists state to disk using temp-file + rename for atomicity.
// Must be called with mu held.
func (t *pipelineTracker) saveLocked(slug string, state *PipelineState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	path := t.statePath(slug)
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
