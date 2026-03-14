package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// fakeWaveOrch is a test double for waveOrchestrator.
// It tracks RunWave/MergeWave/RunVerification calls and drives a minimal
// state machine so TransitionTo behaves correctly.
type fakeWaveOrch struct {
	doc            *types.IMPLDoc
	state          protocol.ProtocolState
	runWaveCalls   []int
	mergeWaveCalls []int
	runVerifCalls  []string
	// transitionErr, if non-nil, is returned by the next TransitionTo call.
	transitionErr error
}

// validTransitions mirrors the SAW state machine for the states runWave uses.
var fakeValidTransitions = map[protocol.ProtocolState][]protocol.ProtocolState{
	protocol.StateScoutPending:  {protocol.StateReviewed, protocol.StateNotSuitable},
	protocol.StateReviewed:      {protocol.StateWavePending},
	protocol.StateWavePending:   {protocol.StateWaveExecuting},
	protocol.StateWaveExecuting: {protocol.StateWaveVerified},
	protocol.StateWaveVerified:  {protocol.StateComplete, protocol.StateWavePending},
}

func (f *fakeWaveOrch) TransitionTo(newState protocol.ProtocolState) error {
	if f.transitionErr != nil {
		err := f.transitionErr
		f.transitionErr = nil
		return err
	}
	allowed, ok := fakeValidTransitions[f.state]
	if !ok {
		return errors.New("fakeWaveOrch: no transitions from " + string(f.state))
	}
	for _, s := range allowed {
		if s == newState {
			f.state = newState
			return nil
		}
	}
	return errors.New("fakeWaveOrch: invalid transition " + string(f.state) + " -> " + string(newState))
}

func (f *fakeWaveOrch) RunWave(waveNum int) error {
	f.runWaveCalls = append(f.runWaveCalls, waveNum)
	return nil
}

func (f *fakeWaveOrch) MergeWave(waveNum int) error {
	f.mergeWaveCalls = append(f.mergeWaveCalls, waveNum)
	return nil
}

func (f *fakeWaveOrch) RunVerification(testCommand string) error {
	f.runVerifCalls = append(f.runVerifCalls, testCommand)
	return nil
}

func (f *fakeWaveOrch) UpdateIMPLStatus(waveNum int) error {
	return nil
}

func (f *fakeWaveOrch) IMPLDoc() *types.IMPLDoc {
	return f.doc
}

// makeIMPLWithWaves builds a minimal IMPLDoc with the given wave numbers.
func makeIMPLWithWaves(waveNums ...int) *types.IMPLDoc {
	waves := make([]types.Wave, len(waveNums))
	for i, n := range waveNums {
		waves[i] = types.Wave{
			Number: n,
			Agents: []types.AgentSpec{{Letter: "A", Prompt: "do work"}},
		}
	}
	return &types.IMPLDoc{
		FeatureName: "Test Feature",
		Waves:       waves,
		TestCommand: "go test ./...",
	}
}

// setupRunWaveTest creates a temp directory with a .git dir (so findRepoRoot
// succeeds) and a placeholder IMPL doc file. It injects fake into
// orchestratorNewFunc and returns a cleanup function.
func setupRunWaveTest(t *testing.T, fake *fakeWaveOrch) (implPath string, cleanup func()) {
	t.Helper()
	dir := t.TempDir()

	// Create .git so findRepoRoot succeeds.
	if err := os.Mkdir(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatalf("failed to create .git: %v", err)
	}

	// Create a placeholder IMPL doc file (content unused; fake provides the doc).
	implPath = filepath.Join(dir, "IMPL-test.yaml")
	if err := os.WriteFile(implPath, []byte("# IMPL: Test Feature\n"), 0o644); err != nil {
		t.Fatalf("failed to write IMPL doc: %v", err)
	}

	// Inject the fake orchestrator.
	orig := orchestratorNewFunc
	orchestratorNewFunc = func(repoPath, ip string) (waveOrchestrator, error) {
		return fake, nil
	}

	cleanup = func() {
		orchestratorNewFunc = orig
	}
	return implPath, cleanup
}

