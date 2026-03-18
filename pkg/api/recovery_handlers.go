package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/gatecache"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// defaultPipelineTracker is the package-level pipeline tracker instance.
// Set during server init (Wave 2). All handlers nil-check before use.
var defaultPipelineTracker *pipelineTracker

// StepRetryRequest is the JSON body for POST /api/wave/{slug}/step/{step}/retry.
type StepRetryRequest struct {
	Wave int `json:"wave"`
}

// StepSkipRequest is the JSON body for POST /api/wave/{slug}/step/{step}/skip.
type StepSkipRequest struct {
	Wave   int    `json:"wave"`
	Reason string `json:"reason"`
}

// validPipelineSteps maps step name to whether it's a known pipeline step.
var validPipelineSteps = map[PipelineStep]bool{
	StepVerifyCommits:       true,
	StepScanStubs:           true,
	StepRunGates:            true,
	StepValidateIntegration: true,
	StepMergeAgents:         true,
	StepFixGoMod:            true,
	StepVerifyBuild:         true,
	StepIntegrationAgent:    true,
	StepCleanup:             true,
}

// skippableSteps are steps that can be skipped via handleStepSkip.
// run_gates is conditionally skippable (only when block_on_failure=false),
// handled separately in the skip handler.
var skippableSteps = map[PipelineStep]bool{
	StepScanStubs:           true,
	StepValidateIntegration: true,
	StepIntegrationAgent:    true,
	StepCleanup:             true,
	StepFixGoMod:            true,
}

// handleStepRetry handles POST /api/wave/{slug}/step/{step}/retry.
// Retries a specific finalization step independently. Returns 202 Accepted
// and runs the step in a background goroutine, publishing SSE events.
func (s *Server) handleStepRetry(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	step := PipelineStep(r.PathValue("step"))

	// Validate step name.
	if !validPipelineSteps[step] {
		http.Error(w, fmt.Sprintf("unknown pipeline step: %q", step), http.StatusBadRequest)
		return
	}

	var req StepRetryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Wave < 1 {
		http.Error(w, "wave must be >= 1", http.StatusBadRequest)
		return
	}

	// Guard: check BOTH activeRuns (main wave loop) and mergingRuns (concurrent retries).
	if _, loaded := s.activeRuns.Load(slug); loaded {
		http.Error(w, "wave execution in progress for this slug", http.StatusConflict)
		return
	}
	if _, loaded := s.mergingRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "another operation already in progress for this slug", http.StatusConflict)
		return
	}

	implPath, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		s.mergingRuns.Delete(slug)
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}

	publish := s.makePublisher(slug)
	wave := req.Wave

	w.WriteHeader(http.StatusAccepted)

	go func() {
		defer s.mergingRuns.Delete(slug)

		// Update tracker if available.
		if defaultPipelineTracker != nil {
			_ = defaultPipelineTracker.Start(slug, wave, step)
		}

		publish("step_retry_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
			"step": string(step),
		})

		err := executeStep(step, implPath, repoPath, wave)

		if err != nil {
			// Non-fatal steps: log but treat as success.
			if step == StepValidateIntegration || step == StepFixGoMod || step == StepIntegrationAgent {
				log.Printf("step %s non-fatal error: %v", step, err)
				if defaultPipelineTracker != nil {
					_ = defaultPipelineTracker.Complete(slug, wave, step)
				}
				publish("step_retry_complete", map[string]interface{}{
					"slug":    slug,
					"wave":    wave,
					"step":    string(step),
					"warning": err.Error(),
				})
				return
			}

			if defaultPipelineTracker != nil {
				_ = defaultPipelineTracker.Fail(slug, wave, step, err)
			}
			publish("step_retry_failed", map[string]interface{}{
				"slug":  slug,
				"wave":  wave,
				"step":  string(step),
				"error": err.Error(),
			})
			return
		}

		if defaultPipelineTracker != nil {
			_ = defaultPipelineTracker.Complete(slug, wave, step)
		}
		publish("step_retry_complete", map[string]interface{}{
			"slug": slug,
			"wave": wave,
			"step": string(step),
		})
	}()
}

