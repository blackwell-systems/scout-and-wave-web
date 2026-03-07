package orchestrator

import (
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// makeOrch is a helper that returns a fresh Orchestrator backed by an
// empty IMPLDoc so tests have no pkg/protocol dependency.
func makeOrch() *Orchestrator {
	return newFromDoc(&types.IMPLDoc{}, "/repo", "/repo/IMPL.md")
}

// TestTransitionTo_ValidTransitions exercises every edge in the state graph.
func TestTransitionTo_ValidTransitions(t *testing.T) {
	cases := []struct {
		from types.State
		to   types.State
	}{
		{types.SuitabilityPending, types.Reviewed},
		{types.SuitabilityPending, types.NotSuitable},
		{types.Reviewed, types.WavePending},
		{types.WavePending, types.WaveExecuting},
		{types.WaveExecuting, types.WaveVerified},
		{types.WaveVerified, types.Complete},
		{types.WaveVerified, types.WavePending},
	}

	for _, tc := range cases {
		o := makeOrch()
		// Manually set state to 'from' using the unexported field — allowed
		// within the same package (white-box test).
		o.state = tc.from

		if err := o.TransitionTo(tc.to); err != nil {
			t.Errorf("TransitionTo(%s -> %s): unexpected error: %v", tc.from, tc.to, err)
		}
		if o.State() != tc.to {
			t.Errorf("after TransitionTo(%s -> %s): state is %s, want %s",
				tc.from, tc.to, o.State(), tc.to)
		}
	}
}

// TestTransitionTo_InvalidTransition verifies that an illegal transition
// (SuitabilityPending -> Complete) returns an error.
func TestTransitionTo_InvalidTransition(t *testing.T) {
	o := makeOrch()
	// Initial state is SuitabilityPending.
	err := o.TransitionTo(types.Complete)
	if err == nil {
		t.Fatal("expected error for SuitabilityPending -> Complete, got nil")
	}
	if !strings.Contains(err.Error(), "SuitabilityPending") {
		t.Errorf("error should mention source state SuitabilityPending, got: %v", err)
	}
	if !strings.Contains(err.Error(), "Complete") {
		t.Errorf("error should mention target state Complete, got: %v", err)
	}
	// State must remain unchanged after a rejected transition.
	if o.State() != types.SuitabilityPending {
		t.Errorf("state changed after invalid transition: got %s", o.State())
	}
}

// TestTransitionTo_TerminalState verifies that NotSuitable and Complete
// cannot be exited.
func TestTransitionTo_TerminalState(t *testing.T) {
	terminalStates := []types.State{types.NotSuitable, types.Complete}
	// Every other state is a candidate target.
	allStates := []types.State{
		types.SuitabilityPending,
		types.Reviewed,
		types.WavePending,
		types.WaveExecuting,
		types.WaveVerified,
		types.NotSuitable,
		types.Complete,
	}

	for _, terminal := range terminalStates {
		for _, target := range allStates {
			o := makeOrch()
			o.state = terminal
			err := o.TransitionTo(target)
			if err == nil {
				t.Errorf("expected error transitioning from terminal state %s to %s, got nil",
					terminal, target)
			}
		}
	}
}

// TestIsValidTransition unit-tests the guard function directly.
func TestIsValidTransition(t *testing.T) {
	valid := []struct{ from, to types.State }{
		{types.SuitabilityPending, types.Reviewed},
		{types.SuitabilityPending, types.NotSuitable},
		{types.Reviewed, types.WavePending},
		{types.WavePending, types.WaveExecuting},
		{types.WaveExecuting, types.WaveVerified},
		{types.WaveVerified, types.Complete},
		{types.WaveVerified, types.WavePending},
	}
	for _, tc := range valid {
		if !isValidTransition(tc.from, tc.to) {
			t.Errorf("isValidTransition(%s, %s) = false, want true", tc.from, tc.to)
		}
	}

	invalid := []struct{ from, to types.State }{
		{types.SuitabilityPending, types.Complete},
		{types.SuitabilityPending, types.WaveExecuting},
		{types.Reviewed, types.Complete},
		{types.NotSuitable, types.Reviewed},
		{types.Complete, types.WavePending},
		{types.WaveExecuting, types.WavePending},
	}
	for _, tc := range invalid {
		if isValidTransition(tc.from, tc.to) {
			t.Errorf("isValidTransition(%s, %s) = true, want false", tc.from, tc.to)
		}
	}
}

// TestNewFromDoc verifies that newFromDoc sets the initial state correctly.
func TestNewFromDoc(t *testing.T) {
	doc := &types.IMPLDoc{
		FeatureName: "test-feature",
		Status:      "pending",
	}
	o := newFromDoc(doc, "/some/repo", "/some/repo/IMPL.md")

	if o.State() != types.SuitabilityPending {
		t.Errorf("initial state: got %s, want SuitabilityPending", o.State())
	}
	if o.IMPLDoc() != doc {
		t.Error("IMPLDoc() did not return the same pointer passed to newFromDoc")
	}
	if o.RepoPath() != "/some/repo" {
		t.Errorf("RepoPath(): got %q, want %q", o.RepoPath(), "/some/repo")
	}
	if o.implDocPath != "/some/repo/IMPL.md" {
		t.Errorf("implDocPath: got %q, want %q", o.implDocPath, "/some/repo/IMPL.md")
	}
}

// TestState_String verifies that each state produces a human-readable name.
// The String() method lives on types.State (defined in pkg/types). This test
// ensures the values round-trip correctly through the orchestrator layer.
func TestState_String(t *testing.T) {
	cases := []struct {
		state types.State
		want  string
	}{
		{types.SuitabilityPending, "SuitabilityPending"},
		{types.NotSuitable, "NotSuitable"},
		{types.Reviewed, "Reviewed"},
		{types.WavePending, "WavePending"},
		{types.WaveExecuting, "WaveExecuting"},
		{types.WaveVerified, "WaveVerified"},
		{types.Complete, "Complete"},
	}

	for _, tc := range cases {
		got := tc.state.String()
		if got != tc.want {
			t.Errorf("State(%d).String() = %q, want %q", int(tc.state), got, tc.want)
		}
	}
}
