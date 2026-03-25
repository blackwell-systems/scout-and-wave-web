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

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/gatecache"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/retryctx"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// gateChannels stores per-slug gate channels used to pause runWaveLoop
// between waves. Keys are slugs (string), values are chan bool (buffered 1).
var gateChannels sync.Map

// fallbackSAWConfig is populated once from the server's default repo path.
// runWaveLoop uses it when the target repo has no saw.config.json of its own.
var fallbackSAWConfig *config.SAWConfig

// runWaveLoopFunc is the seam used by handleWaveStart. Tests can replace this
// to inject a no-op and avoid real git/API calls in unit tests.
var runWaveLoopFunc = runWaveLoop

// handleWaveStart handles POST /api/wave/{slug}/start.
// It checks whether the slug is already running (409), marks it active, then
// launches wave execution in a background goroutine and immediately returns 202.
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Clear previous stage state so the timeline starts fresh for this run.
	s.stages.Clear(slug)
	if s.pipelineTracker != nil {
		s.pipelineTracker.Clear(slug)
	}
	s.progressTracker.Clear(slug)

	// Notify sidebar that execution started (is_executing becomes true).
	s.globalBroker.broadcast("impl_list_updated")

	// Delegate to service layer. Service handles duplicate run detection,
	// IMPL path resolution, and wave execution.
	if err := service.StartWave(s.svcDeps, slug); err != nil {
		// Restore UI state on failure.
		s.globalBroker.broadcast("impl_list_updated")
		if err.Error() == fmt.Sprintf("wave already running for slug %q", slug) {
			http.Error(w, "wave already running", http.StatusConflict)
		} else {
			http.Error(w, err.Error(), http.StatusNotFound)
		}
		return
	}

	// Start background goroutine to broadcast impl_list_updated when done.
	// Service layer handles deferred activeWaves cleanup; we just need to
	// notify UI that is_executing changed.
	go func() {
		// Subscribe to wave events to detect completion/failure.
		ch, cancel := s.svcDeps.Publisher.Subscribe("wave:" + slug)
		defer cancel()
		for ev := range ch {
			if ev.Name == "run_complete" || ev.Name == "run_failed" {
				s.globalBroker.broadcast("impl_list_updated")
				return
			}
		}
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

	// Read config to pick up configured models.
	// Try the target repo first; fall back to the server's default config
	// for cross-repo IMPLs that don't have their own saw.config.json.
	waveModel := ""
	scaffoldModel := ""
	integrationModel := ""
	if sawCfg := config.LoadOrDefault(repoPath); sawCfg != nil {
		waveModel = sawCfg.Agent.WaveModel
		scaffoldModel = sawCfg.Agent.ScaffoldModel
		integrationModel = sawCfg.Agent.IntegrationModel
	}
	// Fill empty values from the server's fallback config (the web app's own saw.config.json).
	// Cross-repo IMPLs may live in repos with empty model strings.
	if fallbackSAWConfig != nil {
		if waveModel == "" {
			waveModel = fallbackSAWConfig.Agent.WaveModel
		}
		if scaffoldModel == "" {
			scaffoldModel = fallbackSAWConfig.Agent.ScaffoldModel
		}
		if integrationModel == "" {
			integrationModel = fallbackSAWConfig.Agent.IntegrationModel
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

	// Run scaffold agent only when scaffolds exist and are not yet committed.
	// This prevents the scaffold stage from flashing in the UI on Wave 2+ starts.
	if !protocol.AllScaffoldsCommitted(manifest) {
		onStage(StageScaffold, StageStatusRunning, 0, "")
		if err := engine.RunScaffold(ctx, implPath, repoPath, "", scaffoldModel, func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		}); err != nil {
			onStage(StageScaffold, StageStatusFailed, 0, err.Error())
			publish("run_failed", map[string]string{"error": err.Error()})
			return
		}
		onStage(StageScaffold, StageStatusComplete, 0, "")
	}

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

		// If all agents in this wave already have commits on their branches
		// (e.g. agents ran in a previous server session but merge was not reached),
		// skip PrepareWave and re-launching them — go straight to FinalizeWave.
		if waveAgentsHaveCommitsWithManifest(repoPath, implPath, slug, waveNum, wave.Agents) {
			publish("wave_resumed", map[string]interface{}{
				"wave":   waveNum,
				"reason": "agent branches already have commits from previous session; skipping to merge",
			})
			onStage(StageWaveExecute, StageStatusComplete, waveNum, "")
		} else {
			// Stage: wave_prepare — run PrepareWave to create worktrees, extract briefs, etc.
			onStage("wave_prepare", StageStatusRunning, waveNum, "")
			prepResult, prepErr := engine.PrepareWave(ctx, engine.PrepareWaveOpts{
				IMPLPath: implPath,
				RepoPath: repoPath,
				WaveNum:  waveNum,
				OnEvent: func(step, status, detail string) {
					publish("prepare_step", map[string]interface{}{
						"slug":   slug,
						"wave":   waveNum,
						"step":   step,
						"status": status,
						"detail": detail,
					})
				},
			})
			if prepErr != nil {
				onStage("wave_prepare", StageStatusFailed, waveNum, prepErr.Error())
				publish("run_failed", map[string]string{"error": prepErr.Error()})
				return
			}
			onStage("wave_prepare", StageStatusComplete, waveNum, "")

			// Create orchestrator and run wave (replaces engine.RunSingleWave).
			orch, orchErr := orchestrator.New(repoPath, implPath)
			if orchErr != nil {
				publish("run_failed", map[string]string{"error": orchErr.Error()})
				return
			}
			if waveModel != "" {
				orch.SetDefaultModel(waveModel)
			}
			orch.SetEventPublisher(func(ev orchestrator.OrchestratorEvent) {
				publish(ev.Event, ev.Data)
			})
			// Feed worktree paths from PrepareWave result so the orchestrator
			// does not redundantly create worktrees.
			if len(prepResult.Worktrees) > 0 {
				paths := make(map[string]string, len(prepResult.Worktrees))
				for _, wt := range prepResult.Worktrees {
					paths[wt.Agent] = wt.Path
				}
				orch.SetWorktreePaths(paths)
			}

			onStage(StageWaveExecute, StageStatusRunning, waveNum, "")
			if err := orch.RunWave(waveNum); err != nil {
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
			if err := runFinalizeSteps(slug, waveNum, implPath, repoPath, integrationModel, publish); err != nil {
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
				if gate.FromCache {
					publish("gate_cache_hit", map[string]interface{}{
						"gate_type": gate.Type,
						"command":   gate.Command,
						"wave":      waveNum,
						"sha":       gate.SkipReason,
					})
				}
			}
			// Wiring gap events (E35): run wiring validation post-finalize and
			// emit per-gap and summary SSE events. Non-blocking — does not abort
			// the wave. The engine's FinalizeWaveResult does not carry a WiringReport,
			// so we run it inline here.
			if manifest != nil && len(manifest.Wiring) > 0 {
				if wiringRes := protocol.ValidateWiringDeclarations(manifest, repoPath); wiringRes.IsSuccess() || wiringRes.IsPartial() {
					wiringResult := wiringRes.GetData()
					if wiringResult != nil && !wiringResult.Valid {
						for _, gap := range wiringResult.Gaps {
							publish("wiring_gap", map[string]interface{}{
								"wave":                waveNum,
								"symbol":              gap.Declaration.Symbol,
								"defined_in":          gap.Declaration.DefinedIn,
								"must_be_called_from": gap.Declaration.MustBeCalledFrom,
								"agent":               gap.Declaration.Agent,
								"reason":              gap.Reason,
								"severity":            gap.Severity,
							})
						}
						publish("wiring_gaps_summary", map[string]interface{}{
							"wave":      waveNum,
							"gap_count": len(wiringResult.Gaps),
							"summary":   wiringResult.Summary,
						})
					}
				}
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
func runFinalizeSteps(slug string, waveNum int, implPath, repoPath, integrationModel string, publish func(string, interface{})) error {
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

		verifyResult := protocol.VerifyCommits(implPath, waveNum, repoPath)
		if verifyResult.IsFatal() {
			err := fmt.Errorf("verify-commits fatal error")
			_ = tracker.Fail(slug, waveNum, StepVerifyCommits, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyCommits, StepFailed, err.Error())
			return err
		}
		if !verifyResult.IsSuccess() {
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
			stubResult := protocol.ScanStubs(changedFiles)
			if stubResult.IsFatal() {
				log.Printf("runFinalizeSteps: scan-stubs non-fatal error: fatal result")
			} else if stubResult.Data != nil && len(stubResult.Data.Hits) > 0 {
				publish("stub_report", stubResult.Data)
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
		gateResults := protocol.RunGatesWithCache(manifest, waveNum, repoPath, cache)
		if gateResults.IsFatal() {
			err := fmt.Errorf("run-gates fatal error")
			_ = tracker.Fail(slug, waveNum, StepRunGates, err)
			publishPipelineStep(publish, slug, waveNum, StepRunGates, StepFailed, err.Error())
			return err
		}
		for _, gate := range gateResults.Data.Gates {
			publish("quality_gate_result", gate)
			if gate.FromCache {
				publish("gate_cache_hit", map[string]interface{}{
					"gate_type": gate.Type,
					"command":   gate.Command,
					"wave":      waveNum,
					"sha":       gate.SkipReason,
				})
			}
			if gate.Required && !gate.Passed {
				// Attempt closed-loop gate retry (R3) before failing.
				retryResult, retryErr := engine.ClosedLoopGateRetry(context.Background(), engine.ClosedLoopRetryOpts{
					IMPLPath:     implPath,
					RepoPath:     repoPath,
					WaveNum:      waveNum,
					AgentID:      fmt.Sprintf("wave%d", waveNum),
					GateType:     gate.Type,
					GateCommand:  gate.Command,
					GateOutput:   gate.Stderr,
					WorktreePath: repoPath,
					OnEvent: func(ev engine.Event) {
						publish(ev.Event, ev.Data)
					},
				})
				if retryErr == nil && retryResult != nil && retryResult.Fixed {
					// Re-run all gates to confirm after fix.
					gateResults = protocol.RunGatesWithCache(manifest, waveNum, repoPath, cache)
					if gateResults.IsSuccess() {
						allPass := true
						for _, g := range gateResults.Data.Gates {
							publish("quality_gate_result", g)
							if g.Required && !g.Passed {
								allPass = false
							}
						}
						if allPass {
							break // All gates pass after retry fix.
						}
					}
				}
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
	// Stash report for use in StepIntegrationAgent after merge+build.
	var integrationReport *protocol.IntegrationReport
	if shouldSkip(StepValidateIntegration) {
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepValidateIntegration)
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepRunning, "")

		var intErr error
		integrationReport, intErr = protocol.ValidateIntegration(manifest, waveNum, repoPath)
		if intErr != nil {
			log.Printf("runFinalizeSteps: validate-integration non-fatal error: %v", intErr)
		} else if integrationReport != nil {
			waveKey := fmt.Sprintf("wave%d", waveNum)
			_ = protocol.AppendIntegrationReport(implPath, waveKey, integrationReport)
		}
		_ = tracker.Complete(slug, waveNum, StepValidateIntegration)
		publishPipelineStep(publish, slug, waveNum, StepValidateIntegration, StepComplete, "")
	}

	// --- Step 4b: ValidateWiring (non-fatal, E35 Layer 3B) ---
	// Run wiring declaration check after integration validation, before merge.
	// Emit per-gap and summary SSE events so the UI can surface wiring gaps.
	// Does NOT block the pipeline — wiring gaps are advisory at this stage.
	if len(manifest.Wiring) > 0 {
		wiringRes := protocol.ValidateWiringDeclarations(manifest, repoPath)
		if wiringRes.IsFatal() {
			log.Printf("runFinalizeSteps: validate-wiring non-fatal error: %v", wiringRes.Errors)
		} else if wiringRes.IsSuccess() || wiringRes.IsPartial() {
			if wiringData := wiringRes.GetData(); wiringData != nil && !wiringData.Valid {
				for _, gap := range wiringData.Gaps {
					publish("wiring_gap", map[string]interface{}{
						"wave":                waveNum,
						"symbol":              gap.Declaration.Symbol,
						"defined_in":          gap.Declaration.DefinedIn,
						"must_be_called_from": gap.Declaration.MustBeCalledFrom,
						"agent":               gap.Declaration.Agent,
						"reason":              gap.Reason,
						"severity":            gap.Severity,
					})
				}
				publish("wiring_gaps_summary", map[string]interface{}{
					"wave":      waveNum,
					"gap_count": len(wiringData.Gaps),
					"summary":   wiringData.Summary,
				})
			}
		}
	}

	// --- Step 5: MergeAgents ---
	if shouldSkip(StepMergeAgents) {
		publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepMergeAgents)
		publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepRunning, "")

		mergeResult, err := protocol.MergeAgents(implPath, waveNum, repoPath, "")
		if err != nil {
			_ = tracker.Fail(slug, waveNum, StepMergeAgents, err)
			publishPipelineStep(publish, slug, waveNum, StepMergeAgents, StepFailed, err.Error())
			return fmt.Errorf("merge-agents: %w", err)
		}
		if !mergeResult.IsSuccess() {
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

		verifyBuildResult := protocol.VerifyBuild(implPath, repoPath)
		if verifyBuildResult.IsFatal() {
			err := fmt.Errorf("verify-build fatal error")
			_ = tracker.Fail(slug, waveNum, StepVerifyBuild, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepFailed, err.Error())
			return err
		}
		if !verifyBuildResult.Data.TestPassed || !verifyBuildResult.Data.LintPassed {
			err := fmt.Errorf("verify-build failed (test_passed=%v, lint_passed=%v)",
				verifyBuildResult.Data.TestPassed, verifyBuildResult.Data.LintPassed)
			_ = tracker.Fail(slug, waveNum, StepVerifyBuild, err)
			publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepFailed, err.Error())
			return err
		}
		_ = tracker.Complete(slug, waveNum, StepVerifyBuild)
		publishPipelineStep(publish, slug, waveNum, StepVerifyBuild, StepComplete, "")
	}

	// --- Step 7.5: CodeReview (non-fatal unless blocking) ---
	if shouldSkip(StepCodeReview) {
		publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepSkipped, "")
	} else {
		_ = tracker.Start(slug, waveNum, StepCodeReview)
		publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepRunning, "")

		if err := runCodeReviewStep(context.Background(), slug, waveNum, repoPath, tracker, publish); err != nil {
			return err
		}
	}

	// --- Step 8: IntegrationAgent (non-fatal, E26) ---
	// If ValidateIntegration found gaps, launch the integration agent to wire them.
	if shouldSkip(StepIntegrationAgent) {
		publishPipelineStep(publish, slug, waveNum, StepIntegrationAgent, StepSkipped, "")
	} else if integrationReport != nil && !integrationReport.Valid && len(integrationReport.Gaps) > 0 {
		_ = tracker.Start(slug, waveNum, StepIntegrationAgent)
		publishPipelineStep(publish, slug, waveNum, StepIntegrationAgent, StepRunning, "")

		intAgentErr := engine.RunIntegrationAgent(context.Background(), engine.RunIntegrationAgentOpts{
			IMPLPath: implPath,
			RepoPath: repoPath,
			WaveNum:  waveNum,
			Report:   integrationReport,
			Model:    integrationModel,
		}, func(ev engine.Event) {
			publish(ev.Event, ev.Data)
		})
		if intAgentErr != nil {
			log.Printf("runFinalizeSteps: integration-agent non-fatal error: %v", intAgentErr)
			_ = tracker.Complete(slug, waveNum, StepIntegrationAgent)
			publishPipelineStep(publish, slug, waveNum, StepIntegrationAgent, StepComplete,
				fmt.Sprintf("non-fatal: %v", intAgentErr))
		} else {
			_ = tracker.Complete(slug, waveNum, StepIntegrationAgent)
			publishPipelineStep(publish, slug, waveNum, StepIntegrationAgent, StepComplete, "")
		}
	} else {
		// No gaps found — skip automatically.
		_ = tracker.Skip(slug, waveNum, StepIntegrationAgent)
		publishPipelineStep(publish, slug, waveNum, StepIntegrationAgent, StepSkipped, "no integration gaps")
	}

	// --- Step 9: Cleanup (non-fatal) ---
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

	// Delegate to service layer.
	if err := service.ProceedGate(s.svcDeps, slug); err != nil {
		if err.Error() == fmt.Sprintf("no gate pending for slug %q", slug) {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
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

	// Build structured failure context from previous completion report (if any).
	// This is handler-level concern since it requires resolving the IMPL path
	// which the service layer will also do. We augment scopeHint here to avoid
	// double resolution.
	implPath, _, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	scopeHint := body.ScopeHint
	if rc, err := retryctx.BuildRetryContext(implPath, letter, 2); err == nil {
		if rc.PromptText != "" {
			if scopeHint != "" {
				scopeHint = rc.PromptText + "\n" + scopeHint
			} else {
				scopeHint = rc.PromptText
			}
		}
	}

	// Delegate to service layer.
	if err := service.RerunAgent(s.svcDeps, slug, body.Wave, letter, scopeHint); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

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

	// Guard against concurrent merges (reuses the same lock as handleWaveMerge)
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "merge/finalize already in progress for this slug", http.StatusConflict)
		return
	}

	wave := body.Wave

	// Delegate to service layer. Service launches finalization in background
	// and returns immediately.
	if err := service.FinalizeWave(s.svcDeps, slug, wave); err != nil {
		s.mergingRuns.Delete(slug)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	s.globalBroker.broadcast("impl_list_updated") // execution started

	// Subscribe to events to track completion and clean up UI state.
	go func() {
		defer s.mergingRuns.Delete(slug)
		defer s.globalBroker.broadcast("impl_list_updated") // execution ended

		ch, cancel := s.svcDeps.Publisher.Subscribe("wave:" + slug)
		defer cancel()
		for ev := range ch {
			if ev.Name == "merge_complete" {
				s.notificationBus.Notify(NotificationEvent{
					Type:     NotifyMergeComplete,
					Slug:     slug,
					Title:    fmt.Sprintf("Wave %d Complete", wave),
					Message:  "Finalization completed successfully",
					Severity: "success",
				})
				return
			} else if ev.Name == "merge_failed" {
				if data, ok := ev.Data.(map[string]interface{}); ok {
					if errMsg, ok := data["error"].(string); ok {
						s.notificationBus.Notify(NotificationEvent{
							Type:     NotifyMergeFailed,
							Slug:     slug,
							Title:    fmt.Sprintf("Wave %d Merge Failed", wave),
							Message:  fmt.Sprintf("Finalization failed: %s", errMsg),
							Severity: "error",
						})
					}
				}
				return
			}
		}
	}()
}

// resolveIMPLPath searches all configured repositories for the IMPL doc with the given slug.
// Returns (implPath, repoPath, nil) on success, or ("", "", error) if not found.
// This mirrors the logic in handleGetImpl and handleListImpls to support multi-repository workflows.
func (s *Server) resolveIMPLPath(slug string) (string, string, error) {
	// Read config to get the list of repos
	repos := s.getConfiguredRepos()

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
// auto_retry_started and auto_retry_exhausted (E19) are also cached so late clients
// can reconstruct the current retry state.
func (s *Server) makePublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		ev := SSEEvent{Event: event, Data: data}
		switch event {
		case "run_started":
			s.clearAgentSnapshot(slug)
		case "agent_started", "agent_complete", "agent_failed",
			"auto_retry_started", "auto_retry_exhausted":
			s.cacheAgentEvent(slug, ev)
		}
		s.broker.Publish(slug, ev)
	}
}

// makeEnginePublisher converts engine.Event to api.SSEEvent and publishes to the broker.
// Agent lifecycle events are cached for SSE replay (same as makePublisher).
// auto_retry_started and auto_retry_exhausted (E19) are also cached.
func (s *Server) makeEnginePublisher(slug string) func(engine.Event) {
	return func(ev engine.Event) {
		sseEv := SSEEvent{Event: ev.Event, Data: ev.Data}
		switch ev.Event {
		case "agent_started", "agent_complete", "agent_failed",
			"auto_retry_started", "auto_retry_exhausted":
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
// a branch with at least one commit ahead of HEAD. For cross-repo IMPLs,
// each agent's branch is checked in its own repo (resolved from file ownership).
//
// Checks slug-scoped branch names first, then falls back to legacy format
// for backward compatibility with in-progress migrations.
func waveAgentsHaveCommits(repoPath, slug string, waveNum int, agents []protocol.Agent) bool {
	return waveAgentsHaveCommitsWithManifest(repoPath, "", slug, waveNum, agents)
}

// waveAgentsHaveCommitsWithManifest is the cross-repo-aware version.
// When implPath is non-empty, it loads the manifest to resolve per-agent repos.
func waveAgentsHaveCommitsWithManifest(repoPath, implPath, slug string, waveNum int, agents []protocol.Agent) bool {
	if len(agents) == 0 {
		return false
	}

	// Build per-agent repo map from file ownership (cross-repo support).
	agentRepoDir := make(map[string]string) // agent ID -> repo dir
	if implPath != "" {
		if manifest, err := protocol.Load(implPath); err == nil {
			repoParent := filepath.Dir(repoPath)
			for _, agent := range agents {
				for _, fo := range manifest.FileOwnership {
					if fo.Agent == agent.ID && fo.Repo != "" && fo.Repo != filepath.Base(repoPath) {
						agentRepoDir[agent.ID] = filepath.Join(repoParent, fo.Repo)
						break
					}
				}
			}
		}
	}

	for _, agent := range agents {
		// Use agent-specific repo if available, otherwise default
		checkRepo := repoPath
		if r, ok := agentRepoDir[agent.ID]; ok {
			checkRepo = r
		}

		branch := protocol.BranchName(slug, waveNum, agent.ID)
		legacyBranch := protocol.LegacyBranchName(waveNum, agent.ID)

		// Try slug-scoped branch first, then legacy
		activeBranch := ""
		refCheck := exec.Command("git", "-C", checkRepo, "rev-parse", "--verify", branch)
		if refCheck.Run() == nil {
			activeBranch = branch
		} else {
			refCheck2 := exec.Command("git", "-C", checkRepo, "rev-parse", "--verify", legacyBranch)
			if refCheck2.Run() == nil {
				activeBranch = legacyBranch
			} else {
				return false // neither branch exists
			}
		}

		// Check that the branch has at least one commit ahead of HEAD
		countOut, err := exec.Command("git", "-C", checkRepo, "rev-list", "--count", "HEAD.."+activeBranch).Output()
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