// executeStep runs the appropriate protocol function for a given pipeline step.
func executeStep(step PipelineStep, implPath, repoPath string, wave int) error {
	switch step {
	case StepVerifyCommits:
		_, err := protocol.VerifyCommits(implPath, wave, repoPath)
		return err

	case StepScanStubs:
		manifest, err := protocol.Load(implPath)
		if err != nil {
			return fmt.Errorf("failed to load manifest: %w", err)
		}
		var changedFiles []string
		if wave > 0 && wave <= len(manifest.Waves) {
			for _, agent := range manifest.Waves[wave-1].Agents {
				if report, ok := manifest.CompletionReports[agent.ID]; ok {
					changedFiles = append(changedFiles, report.FilesChanged...)
					changedFiles = append(changedFiles, report.FilesCreated...)
				}
			}
		}
		_, err = protocol.ScanStubs(changedFiles)
		return err

	case StepRunGates:
		manifest, err := protocol.Load(implPath)
		if err != nil {
			return fmt.Errorf("failed to load manifest: %w", err)
		}
		stateDir := filepath.Join(repoPath, ".saw-state")
		cache := gatecache.New(stateDir, 5*time.Minute)
		_, err = protocol.RunGatesWithCache(manifest, wave, repoPath, cache)
		return err

	case StepValidateIntegration:
		manifest, err := protocol.Load(implPath)
		if err != nil {
			return fmt.Errorf("failed to load manifest: %w", err)
		}
		_, err = protocol.ValidateIntegration(manifest, wave, repoPath)
		return err

	case StepMergeAgents:
		_, err := protocol.MergeAgents(implPath, wave, repoPath)
		return err

	case StepFixGoMod:
		_, err := protocol.FixGoModReplacePaths(repoPath)
		return err

	case StepVerifyBuild:
		_, err := protocol.VerifyBuild(implPath, repoPath)
		return err

	case StepIntegrationAgent:
		// Integration agent retry is a no-op in executeStep — it requires
		// model config and an integration report, which aren't available here.
		// Users should use the full finalize retry instead.
		return nil

	case StepCleanup:
		_, err := protocol.Cleanup(implPath, wave, repoPath)
		return err

	default:
		return fmt.Errorf("unhandled step: %s", step)
	}
}

// handleStepSkip handles POST /api/wave/{slug}/step/{step}/skip.
// Marks a finalization step as skipped. Only allowed for non-required steps.
func (s *Server) handleStepSkip(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	step := PipelineStep(r.PathValue("step"))

	// Validate step name.
	if !validPipelineSteps[step] {
		http.Error(w, fmt.Sprintf("unknown pipeline step: %q", step), http.StatusBadRequest)
		return
	}

	var req StepSkipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Wave < 1 {
		http.Error(w, "wave must be >= 1", http.StatusBadRequest)
		return
	}

	// Check if step is skippable.
	if !skippableSteps[step] {
		// run_gates is conditionally skippable -- for now treat as non-skippable
		// unless we add config checking later.
		http.Error(w, fmt.Sprintf("step %q is not skippable", step), http.StatusBadRequest)
		return
	}

	// Update tracker if available.
	if defaultPipelineTracker != nil {
		_ = defaultPipelineTracker.Skip(slug, req.Wave, step)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "skipped",
		"step":   string(step),
		"reason": req.Reason,
	})
}

// handleForceMarkComplete handles POST /api/wave/{slug}/mark-complete.
// Forces the IMPL to be marked complete regardless of pipeline state.
func (s *Server) handleForceMarkComplete(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, repoPath, resolveErr := s.resolveIMPLPath(slug)
	if resolveErr != nil {
		http.Error(w, resolveErr.Error(), http.StatusNotFound)
		return
	}

	err := engine.MarkIMPLComplete(r.Context(), engine.MarkIMPLCompleteOpts{
		IMPLPath: implPath,
		RepoPath: repoPath,
		Date:     time.Now().Format("2006-01-02"),
	})
	if err != nil {
		http.Error(w, "failed to mark complete: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Clear stale pipeline state.
	if defaultPipelineTracker != nil {
		defaultPipelineTracker.Clear(slug)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "complete"})
}

// handlePipelineState handles GET /api/wave/{slug}/pipeline.
// Returns the pipeline state JSON for the given slug.
func (s *Server) handlePipelineState(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	if defaultPipelineTracker == nil {
		http.Error(w, "pipeline tracker not initialized", http.StatusServiceUnavailable)
		return
	}

	state := defaultPipelineTracker.Read(slug)
	if state == nil {
		http.Error(w, "no pipeline state for slug", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// RegisterRecoveryRoutes registers the recovery control endpoints.
// This should be called from server.go's New() function in Wave 2.
func (s *Server) RegisterRecoveryRoutes() {
	s.mux.HandleFunc("POST /api/wave/{slug}/step/{step}/retry", s.handleStepRetry)
	s.mux.HandleFunc("POST /api/wave/{slug}/step/{step}/skip", s.handleStepSkip)
	s.mux.HandleFunc("POST /api/wave/{slug}/mark-complete", s.handleForceMarkComplete)
	s.mux.HandleFunc("GET /api/wave/{slug}/pipeline", s.handlePipelineState)
}
