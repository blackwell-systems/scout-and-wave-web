package orchestrator

import (
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// validTransitions maps each state to the set of states reachable from it.
// The SAW protocol defines 7 states with the following directed edges.
var validTransitions = map[types.State][]types.State{
	types.SuitabilityPending: {types.Reviewed, types.NotSuitable},
	types.Reviewed:           {types.WavePending},
	types.WavePending:        {types.WaveExecuting},
	types.WaveExecuting:      {types.WaveVerified},
	types.WaveVerified:       {types.Complete, types.WavePending},
	types.NotSuitable:        {},
	types.Complete:           {},
}

// isValidTransition returns true if transitioning from -> to is permitted
// by the SAW protocol state machine.
func isValidTransition(from, to types.State) bool {
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}
