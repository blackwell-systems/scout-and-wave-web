package orchestrator

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/worktree"
)

// makeOrch is a helper that returns a fresh Orchestrator backed by an
// empty IMPLDoc so tests have no pkg/protocol dependency.
func makeOrch() *Orchestrator {
	return newFromDoc(&types.IMPLDoc{}, "/repo", "/repo/IMPL.md")
}

// makeOrchWithWave returns an Orchestrator whose IMPLDoc contains one wave
// with the provided agents.
func makeOrchWithWave(waveNum int, letters ...string) *Orchestrator {
	agents := make([]types.AgentSpec, len(letters))
	for i, l := range letters {
		agents[i] = types.AgentSpec{Letter: l, Prompt: "do work"}
	}
	doc := &types.IMPLDoc{
		Waves: []types.Wave{
			{Number: waveNum, Agents: agents},
		},
	}
	return newFromDoc(doc, "/repo", "/repo/IMPL.md")
}

// fakeToolSender is a Sender+ToolRunner that records calls and optionally
// returns an error for a specific agent letter.
type fakeToolSender struct {
	mu         sync.Mutex
	called     []string
	failLetter string
	// runFn, if non-nil, is called instead of the default behaviour.
	runFn func(prompt string) (string, error)
}

func (f *fakeToolSender) SendMessage(_, _ string) (string, error) {
	return "ok", nil
}

func (f *fakeToolSender) RunWithTools(_ context.Context, prompt string, _ []agent.Tool, _ int) (string, error) {
	f.mu.Lock()
	f.called = append(f.called, prompt)
	fn := f.runFn
	failLetter := f.failLetter
	f.mu.Unlock()

	if fn != nil {
		return fn(prompt)
	}
	if failLetter != "" && prompt == failLetter {
		return "", errors.New("simulated agent failure")
	}
	return "response", nil
}

// TestNew_LoadsDoc verifies that New returns a non-nil Orchestrator in
// ScoutPending state when parseIMPLDocFunc succeeds.
func TestNew_LoadsDoc(t *testing.T) {
	orig := parseIMPLDocFunc
	t.Cleanup(func() { parseIMPLDocFunc = orig })
	parseIMPLDocFunc = func(_ string) (*types.IMPLDoc, error) {
		return &types.IMPLDoc{FeatureName: "test"}, nil
	}

	o, err := New("/repo", "/repo/IMPL.md")
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	if o == nil {
		t.Fatal("New returned nil orchestrator")
	}
	if o.State() != types.ScoutPending {
		t.Errorf("initial state = %s, want ScoutPending", o.State())
	}
	if o.IMPLDoc().FeatureName != "test" {
		t.Errorf("FeatureName = %q, want %q", o.IMPLDoc().FeatureName, "test")
	}
}

// TestSetValidateInvariantsFunc verifies the func is replaced and called.
func TestSetValidateInvariantsFunc(t *testing.T) {
	orig := validateInvariantsFunc
	t.Cleanup(func() { validateInvariantsFunc = orig })

	called := false
	SetValidateInvariantsFunc(func(_ *types.IMPLDoc) error {
		called = true
		return nil
	})
	_ = validateInvariantsFunc(nil)
	if !called {
		t.Error("SetValidateInvariantsFunc: replacement was not called")
	}
}

// TestMergeWave_DelegatesTo_mergeWaveFunc verifies that MergeWave delegates
// to mergeWaveFunc and propagates its return value.
func TestMergeWave_DelegatesTo_mergeWaveFunc(t *testing.T) {
	orig := mergeWaveFunc
	t.Cleanup(func() { mergeWaveFunc = orig })

	var gotWave int
	mergeWaveFunc = func(_ *Orchestrator, waveNum int) error {
		gotWave = waveNum
		return nil
	}

	o := makeOrch()
	if err := o.MergeWave(3); err != nil {
		t.Fatalf("MergeWave returned error: %v", err)
	}
	if gotWave != 3 {
		t.Errorf("mergeWaveFunc called with wave %d, want 3", gotWave)
	}
}

// TestRunVerification_DelegatesTo_runVerificationFunc verifies delegation.
func TestRunVerification_DelegatesTo_runVerificationFunc(t *testing.T) {
	orig := runVerificationFunc
	t.Cleanup(func() { runVerificationFunc = orig })

	var gotCmd string
	runVerificationFunc = func(_ *Orchestrator, cmd string) error {
		gotCmd = cmd
		return nil
	}

	o := makeOrch()
	if err := o.RunVerification("go test ./..."); err != nil {
		t.Fatalf("RunVerification returned error: %v", err)
	}
	if gotCmd != "go test ./..." {
		t.Errorf("runVerificationFunc called with %q, want %q", gotCmd, "go test ./...")
	}
}

// TestRunWave_WaveNotFound verifies that RunWave returns an error when the
// requested wave number is absent from the IMPL doc.
func TestRunWave_WaveNotFound(t *testing.T) {
	o := makeOrchWithWave(1, "A", "B")
	err := o.RunWave(99)
	if err == nil {
		t.Fatal("expected error for missing wave 99, got nil")
	}
	if !strings.Contains(err.Error(), "99") {
		t.Errorf("error should mention wave number 99, got: %v", err)
	}
}

