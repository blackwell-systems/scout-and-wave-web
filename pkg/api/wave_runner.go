package api

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// gateChannels stores per-slug gate channels used to pause runWaveLoop
// between waves. Keys are slugs (string), values are chan bool (buffered 1).
var gateChannels sync.Map

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

	implPath := s.cfg.IMPLDir + "/IMPL-" + slug + ".md"
	publish := s.makePublisher(slug)

	go func() {
		defer s.activeRuns.Delete(slug)
		runWaveLoopFunc(implPath, slug, s.cfg.RepoPath, publish)
		// Notify all sidebar clients that doc status may have changed
		// (e.g. COMPLETE marker written, waves finished).
		s.globalBroker.broadcast("impl_list_updated")
	}()

	w.WriteHeader(http.StatusAccepted)
}

// runWaveLoop is the background goroutine body. It uses the engine package to
// parse the IMPL doc, then executes waves one at a time. Between waves it
// publishes a "wave_gate_pending" SSE event and blocks for up to 30 minutes
// waiting for a proceed signal via gateChannels.
//
// On any error the function publishes "run_failed" and returns.
// On success it publishes "run_complete".
func runWaveLoop(implPath, slug, repoPath string, publish func(event string, data interface{})) {
	publish("run_started", map[string]string{"slug": slug, "impl_path": implPath})

	// Parse the IMPL doc via the engine to get wave structure.
	doc, err := engine.ParseIMPLDoc(implPath)
	if err != nil {
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}
	if doc == nil {
		publish("run_failed", map[string]string{"error": "failed to parse IMPL doc: " + implPath})
		return
	}

	ctx := context.Background()

	// Run scaffold agent if needed (engine handles the check internally).
	if err := engine.RunScaffold(ctx, implPath, repoPath, "", func(ev engine.Event) {
		publish(ev.Event, ev.Data)
	}); err != nil {
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}

	waves := doc.Waves
	totalAgents := 0
	for _, w := range waves {
		totalAgents += len(w.Agents)
	}

	// Execute all waves one at a time, pausing at gates between them.
	for i, wave := range waves {
		waveNum := wave.Number

		opts := engine.RunWaveOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			Slug:     slug,
		}

		enginePublisher := func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}
		if err := engine.RunSingleWave(ctx, opts, waveNum, enginePublisher); err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}

		if err := engine.MergeWave(ctx, engine.RunMergeOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  waveNum,
		}); err != nil {
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}

		testCmd := doc.TestCommand
		if testCmd != "" {
			if err := engine.RunVerification(ctx, engine.RunVerificationOpts{
				RepoPath:    repoPath,
				TestCommand: testCmd,
			}); err != nil {
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
		}

		completedLetters := make([]string, 0, len(wave.Agents))
		for _, ag := range wave.Agents {
			completedLetters = append(completedLetters, ag.Letter)
		}
		if err := engine.UpdateIMPLStatus(implPath, completedLetters); err != nil {
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

	publish("run_complete", map[string]interface{}{
		"status": "success",
		"waves":  len(waves),
		"agents": totalAgents,
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

// makeEnginePublisher converts engine.Event to api.SSEEvent and publishes to the broker.
func (s *Server) makeEnginePublisher(slug string) func(engine.Event) {
	return func(ev engine.Event) {
		s.broker.Publish(slug, SSEEvent{Event: ev.Event, Data: ev.Data})
	}
}
