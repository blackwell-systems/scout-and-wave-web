package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/gatecache"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/retryctx"
)

// gateChannels stores per-slug gate channels used to pause runWaveLoop
// between waves. Keys are slugs (string), values are chan bool (buffered 1).
var gateChannels sync.Map

// fallbackSAWConfig is populated once from the server's default repo path.
// runWaveLoop uses it when the target repo has no saw.config.json of its own.
var fallbackSAWConfig *SAWConfig

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

	// Resolve the IMPL doc path and repository from saw.config.json.
	// This ensures we use the correct repository where the IMPL doc lives,
	// not the global default repository.
	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		s.activeRuns.Delete(slug)
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	publish := s.makePublisher(slug)

	// Clear previous stage state so the timeline starts fresh for this run.
	s.stages.Clear(slug)
	if s.pipelineTracker != nil {
		s.pipelineTracker.Clear(slug)
	}
	s.progressTracker.Clear(slug)
	onStage := s.makeStageCallback(slug, publish)

	go func() {
		defer s.activeRuns.Delete(slug)
		runWaveLoopFunc(implPath, slug, repoPath, publish, onStage)
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

	// Read saw.config.json to pick up configured models.
	// Try the target repo first; fall back to the server's default config
	// for cross-repo IMPLs that don't have their own saw.config.json.
	waveModel := ""
	scaffoldModel := ""
	integrationModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(repoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
			scaffoldModel = sawCfg.Agent.ScaffoldModel
			integrationModel = sawCfg.Agent.IntegrationModel
		}
	} else if fallbackSAWConfig != nil {
		waveModel = fallbackSAWConfig.Agent.WaveModel
		scaffoldModel = fallbackSAWConfig.Agent.ScaffoldModel
		integrationModel = fallbackSAWConfig.Agent.IntegrationModel
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
	if err := engine.RunScaffold(ctx, implPath, repoPath, "", scaffoldModel, func(ev engine.Event) {
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

	// Determine first incomplete wave using completion reports.
	// Skip waves where all agents already have status: complete.
	currentWave := protocol.CurrentWave(manifest)
	startIdx := 0
	if currentWave == nil {
		// All waves complete — mark IMPL done if not already marked (E15 + E18).
		// This handles the case where waves completed in a previous session but
		// mark-complete was never reached (e.g. server restart between last merge
		// and completion marking).
		if err := engine.MarkIMPLComplete(ctx, engine.MarkIMPLCompleteOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			Date:     time.Now().Format("2006-01-02"),
		}); err != nil {
			// Non-fatal: may already be marked complete (archived)
			publish("mark_complete_warning", map[string]string{"error": err.Error()})
		}
		publish("run_complete", map[string]interface{}{
			"status": "success",
			"waves":  len(waves),
			"agents": totalAgents,
			"note":   "all waves already complete",
		})
		return
	}
	for idx, w := range waves {
		if w.Number == currentWave.Number {
			startIdx = idx
			break
		}
	}
	if startIdx > 0 {
		publish("waves_skipped", map[string]interface{}{
			"skipped": startIdx,
			"reason":  "already completed (completion reports present)",
		})
	}

	// Execute waves one at a time, pausing at gates between them.
	for i := startIdx; i < len(waves); i++ {
		wave := waves[i]
		waveNum := wave.Number

		opts := engine.RunWaveOpts{
			IMPLPath:         implPath,
			RepoPath:         repoPath,
			Slug:             slug,
			WaveModel:        waveModel,
			IntegrationModel: integrationModel,
		}

		enginePublisher := func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}

		// If all agents in this wave already have commits on their branches
		// (e.g. agents ran in a previous server session but merge was not reached),
		// skip re-launching them and go straight to FinalizeWave.
		if waveAgentsHaveCommits(repoPath, waveNum, wave.Agents) {
			publish("wave_resumed", map[string]interface{}{
				"wave":   waveNum,
				"reason": "agent branches already have commits from previous session; skipping to merge",
			})
			onStage(StageWaveExecute, StageStatusComplete, waveNum, "")
		} else {
			onStage(StageWaveExecute, StageStatusRunning, waveNum, "")
			if err := engine.RunSingleWave(ctx, opts, waveNum, enginePublisher); err != nil {
				onStage(StageWaveExecute, StageStatusFailed, waveNum, err.Error())
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
			onStage(StageWaveExecute, StageStatusComplete, waveNum, "")
		}

		// FinalizeWave: decomposed pipeline with step-level tracking.
		// Uses pipelineTracker for state persistence and resume support.
		// Falls back to monolithic engine.FinalizeWave if tracker is nil.
		onStage(StageWaveMerge, StageStatusRunning, waveNum, "")
		if defaultPipelineTracker != nil {
			if err := runFinalizeSteps(slug, waveNum, implPath, repoPath, publish); err != nil {
				onStage(StageWaveMerge, StageStatusFailed, waveNum, err.Error())
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
		} else {
			// Backward compatibility: monolithic finalize when no tracker.
			finalizeResult, err := engine.FinalizeWave(ctx, engine.FinalizeWaveOpts{
				IMPLPath: implPath,
				RepoPath: repoPath,
				WaveNum:  waveNum,
			})
			if err != nil {
				onStage(StageWaveMerge, StageStatusFailed, waveNum, err.Error())
				publish("run_failed", map[string]string{"error": err.Error()})
				return
			}
			if finalizeResult.StubReport != nil && len(finalizeResult.StubReport.Hits) > 0 {
				publish("stub_report", finalizeResult.StubReport)
			}
			for _, gate := range finalizeResult.GateResults {
				publish("quality_gate_result", gate)
			}
		}
		onStage(StageWaveMerge, StageStatusComplete, waveNum, "")

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

	// After all waves complete — mark IMPL done (E15 + E18)
	if err := engine.MarkIMPLComplete(ctx, engine.MarkIMPLCompleteOpts{
		IMPLPath: implPath,
		RepoPath: repoPath,
		Date:     time.Now().Format("2006-01-02"),
	}); err != nil {
		// Non-fatal: log but don't fail the run
		publish("mark_complete_warning", map[string]string{"error": err.Error()})
	}

	onStage(StageComplete, StageStatusComplete, 0, "")
	publish("run_complete", map[string]interface{}{
		"status": "success",
		"waves":  len(waves),
		"agents": totalAgents,
	})
}

// publishPipelineStep emits a pipeline_step SSE event for UI consumption.
func publishPipelineStep(publish func(string, interface{}), slug string, waveNum int, step PipelineStep, status StepStatus, errMsg string) {
	publish("pipeline_step", map[string]interface{}{
		"slug":   slug,
		"wave":   waveNum,
		"step":   string(step),
		"status": string(status),
		"error":  errMsg,
	})
}

// runFinalizeSteps executes the decomposed finalization pipeline with
// step-level tracking via defaultPipelineTracker. Both runWaveLoop and
// handleWaveFinalize call this to avoid duplicating step logic.
//
// On resume, steps that already completed or were skipped are skipped.
// Non-fatal steps (scan_stubs, validate_integration, fix_go_mod, cleanup)
// log errors but continue. Fatal step failures return an error.
func runFinalizeSteps(slug string, waveNum int, implPath, repoPath string, publish func(string, interface{})) error {
	tracker := defaultPipelineTracker

	// Determine resume point: skip steps already completed/skipped.
	resumeAfter := tracker.LastSuccessfulStep(slug)

	shouldSkip := func(step PipelineStep) bool {
		if resumeAfter == "" {
			return false
		}
		for _, s := range PipelineStepOrder {
			if s == step {
				return true // this step is at or before resumeAfter
			}
			if s == resumeAfter {
				return false // past resumeAfter, don't skip
			}
		}
		return false
	}

	// Load manifest once for steps that need it.
	manifest, err := protocol.Load(implPath)
	if err != nil {
		return fmt.Errorf("runFinalizeSteps: load manifest: %w", err)
	}

	// --- Step 1: VerifyCommits ---
	if shouldSkip(StepVerifyCommits) {
		publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepVerifyCommits)
		publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepRunning, "")

		verifyResult, err := protocol.VerifyCommits(implPath, waveNum, repoPath)
		if err != nil {
			_ = tracker.Fail(slug, waveNum, StepVerifyCommits, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepFailed, err.Error())
			return fmt.Errorf("verify-commits: %w", err)
		}
		if !verifyResult.AllValid {
			err := fmt.Errorf("verify-commits found agents with no commits")
			_ = tracker.Fail(slug, waveNum, StepVerifyCommits, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepFailed, err.Error())
			return err
		}
		_ = tracker.Complete(slug, waveNum, StepVerifyCommits)
		publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepComplete, "")
	}

	// --- Step 2: ScanStubs (non-fatal) ---
	if shouldSkip(StepScanStubs) {
		publishPipelineStep(publish, slug, waveNum, StepScanStubs, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepScanStubs)
		publishPipelineStep(publish, slug, waveNum, StepScanStubs, StepRunning, "")

		var changedFiles []string
		if waveNum > 0 && waveNum <= len(manifest.Waves) {
			for _, agent := range manifest.Waves[waveNum-1].Agents {
				if report, ok := manifest.CompletionReports[agent.ID]; ok {
					changedFiles = append(changedFiles, report.FilesChanged...)
					changedFiles = append(changedFiles, report.FilesCreated...)
				}
			}
		}
		if len(changedFiles) > 0 {
			stubResult, err := protocol.ScanStubs(changedFiles)
			if err != nil {
				log.Printf("runFinalizeSteps: scan-stubs non-fatal error: %v", err)
			} else if stubResult != nil && len(stubResult.Hits) > 0 {
				publish("stub_report", stubResult)
			}
		}
		_ = tracker.Complete(slug, waveNum, StepScanStubs)
		publishPipelineStep(publish, slug, waveNum, StepScanStubs, StepComplete, "")
	}

	// --- Step 3: RunGates ---
	if shouldSkip(StepRunGates) {
		publishPipelineStep(publish, slug, waveNum, StepRunGates, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepRunGates)
		publishPipelineStep(publish, slug, waveNum, StepRunGates, StepRunning, "")

		stateDir := filepath.Join(repoPath, ".saw-state")
		cache := gatecache.New(stateDir, 5*time.Minute)
		gateResults, err := protocol.RunGatesWithCache(manifest, waveNum, repoPath, cache)
		if err != nil {
			_ = tracker.Fail(slug, waveNum, StepRunGates, err)
			publishPipelineStep(publish, slug, waveNum, StepRunGates, StepFailed, err.Error())
			return fmt.Errorf("run-gates: %w", err)
		}
		for _, gate := range gateResults {
			publish("quality_gate_result", gate)
			if gate.Required && !gate.Passed {
				err := fmt.Errorf("required gate %q failed", gate.Type)
				_ = tracker.Fail(slug, waveNum, StepRunGates, err)
				publishPipelineStep(publish, slug, waveNum, StepRunGates, StepFailed, err.Error())
				return err
			}
		}
		_ = tracker.Complete(slug, waveNum, StepRunGates)
		publishPipelineStep(publish, slug, waveNum, StepRunGates, StepComplete, "")
	}

	// --- Step 4: ValidateIntegration (non-fatal) ---
	if shouldSkip(StepValidateIntegration) {
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepValidateIntegration)
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepRunning, "")

		integrationReport, err := protocol.ValidateIntegration(manifest, waveNum, repoPath)
		if err != nil {
			log.Printf("runFinalizeSteps: validate-integration non-fatal error: %v", err)
		} else if integrationReport != nil {
			waveKey := fmt.Sprintf("wave%d", waveNum)
			_ = protocol.AppendIntegrationReport(implPath, waveKey, integrationReport)
		}
		_ = tracker.Complete(slug, waveNum, StepValidateIntegration)
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepComplete, "")
	}

	// --- Step 5: MergeAgents ---
	if shouldSkip(StepMergeAgents) {
		publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepMergeAgents)
		publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepRunning, "")

		mergeResult, err := protocol.MergeAgents(implPath, waveNum, repoPath)
		if err != nil {
			_ = tracker.Fail(slug, waveNum, StepMergeAgents, err)
			publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepFailed, err.Error())
			return fmt.Errorf("merge-agents: %w", err)
		}
		if !mergeResult.Success {
			err := fmt.Errorf("merge-agents encountered conflicts")
			_ = tracker.Fail(slug, waveNum, StepMergeAgents, err)
			publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepFailed, err.Error())
			return err
		}
		_ = tracker.Complete(slug, waveNum, StepMergeAgents)
		publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepComplete, "")
	}

	// --- Step 6: FixGoMod (non-fatal) ---
	if shouldSkip(StepFixGoMod) {
		publishPipelineStep(publish, slug, waveNum, StepFixGoMod, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepFixGoMod)
		publishPipelineStep(publish, slug, waveNum, StepFixGoMod, StepRunning, "")

		if fixed, err := protocol.FixGoModReplacePaths(repoPath); err != nil {
			log.Printf("runFinalizeSteps: fix-go-mod non-fatal error: %v", err)
		} else if fixed {
			log.Printf("runFinalizeSteps: auto-corrected go.mod replace paths")
		}
		_ = tracker.Complete(slug, waveNum, StepFixGoMod)
		publishPipelineStep(publish, slug, waveNum, StepFixGoMod, StepComplete, "")
	}

	// --- Step 7: VerifyBuild ---
	if shouldSkip(StepVerifyBuild) {
		publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepVerifyBuild)
		publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepRunning, "")

		verifyBuildResult, err := protocol.VerifyBuild(implPath, repoPath)
		if err != nil {
			_ = tracker.Fail(slug, waveNum, StepVerifyBuild, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepFailed, err.Error())
			return fmt.Errorf("verify-build: %w", err)
		}
		if !verifyBuildResult.TestPassed || !verifyBuildResult.LintPassed {
			err := fmt.Errorf("verify-build failed (test_passed=%v, lint_passed=%v)",
				verifyBuildResult.TestPassed, verifyBuildResult.LintPassed)
			_ = tracker.Fail(slug, waveNum, StepVerifyBuild, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepFailed, err.Error())
			return err
		}
		_ = tracker.Complete(slug, waveNum, StepVerifyBuild)
		publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepComplete, "")
	}

	// --- Step 8: Cleanup (non-fatal) ---
	if shouldSkip(StepCleanup) {
		publishPipelineStep(publish, slug, waveNum, StepCleanup, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepCleanup)
		publishPipelineStep(publish, slug, waveNum, StepCleanup, StepRunning, "")

		if _, err := protocol.Cleanup(implPath, waveNum, repoPath); err != nil {
			log.Printf("runFinalizeSteps: cleanup non-fatal error: %v", err)
		}
		_ = tracker.Complete(slug, waveNum, StepCleanup)
		publishPipelineStep(publish, slug, waveNum, StepCleanup, StepComplete, "")
	}

	return nil
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

	// Resolve the IMPL doc path and repository (same as handleWaveStart)
	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Build structured failure context from previous completion report (if any).
	promptPrefix := body.ScopeHint
	if rc, err := retryctx.BuildRetryContext(implPath, letter, 2); err == nil {
		if rc.PromptText != "" {
			if promptPrefix != "" {
				promptPrefix = rc.PromptText + "\n" + promptPrefix
			} else {
				promptPrefix = rc.PromptText
			}
		}
	}

	// Read wave model and integration model from saw.config.json if present.
	waveModel := ""
	integrationModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(repoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			waveModel = sawCfg.Agent.WaveModel
			integrationModel = sawCfg.Agent.IntegrationModel
		}
	}

	opts := engine.RunWaveOpts{
		IMPLPath:         implPath,
		RepoPath:         repoPath,
		Slug:             slug,
		WaveModel:        waveModel,
		IntegrationModel: integrationModel,
	}
	enginePublisher := s.makeEnginePublisher(slug)

	go func() {
		if err := engine.RunSingleAgent(context.Background(), opts, body.Wave, letter, promptPrefix, enginePublisher); err != nil {
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

// handleWaveFinalize handles POST /api/wave/{slug}/finalize.
// Retries the finalization pipeline (verify commits, gates, merge, build, cleanup)
// for a wave whose agents completed but finalization previously failed (e.g. gate failure).
func (s *Server) handleWaveFinalize(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var body struct {
		Wave int `json:"wave"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if body.Wave < 1 {
		http.Error(w, "wave must be >= 1", http.StatusBadRequest)
		return
	}

	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Guard against concurrent merges (reuses the same lock as handleWaveMerge)
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "merge/finalize already in progress for this slug", http.StatusConflict)
		return
	}

	publish := s.makePublisher(slug)
	wave := body.Wave

	w.WriteHeader(http.StatusAccepted)

	go func() {
		defer s.mergingRuns.Delete(slug)

		publish("merge_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
		})
		publish("merge_output", map[string]interface{}{
			"slug":  slug,
			"wave":  wave,
			"chunk": fmt.Sprintf("Retrying finalization for wave %d...\n", wave),
		})

		if defaultPipelineTracker != nil {
			// Use decomposed pipeline with step tracking.
			if err := runFinalizeSteps(slug, wave, implPath, repoPath, publish); err != nil {
				publish("merge_failed", map[string]interface{}{
					"slug":  slug,
					"wave":  wave,
					"error": err.Error(),
				})
				return
			}
		} else {
			// Backward compatibility: monolithic finalize when no tracker.
			finalizeResult, err := engine.FinalizeWave(context.Background(), engine.FinalizeWaveOpts{
				IMPLPath: implPath,
				RepoPath: repoPath,
				WaveNum:  wave,
			})

			if finalizeResult != nil {
				for _, gate := range finalizeResult.GateResults {
					publish("quality_gate_result", gate)
				}
			}

			if err != nil {
				publish("merge_failed", map[string]interface{}{
					"slug":  slug,
					"wave":  wave,
					"error": err.Error(),
				})
				return
			}

			// Post-finalize: go.mod fixup
			if fixed, fixErr := protocol.FixGoModReplacePaths(repoPath); fixErr != nil {
				publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": fmt.Sprintf("go.mod fixup warning: %v\n", fixErr)})
			} else if fixed {
				publish("merge_output", map[string]interface{}{"slug": slug, "wave": wave, "chunk": "Auto-corrected go.mod replace paths\n"})
			}
		}

		publish("merge_complete", map[string]interface{}{
			"slug":   slug,
			"wave":   wave,
			"status": "success",
		})
	}()
}

// resolveIMPLPath searches all configured repositories for the IMPL doc with the given slug.
// Returns (implPath, repoPath, nil) on success, or ("", "", error) if not found.
// This mirrors the logic in handleGetImpl and handleListImpls to support multi-repository workflows.
func (s *Server) resolveIMPLPath(slug string) (string, string, error) {
	// Read saw.config.json to get the list of repos
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	configData, err := os.ReadFile(configPath)

	var repos []RepoEntry
	if err == nil {
		var cfg SAWConfig
		if json.Unmarshal(configData, &cfg) == nil && len(cfg.Repos) > 0 {
			repos = cfg.Repos
		}
	}

	// Fallback: if no config or no repos, use the startup IMPLDir
	if len(repos) == 0 {
		repos = []RepoEntry{{
			Name: filepath.Base(s.cfg.RepoPath),
			Path: s.cfg.RepoPath,
		}}
	}

	// Search all repos for the IMPL doc (both active and complete directories)
	for _, repo := range repos {
		implDirs := []string{
			filepath.Join(repo.Path, "docs", "IMPL"),
			filepath.Join(repo.Path, "docs", "IMPL", "complete"),
		}

		for _, implDir := range implDirs {
			yamlPath := filepath.Join(implDir, "IMPL-"+slug+".yaml")
			if _, err := os.Stat(yamlPath); err == nil {
				return yamlPath, repo.Path, nil
			}
		}
	}

	return "", "", fmt.Errorf("IMPL doc not found for slug: %s", slug)
}

// makePublisher creates a function that maps orchestrator events to SSE events.
// Agent lifecycle events (agent_started, agent_complete, agent_failed) are cached
// so late-connecting SSE clients can receive a state snapshot on connect.
func (s *Server) makePublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		ev := SSEEvent{Event: event, Data: data}
		switch event {
		case "run_started":
			s.clearAgentSnapshot(slug)
		case "agent_started", "agent_complete", "agent_failed":
			s.cacheAgentEvent(slug, ev)
		}
		s.broker.Publish(slug, ev)
	}
}

// makeEnginePublisher converts engine.Event to api.SSEEvent and publishes to the broker.
// Agent lifecycle events are cached for SSE replay (same as makePublisher).
func (s *Server) makeEnginePublisher(slug string) func(engine.Event) {
	return func(ev engine.Event) {
		sseEv := SSEEvent{Event: ev.Event, Data: ev.Data}
		switch ev.Event {
		case "agent_started", "agent_complete", "agent_failed":
			s.cacheAgentEvent(slug, sseEv)
		}
		s.broker.Publish(slug, sseEv)
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

// waveAgentsHaveCommits returns true when every agent in the wave already has
// a branch with at least one commit ahead of HEAD in repoPath. This indicates
// that the agents ran in a previous server session and only the merge step
// remains — the wave execution step can be safely skipped.
func waveAgentsHaveCommits(repoPath string, waveNum int, agents []protocol.Agent) bool {
	if len(agents) == 0 {
		return false
	}
	for _, agent := range agents {
		branch := fmt.Sprintf("wave%d-agent-%s", waveNum, agent.ID)
		// Check that the branch ref exists
		refCheck := exec.Command("git", "-C", repoPath, "rev-parse", "--verify", branch)
		if refCheck.Run() != nil {
			return false // branch doesn't exist
		}
		// Check that the branch has at least one commit ahead of HEAD
		countOut, err := exec.Command("git", "-C", repoPath, "rev-list", "--count", "HEAD.."+branch).Output()
		if err != nil {
			return false
		}
		count := 0
		fmt.Sscanf(string(countOut), "%d", &count)
		if count == 0 {
			return false // branch exists but no new commits
		}
	}
	return true
}