// TestRunWave_LaunchesAllAgents verifies that RunWave calls ExecuteWithTools
// for every agent in the wave, and does so concurrently (both goroutines are
// in-flight at the same time, proven by an overlap barrier).
func TestRunWave_LaunchesAllAgents(t *testing.T) {
	// Use a barrier: each agent increments a counter then waits until both
	// have arrived before proceeding. If RunWave were sequential, the second
	// agent would never start until the first finished — but the first is
	// blocking on the barrier, so the test would deadlock (caught by -timeout).
	var inFlight int32
	barrier := make(chan struct{})

	fake := &fakeToolSender{}
	fake.runFn = func(prompt string) (string, error) {
		if atomic.AddInt32(&inFlight, 1) == 2 {
			// Both goroutines have arrived — release the barrier.
			close(barrier)
		}
		// Wait for the other goroutine to also arrive (proves overlap).
		select {
		case <-barrier:
		case <-time.After(5 * time.Second):
			return "", errors.New("barrier timeout: agents did not run concurrently")
		}
		return "response", nil
	}

	// Track worktree creations without real git.
	var worktreeCount int32
	origCreator := worktreeCreatorFunc
	origWait := waitForCompletionFunc
	t.Cleanup(func() {
		worktreeCreatorFunc = origCreator
		waitForCompletionFunc = origWait
	})
	worktreeCreatorFunc = func(_ *worktree.Manager, _ int, letter string) (string, error) {
		atomic.AddInt32(&worktreeCount, 1)
		return "/tmp/fake-wt-" + letter, nil
	}
	waitForCompletionFunc = func(_, _ string, _, _ time.Duration) (*types.CompletionReport, error) {
		return &types.CompletionReport{Status: types.StatusComplete}, nil
	}

	doc := &types.IMPLDoc{
		Waves: []types.Wave{
			{
				Number: 1,
				Agents: []types.AgentSpec{
					{Letter: "A", Prompt: "A"},
					{Letter: "B", Prompt: "B"},
				},
			},
		},
	}
	o := newFromDoc(doc, "/repo", "/repo/IMPL.md")

	origNewRunner := newRunnerFunc
	t.Cleanup(func() { newRunnerFunc = origNewRunner })
	newRunnerFunc = func(wm *worktree.Manager) *agent.Runner {
		return agent.NewRunner(fake, wm)
	}

	if err := o.RunWave(1); err != nil {
		t.Fatalf("RunWave returned unexpected error: %v", err)
	}

	// Both worktrees were created.
	if n := atomic.LoadInt32(&worktreeCount); n != 2 {
		t.Errorf("expected 2 worktrees created, got %d", n)
	}

	// Both agents were called.
	fake.mu.Lock()
	calledCount := len(fake.called)
	fake.mu.Unlock()
	if calledCount != 2 {
		t.Errorf("expected 2 ExecuteWithTools calls, got %d", calledCount)
	}
}

// TestRunWave_ReturnsErrorOnAgentFailure verifies that RunWave propagates an
// error when one agent's ExecuteWithTools call fails.
func TestRunWave_ReturnsErrorOnAgentFailure(t *testing.T) {
	fake := &fakeToolSender{failLetter: "B"}

	origCreator := worktreeCreatorFunc
	origWait := waitForCompletionFunc
	t.Cleanup(func() {
		worktreeCreatorFunc = origCreator
		waitForCompletionFunc = origWait
	})
	worktreeCreatorFunc = func(_ *worktree.Manager, _ int, letter string) (string, error) {
		return "/tmp/fake-wt-" + letter, nil
	}
	waitForCompletionFunc = func(_, _ string, _, _ time.Duration) (*types.CompletionReport, error) {
		return &types.CompletionReport{Status: types.StatusComplete}, nil
	}

	doc := &types.IMPLDoc{
		Waves: []types.Wave{
			{
				Number: 1,
				Agents: []types.AgentSpec{
					{Letter: "A", Prompt: "A"},
					{Letter: "B", Prompt: "B"},
				},
			},
		},
	}
	o := newFromDoc(doc, "/repo", "/repo/IMPL.md")

	origNewRunner := newRunnerFunc
	t.Cleanup(func() { newRunnerFunc = origNewRunner })
	newRunnerFunc = func(wm *worktree.Manager) *agent.Runner {
		return agent.NewRunner(fake, wm)
	}

	err := o.RunWave(1)
	if err == nil {
		t.Fatal("expected error when agent B fails, got nil")
	}
	if !strings.Contains(err.Error(), "simulated agent failure") {
		t.Errorf("error should contain the agent failure message, got: %v", err)
	}
}

