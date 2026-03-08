package api

import (
	"fmt"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

func init() {
	// Wire the real IMPL doc parser and invariant validator so that
	// orchestrator.New parses IMPL docs and validates disjoint file ownership.
	// This mirrors the wiring done in cmd/saw/commands.go for the CLI binary.
	orchestrator.SetParseIMPLDocFunc(protocol.ParseIMPLDoc)
	orchestrator.SetValidateInvariantsFunc(protocol.ValidateInvariants)
}

// gateChannels stores per-slug gate channels used to pause runWaveLoop
// between waves. Keys are slugs (string), values are chan bool (buffered 1).
var gateChannels sync.Map

// waveOrchestrator is the interface needed by runWaveLoop.
// Matches pkg/orchestrator.Orchestrator methods.
type waveOrchestrator interface {
	RunWave(waveNum int) error
	MergeWave(waveNum int) error
	RunVerification(testCommand string) error
	UpdateIMPLStatus(waveNum int) error
	IMPLDoc() *types.IMPLDoc
}

// runWaveLoopFunc is the seam used by handleWaveStart. Tests can replace this
// to inject a no-op and avoid real git/API calls in unit tests.
var runWaveLoopFunc = runWaveLoop

// handleWaveStart handles POST /api/wave/{slug}/start.
// It checks whether the slug is already running (409), marks it active, then
// launches wave execution in a background goroutine and immediately returns 202.
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Check for an already-active run; store atomically if not present.
	if _, loaded := s.activeRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "wave already running", http.StatusConflict)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
	publish := s.makePublisher(slug)

	go func() {
		defer s.activeRuns.Delete(slug)
		runWaveLoopFunc(implPath, slug, s.cfg.RepoPath, publish)
	}()

	w.WriteHeader(http.StatusAccepted)
}

// runWaveLoop is the background goroutine body. It creates an orchestrator,
// wires the SSE event publisher, and executes all waves defined in the IMPL
// doc in order: RunWave → MergeWave → RunVerification → UpdateIMPLStatus.
//
// Between waves, runWaveLoop publishes a "wave_gate_pending" SSE event and
// blocks for up to 30 minutes waiting for a proceed signal via gateChannels.
// If the gate times out or receives false, it publishes "run_failed" and
// returns. If it receives true, it publishes "wave_gate_resolved" and
// continues to the next wave.
//
// On any error the function publishes "run_failed" and returns.
// On success it publishes "run_complete".
func runWaveLoop(implPath, slug, repoPath string, publish func(event string, data interface{})) {
	publish("run_started", map[string]string{"slug": slug, "impl_path": implPath})

	// Create the orchestrator; New parses the IMPL doc via parseIMPLDocFunc
	// (wired to protocol.ParseIMPLDoc by this package's init()).
	orch, err := orchestrator.New(repoPath, implPath)
	if err != nil {
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}

	// Inject the SSE event publisher so orchestrator events are forwarded
	// to the browser's SSE stream.
	orch.SetEventPublisher(func(ev orchestrator.OrchestratorEvent) {
		publish(ev.Event, ev.Data)
	})

	// Execute all waves in the order they appear in the IMPL doc.
	waves := orch.IMPLDoc().Waves
	totalAgents := 0
	for _, w := range waves {
		totalAgents += len(w.Agents)
	}

	for i, wave := range waves {
		waveNum := wave.Number

		if err := orch.RunWave(waveNum); err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}

		if err := orch.MergeWave(waveNum); err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}

		testCmd := orch.IMPLDoc().TestCommand
		if testCmd != "" {
			if err := orch.RunVerification(testCmd); err != nil {
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
		}

		if err := orch.UpdateIMPLStatus(waveNum); err != nil {
			// Non-fatal: mirrors the CLI behaviour (warning, not abort).
			publish("update_status_failed", map[string]string{
				"wave":  slug,
				"error": err.Error(),
			})
		}

		// If there is a next wave, pause at the gate and wait for approval.
		if i < len(waves)-1 {
			nextWaveNum := waves[i+1].Number

			// Create a buffered channel and register it so handleWaveGateProceed
			// can signal us.
			gateCh := make(chan bool, 1)
			gateChannels.Store(slug, gateCh)

			publish("wave_gate_pending", map[string]interface{}{
				"wave":      waveNum,
				"next_wave": nextWaveNum,
				"slug":      slug,
			})

			const gateTimeout = 30 * time.Minute
			select {
			case ok := <-gateCh:
				gateChannels.Delete(slug)
				if !ok {
					publish("run_failed", map[string]string{
						"error": "gate cancelled or timed out",
					})
					return
				}
				publish("wave_gate_resolved", map[string]interface{}{
					"wave":   waveNum,
					"action": "proceed",
					"slug":   slug,
				})
			case <-time.After(gateTimeout):
				gateChannels.Delete(slug)
				publish("run_failed", map[string]string{
					"error": "gate cancelled or timed out",
				})
				return
			}
		}
	}

	publish("run_complete", orchestrator.RunCompletePayload{
		Status: "success",
		Waves:  len(waves),
		Agents: totalAgents,
	})
}

// handleWaveGateProceed handles POST /api/wave/{slug}/gate/proceed.
// It looks up the gate channel for the slug and sends true to unblock
// runWaveLoop so it continues to the next wave. Returns 202 Accepted.
func (s *Server) handleWaveGateProceed(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	val, ok := gateChannels.Load(slug)
	if !ok {
		http.Error(w, fmt.Sprintf("no gate pending for slug %q", slug), http.StatusNotFound)
		return
	}

	ch, ok := val.(chan bool)
	if !ok {
		http.Error(w, "internal: gate channel type assertion failed", http.StatusInternalServerError)
		return
	}

	// Non-blocking send: if the channel already has a value (e.g. double-click),
	// we just drop this one rather than blocking.
	select {
	case ch <- true:
	default:
	}

	w.WriteHeader(http.StatusAccepted)
}

// handleWaveAgentRerun handles POST /api/wave/{slug}/agent/{letter}/rerun.
// This is a stub — re-run is not yet implemented. Returns 202 Accepted with
// a JSON body indicating the stub status.
//
// TODO: Full implementation required in a follow-up wave. The handler should
// re-spawn the named agent worktree, re-run its assigned task, and update
// the IMPL doc status accordingly.
func (s *Server) handleWaveAgentRerun(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	letter := r.PathValue("letter")

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, `{"status":"stub","message":"agent rerun not yet implemented","slug":%q,"agent":%q}`, slug, letter)
}

// makePublisher creates a function that maps orchestrator events to SSE events.
func (s *Server) makePublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		s.broker.Publish(slug, SSEEvent{Event: event, Data: data})
	}
}
