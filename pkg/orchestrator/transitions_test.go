package orchestrator

import (
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

func TestNewStates_StringRepresentation(t *testing.T) {
	tests := []struct {
		state    types.State
		expected string
	}{
		{types.ScaffoldPending, "ScaffoldPending"},
		{types.WaveMerging, "WaveMerging"},
		{types.Blocked, "Blocked"},
	}
	for _, tt := range tests {
		if got := tt.state.String(); got != tt.expected {
			t.Errorf("State(%d).String() = %q, want %q", int(tt.state), got, tt.expected)
		}
	}
}

func TestTransitions_ScaffoldPending(t *testing.T) {
	if !isValidTransition(types.ScaffoldPending, types.WavePending) {
		t.Error("ScaffoldPending -> WavePending should be valid")
	}
	if !isValidTransition(types.ScaffoldPending, types.Blocked) {
		t.Error("ScaffoldPending -> Blocked should be valid")
	}
	if isValidTransition(types.ScaffoldPending, types.Complete) {
		t.Error("ScaffoldPending -> Complete should be invalid")
	}
}

func TestTransitions_WaveMerging(t *testing.T) {
	if !isValidTransition(types.WaveMerging, types.WaveVerified) {
		t.Error("WaveMerging -> WaveVerified should be valid")
	}
	if !isValidTransition(types.WaveMerging, types.Blocked) {
		t.Error("WaveMerging -> Blocked should be valid")
	}
	if isValidTransition(types.WaveMerging, types.WavePending) {
		t.Error("WaveMerging -> WavePending should be invalid")
	}
}

func TestTransitions_Blocked(t *testing.T) {
	if !isValidTransition(types.Blocked, types.WavePending) {
		t.Error("Blocked -> WavePending should be valid")
	}
	if !isValidTransition(types.Blocked, types.WaveVerified) {
		t.Error("Blocked -> WaveVerified should be valid")
	}
	if isValidTransition(types.Blocked, types.Complete) {
		t.Error("Blocked -> Complete should be invalid")
	}
}

func TestTransitions_ReviewedToScaffoldPending(t *testing.T) {
	if !isValidTransition(types.Reviewed, types.ScaffoldPending) {
		t.Error("Reviewed -> ScaffoldPending should be valid")
	}
}

func TestTransitions_WaveExecutingToMerging(t *testing.T) {
	if !isValidTransition(types.WaveExecuting, types.WaveMerging) {
		t.Error("WaveExecuting -> WaveMerging should be valid")
	}
}
