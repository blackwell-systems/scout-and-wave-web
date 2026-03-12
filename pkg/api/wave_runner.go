package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
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

	implPath := s.cfg.IMPLDir + "/IMPL-" + slug + ".yaml"
	publish := s.makePublisher(slug)

	// Clear previous stage state so the timeline starts fresh for this run.
	s.stages.Clear(slug)
	onStage := s.makeStageCallback(slug, publish)

	go func() {
		defer s.activeRuns.Delete(slug)
		runWaveLoopFunc(implPath, slug, s.cfg.RepoPath, publish, onStage)
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
// onStage is called at each stage transition; it handles both file persistence
// and SSE broadcast via the closure created in handleWaveStart.
//
// On any error the function publishes "run_failed" and returns.
// On success it publishes "run_complete".
func runWaveLoop(
	implPath, slug, repoPath string,
	publish func(event string, data interface{}),
	onStage func(ExecutionStage, StageStatus, int, string),
) {
	publish("run_started", map[string]string{"slug": slug, "impl_path": implPath})

	// Advisory stale-branch detection — does NOT block wave execution.
	if staleBranches := detectStaleBranches(repoPath); len(staleBranches) > 0 {
		publish("stale_branches_detected", map[string]interface{}{
			"slug":     slug,
			"branches": staleBranches,
			"count":    len(staleBranches),
		})
	}

	// Read saw.config.json to pick up the configured wave model.
	waveModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(repoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
		}
	}

	// Load the YAML manifest to get wave structure.
	manifest, err := protocol.Load(implPath)
	if err != nil {
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}
	if manifest == nil {
		publish("run_failed", map[string]string{"error": "failed to load IMPL manifest: " + implPath})
		return
	}

	ctx := context.Background()

	// Run scaffold agent if needed (engine handles the check internally).
	onStage(StageScaffold, StageStatusRunning, 0, "")
	if err := engine.RunScaffold(ctx, implPath, repoPath, "", func(ev engine.Event) {
		publish(ev.Event, ev.Data)
	}); err != nil {
		onStage(StageScaffold, StageStatusFailed, 0, err.Error())
		publish("run_failed", map[string]string{"error": err.Error()})
		return
	}
	onStage(StageScaffold, StageStatusComplete, 0, "")

	waves := manifest.Waves
	totalAgents := 0
	for _, w := range waves {
		totalAgents += len(w.Agents)
	}

	// Execute all waves one at a time, pausing at gates between them.
	for i, wave := range waves {
		waveNum := wave.Number

		opts := engine.RunWaveOpts{
			IMPLPath:  implPath,
			RepoPath:  repoPath,
			Slug:      slug,
			WaveModel: waveModel,
		}

		enginePublisher := func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}

		onStage(StageWaveExecute, StageStatusRunning, waveNum, "")
		if err := engine.RunSingleWave(ctx, opts, waveNum, enginePublisher); err != nil {
			onStage(StageWaveExecute, StageStatusFailed, waveNum, err.Error())
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}
		onStage(StageWaveExecute, StageStatusComplete, waveNum, "")

		onStage(StageWaveMerge, StageStatusRunning, waveNum, "")
		if err := engine.MergeWave(ctx, engine.RunMergeOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  waveNum,
		}); err != nil {
			onStage(StageWaveMerge, StageStatusFailed, waveNum, err.Error())
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}
		onStage(StageWaveMerge, StageStatusComplete, waveNum, "")

		testCmd := manifest.TestCommand
		if testCmd != "" {
			onStage(StageWaveVerify, StageStatusRunning, waveNum, "")
			if err := engine.RunVerification(ctx, engine.RunVerificationOpts{
				RepoPath:    repoPath,
				TestCommand: testCmd,
			}); err != nil {
				onStage(StageWaveVerify, StageStatusFailed, waveNum, err.Error())
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
			onStage(StageWaveVerify, StageStatusComplete, waveNum, "")
		}

		completedLetters := make([]string, 0, len(wave.Agents))
		for _, ag := range wave.Agents {
			completedLetters = append(completedLetters, ag.ID)
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

			onStage(StageWaveGate, StageStatusRunning, waveNum, "")
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
					onStage(StageWaveGate, StageStatusFailed, waveNum, "gate cancelled or timed out")
					publish("run_failed", map[string]string{
						"error": "gate cancelled or timed out",
					})
					return
				}
				onStage(StageWaveGate, StageStatusComplete, waveNum, "")
				publish("wave_gate_resolved", map[string]interface{}{
					"wave":   waveNum,
					"action": "proceed",
					"slug":   slug,
				})
			case <-time.After(gateTimeout):
				gateChannels.Delete(slug)
				onStage(StageWaveGate, StageStatusFailed, waveNum, "gate cancelled or timed out")
				publish("run_failed", map[string]string{
					"error": "gate cancelled or timed out",
				})
				return
			}
		}
	}

	onStage(StageComplete, StageStatusComplete, 0, "")
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
// Decodes the request body, then launches a single-agent rerun in a background
// goroutine via engine.RunSingleAgent. Returns 202 immediately. SSE events
// (agent_started, agent_complete, agent_failed) flow through the slug broker.
func (s *Server) handleWaveAgentRerun(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	letter := r.PathValue("letter")

	var body struct {
		Wave      int    `json:"wave"`
		ScopeHint string `json:"scope_hint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.Wave < 1 {
		http.Error(w, "wave must be >= 1", http.StatusBadRequest)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	if _, err := os.Stat(implPath); os.IsNotExist(err) {
		// Fall back to .md extension for legacy IMPL docs.
		implPath = filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
	}

	// Read wave model from saw.config.json if present.
	waveModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(s.cfg.RepoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
		}
	}

	opts := engine.RunWaveOpts{
		IMPLPath:  implPath,
		RepoPath:  s.cfg.RepoPath,
		Slug:      slug,
		WaveModel: waveModel,
	}
	enginePublisher := s.makeEnginePublisher(slug)

	go func() {
		if err := engine.RunSingleAgent(context.Background(), opts, body.Wave, letter, body.ScopeHint, enginePublisher); err != nil {
			publish := s.makePublisher(slug)
			publish("agent_failed", map[string]interface{}{
				"agent":        letter,
				"wave":         body.Wave,
				"status":       "failed",
				"failure_type": "rerun",
				"message":      err.Error(),
			})
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, `{"status":"accepted","slug":%q,"agent":%q,"wave":%d}`, slug, letter, body.Wave)
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

// makeStageCallback returns a closure that writes to the stage manager and
// publishes a stage_transition SSE event in a single call.
func (s *Server) makeStageCallback(slug string, publish func(string, interface{})) func(ExecutionStage, StageStatus, int, string) {
	return func(stage ExecutionStage, status StageStatus, waveNum int, msg string) {
		// Best-effort persistence — errors are non-fatal.
		_ = s.stages.transition(slug, stage, status, waveNum, msg)
		publish("stage_transition", map[string]interface{}{
			"stage":    string(stage),
			"status":   string(status),
			"wave_num": waveNum,
			"message":  msg,
		})
	}
}