// TestTransitionTo_ValidTransitions exercises every edge in the state graph.
func TestTransitionTo_ValidTransitions(t *testing.T) {
	cases := []struct {
		from types.State
		to   types.State
	}{
		{types.ScoutPending, types.Reviewed},
		{types.ScoutPending, types.NotSuitable},
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
// (ScoutPending -> Complete) returns an error.
func TestTransitionTo_InvalidTransition(t *testing.T) {
	o := makeOrch()
	// Initial state is ScoutPending.
	err := o.TransitionTo(types.Complete)
	if err == nil {
		t.Fatal("expected error for ScoutPending -> Complete, got nil")
	}
	if !strings.Contains(err.Error(), "ScoutPending") {
		t.Errorf("error should mention source state ScoutPending, got: %v", err)
	}
	if !strings.Contains(err.Error(), "Complete") {
		t.Errorf("error should mention target state Complete, got: %v", err)
	}
	// State must remain unchanged after a rejected transition.
	if o.State() != types.ScoutPending {
		t.Errorf("state changed after invalid transition: got %s", o.State())
	}
}

// TestTransitionTo_TerminalState verifies that NotSuitable and Complete
// cannot be exited.
func TestTransitionTo_TerminalState(t *testing.T) {
	terminalStates := []types.State{types.NotSuitable, types.Complete}
	// Every other state is a candidate target.
	allStates := []types.State{
		types.ScoutPending,
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
		{types.ScoutPending, types.Reviewed},
		{types.ScoutPending, types.NotSuitable},
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
		{types.ScoutPending, types.Complete},
		{types.ScoutPending, types.WaveExecuting},
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

	if o.State() != types.ScoutPending {
		t.Errorf("initial state: got %s, want ScoutPending", o.State())
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

// TestSetEventPublisher_NilPublisher_NoOp verifies that RunWave works correctly
// when no EventPublisher has been set (no panic on publish calls).
func TestSetEventPublisher_NilPublisher_NoOp(t *testing.T) {
	origCreator := worktreeCreatorFunc
	origWait := waitForCompletionFunc
	origNewRunner := newRunnerFunc
	t.Cleanup(func() {
		worktreeCreatorFunc = origCreator
		waitForCompletionFunc = origWait
		newRunnerFunc = origNewRunner
	})

	worktreeCreatorFunc = func(_ *worktree.Manager, _ int, letter string) (string, error) {
		return "/tmp/fake-wt-" + letter, nil
	}
	waitForCompletionFunc = func(_, _ string, _, _ time.Duration) (*types.CompletionReport, error) {
		return &types.CompletionReport{Status: types.StatusComplete}, nil
	}

	fake := &fakeToolSender{}
	newRunnerFunc = func(wm *worktree.Manager) *agent.Runner {
		return agent.NewRunner(fake, wm)
	}

	o := makeOrchWithWave(1, "A")
	// Do not call SetEventPublisher — eventPublisher is nil.

	if err := o.RunWave(1); err != nil {
		t.Fatalf("RunWave with nil publisher returned unexpected error: %v", err)
	}
}

// TestPublish_EmitsAgentStarted verifies that an injected EventPublisher
// receives an "agent_started" event when RunWave launches an agent.
func TestPublish_EmitsAgentStarted(t *testing.T) {
	origCreator := worktreeCreatorFunc
	origWait := waitForCompletionFunc
	origNewRunner := newRunnerFunc
	t.Cleanup(func() {
		worktreeCreatorFunc = origCreator
		waitForCompletionFunc = origWait
		newRunnerFunc = origNewRunner
	})

	worktreeCreatorFunc = func(_ *worktree.Manager, _ int, letter string) (string, error) {
		return "/tmp/fake-wt-" + letter, nil
	}
	waitForCompletionFunc = func(_, _ string, _, _ time.Duration) (*types.CompletionReport, error) {
		return &types.CompletionReport{Status: types.StatusComplete}, nil
	}

	fake := &fakeToolSender{}
	newRunnerFunc = func(wm *worktree.Manager) *agent.Runner {
		return agent.NewRunner(fake, wm)
	}

	// Capture all published events.
	var mu sync.Mutex
	var received []OrchestratorEvent
	publisher := func(ev OrchestratorEvent) {
		mu.Lock()
		received = append(received, ev)
		mu.Unlock()
	}

	o := makeOrchWithWave(1, "A")
	o.SetEventPublisher(publisher)

	if err := o.RunWave(1); err != nil {
		t.Fatalf("RunWave returned unexpected error: %v", err)
	}

	// Verify we received at least one agent_started event.
	mu.Lock()
	defer mu.Unlock()

	var found bool
	for _, ev := range received {
		if ev.Event == "agent_started" {
			found = true
			payload, ok := ev.Data.(AgentStartedPayload)
			if !ok {
				t.Errorf("agent_started Data is %T, want AgentStartedPayload", ev.Data)
				break
			}
			if payload.Agent != "A" {
				t.Errorf("agent_started payload.Agent = %q, want %q", payload.Agent, "A")
			}
			if payload.Wave != 1 {
				t.Errorf("agent_started payload.Wave = %d, want 1", payload.Wave)
			}
			break
		}
	}
	if !found {
		t.Errorf("no agent_started event received; got events: %v", received)
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
		{types.ScoutPending, "ScoutPending"},
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
