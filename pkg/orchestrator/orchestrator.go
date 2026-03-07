package orchestrator

import (
	"fmt"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// parseIMPLDocFunc is replaced at runtime by pkg/protocol once that package
// is compiled. The default no-op implementation returns an empty IMPLDoc so
// that the orchestrator package compiles independently during Wave 1 parallel
// execution (Agent A owns pkg/protocol and may not be merged yet).
var parseIMPLDocFunc = func(path string) (*types.IMPLDoc, error) {
	return &types.IMPLDoc{}, nil
}

// validateInvariantsFunc is replaced by pkg/protocol via SetValidateInvariantsFunc.
// Default no-op for Wave 1 compilation.
var validateInvariantsFunc = func(doc *types.IMPLDoc) error { return nil }

// SetValidateInvariantsFunc allows pkg/protocol to inject the real implementation
// without a direct import cycle.
func SetValidateInvariantsFunc(f func(doc *types.IMPLDoc) error) {
	validateInvariantsFunc = f
}

// mergeWaveFunc is replaced by Agent F (Wave 3) in merge.go via init().
// Default no-op for Wave 1 compilation.
var mergeWaveFunc = func(o *Orchestrator, waveNum int) error { return nil }

// runVerificationFunc is replaced by Agent F (Wave 3) in verification.go via init().
// Default no-op for Wave 1 compilation.
var runVerificationFunc = func(o *Orchestrator, testCommand string) error { return nil }

// Orchestrator drives SAW protocol wave coordination.
// State mutations must go through TransitionTo — never set o.state directly.
type Orchestrator struct {
	state       types.State
	implDoc     *types.IMPLDoc
	repoPath    string
	currentWave int
	implDocPath string
}

// New creates an Orchestrator by loading the IMPL doc at implDocPath.
// Initial state is SuitabilityPending.
func New(repoPath string, implDocPath string) (*Orchestrator, error) {
	doc, err := parseIMPLDocFunc(implDocPath)
	if err != nil {
		return nil, fmt.Errorf("orchestrator.New: failed to parse IMPL doc %q: %w", implDocPath, err)
	}
	return &Orchestrator{
		state:       types.SuitabilityPending,
		implDoc:     doc,
		repoPath:    repoPath,
		implDocPath: implDocPath,
	}, nil
}

// newFromDoc creates an Orchestrator directly from a pre-parsed IMPLDoc.
// Used in tests to avoid the pkg/protocol dependency.
func newFromDoc(doc *types.IMPLDoc, repoPath, implDocPath string) *Orchestrator {
	return &Orchestrator{
		state:       types.SuitabilityPending,
		implDoc:     doc,
		repoPath:    repoPath,
		implDocPath: implDocPath,
	}
}

// State returns the current protocol state.
func (o *Orchestrator) State() types.State {
	return o.state
}

// IMPLDoc returns the parsed IMPL document.
func (o *Orchestrator) IMPLDoc() *types.IMPLDoc {
	return o.implDoc
}

// RepoPath returns the repository root path.
func (o *Orchestrator) RepoPath() string {
	return o.repoPath
}

// TransitionTo advances the state machine to newState.
// It returns a descriptive error if the transition is not permitted.
func (o *Orchestrator) TransitionTo(newState types.State) error {
	if !isValidTransition(o.state, newState) {
		return fmt.Errorf(
			"orchestrator: invalid state transition from %s to %s",
			o.state, newState,
		)
	}
	o.state = newState
	return nil
}

// RunWave executes wave waveNum. In Wave 1 this is a stub that validates
// the wave number exists in the IMPL doc. Full implementation is added in
// Wave 3 by the Orchestrator agent.
func (o *Orchestrator) RunWave(waveNum int) error {
	if o.implDoc == nil {
		return fmt.Errorf("orchestrator.RunWave: no IMPL doc loaded")
	}
	// I1: Validate disjoint file ownership before any worktrees are created.
	if err := validateInvariantsFunc(o.implDoc); err != nil {
		return fmt.Errorf("orchestrator.RunWave: invariant violation: %w", err)
	}
	// Validate the wave number exists in the document.
	found := false
	for _, w := range o.implDoc.Waves {
		if w.Number == waveNum {
			found = true
			break
		}
	}
	if !found && len(o.implDoc.Waves) > 0 {
		return fmt.Errorf("orchestrator.RunWave: wave %d not found in IMPL doc", waveNum)
	}
	o.currentWave = waveNum
	return nil
}

// MergeWave merges the worktrees for wave waveNum.
// Implementation is provided by Agent F (Wave 3) via mergeWaveFunc.
func (o *Orchestrator) MergeWave(waveNum int) error {
	return mergeWaveFunc(o, waveNum)
}

// RunVerification runs the post-merge test command.
// Implementation is provided by Agent F (Wave 3) via runVerificationFunc.
func (o *Orchestrator) RunVerification(testCommand string) error {
	return runVerificationFunc(o, testCommand)
}