// TestRunWave_SingleWave_Completes verifies that a one-wave IMPL doc runs
// exactly one wave and exits with nil, reaching the Complete state.
func TestRunWave_SingleWave_Completes(t *testing.T) {
	fake := &fakeWaveOrch{
		doc:   makeIMPLWithWaves(1),
		state: protocol.StateScoutPending,
	}
	implPath, cleanup := setupRunWaveTest(t, fake)
	defer cleanup()

	err := runWave([]string{"--impl", implPath, "--wave", "1", "--auto"})
	if err != nil {
		t.Fatalf("runWave returned unexpected error: %v", err)
	}

	// Exactly one RunWave call for wave 1.
	if len(fake.runWaveCalls) != 1 || fake.runWaveCalls[0] != 1 {
		t.Errorf("expected RunWave called once with wave 1, got: %v", fake.runWaveCalls)
	}

	// Exactly one MergeWave call for wave 1.
	if len(fake.mergeWaveCalls) != 1 || fake.mergeWaveCalls[0] != 1 {
		t.Errorf("expected MergeWave called once with wave 1, got: %v", fake.mergeWaveCalls)
	}

	// Exactly one RunVerification call.
	if len(fake.runVerifCalls) != 1 {
		t.Errorf("expected RunVerification called once, got: %v", fake.runVerifCalls)
	}

	// Final state must be Complete.
	if fake.state != protocol.StateComplete {
		t.Errorf("expected final state Complete, got: %s", fake.state)
	}
}

// TestRunWave_MultiWave_LoopsAll verifies that a two-wave IMPL doc iterates
// both waves in order and reaches Complete when --auto is set (no prompts).
func TestRunWave_MultiWave_LoopsAll(t *testing.T) {
	fake := &fakeWaveOrch{
		doc:   makeIMPLWithWaves(1, 2),
		state: protocol.StateScoutPending,
	}
	implPath, cleanup := setupRunWaveTest(t, fake)
	defer cleanup()

	err := runWave([]string{"--impl", implPath, "--wave", "1", "--auto"})
	if err != nil {
		t.Fatalf("runWave returned unexpected error: %v", err)
	}

	// Both waves must have been executed in order.
	if len(fake.runWaveCalls) != 2 {
		t.Fatalf("expected 2 RunWave calls, got %d: %v", len(fake.runWaveCalls), fake.runWaveCalls)
	}
	if fake.runWaveCalls[0] != 1 {
		t.Errorf("expected first RunWave call for wave 1, got: %d", fake.runWaveCalls[0])
	}
	if fake.runWaveCalls[1] != 2 {
		t.Errorf("expected second RunWave call for wave 2, got: %d", fake.runWaveCalls[1])
	}

	// Two MergeWave calls.
	if len(fake.mergeWaveCalls) != 2 {
		t.Errorf("expected 2 MergeWave calls, got %d: %v", len(fake.mergeWaveCalls), fake.mergeWaveCalls)
	}

	// Two RunVerification calls.
	if len(fake.runVerifCalls) != 2 {
		t.Errorf("expected 2 RunVerification calls, got %d: %v", len(fake.runVerifCalls), fake.runVerifCalls)
	}

	// Final state must be Complete.
	if fake.state != protocol.StateComplete {
		t.Errorf("expected final state Complete, got: %s", fake.state)
	}
}

// TestRunWave_StartFromWave2 verifies that --wave 2 skips wave 1 and runs
// wave 2 onward (in a two-wave doc), then reaches Complete.
func TestRunWave_StartFromWave2(t *testing.T) {
	fake := &fakeWaveOrch{
		doc:   makeIMPLWithWaves(1, 2),
		state: protocol.StateScoutPending,
	}
	implPath, cleanup := setupRunWaveTest(t, fake)
	defer cleanup()

	err := runWave([]string{"--impl", implPath, "--wave", "2", "--auto"})
	if err != nil {
		t.Fatalf("runWave returned unexpected error: %v", err)
	}

	// Only wave 2 should have been executed (wave 1 skipped).
	if len(fake.runWaveCalls) != 1 {
		t.Fatalf("expected 1 RunWave call, got %d: %v", len(fake.runWaveCalls), fake.runWaveCalls)
	}
	if fake.runWaveCalls[0] != 2 {
		t.Errorf("expected RunWave called with wave 2, got: %d", fake.runWaveCalls[0])
	}

	// One MergeWave call for wave 2.
	if len(fake.mergeWaveCalls) != 1 || fake.mergeWaveCalls[0] != 2 {
		t.Errorf("expected MergeWave called once with wave 2, got: %v", fake.mergeWaveCalls)
	}

	// Final state must be Complete.
	if fake.state != protocol.StateComplete {
		t.Errorf("expected final state Complete, got: %s", fake.state)
	}
}
