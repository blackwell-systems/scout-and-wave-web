package api

import (
	"net/http"
	"path/filepath"

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

	for _, wave := range waves {
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
	}

	publish("run_complete", orchestrator.RunCompletePayload{
		Status: "success",
		Waves:  len(waves),
		Agents: totalAgents,
	})
}

// makePublisher creates a function that maps orchestrator events to SSE events.
func (s *Server) makePublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		s.broker.Publish(slug, SSEEvent{Event: event, Data: data})
	}
}
