package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/gatecache"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// ---------------------------------------------------------------------------
// Pipeline types — these are the canonical definitions from the interface
// contract. Agent A (pipeline_state.go) will also define them; the
// integration agent de-duplicates at merge time.
// ---------------------------------------------------------------------------

// PipelineStep is a discrete step in the post-agent finalization pipeline.
type PipelineStep string

const (
	StepVerifyCommits       PipelineStep = "verify_commits"
	StepScanStubs           PipelineStep = "scan_stubs"
	StepRunGates            PipelineStep = "run_gates"
	StepValidateIntegration PipelineStep = "validate_integration"
	StepMergeAgents         PipelineStep = "merge_agents"
	StepFixGoMod            PipelineStep = "fix_go_mod"
	StepVerifyBuild         PipelineStep = "verify_build"
	StepCleanup             PipelineStep = "cleanup"
)

// PipelineStepOrder is the canonical execution order.
var PipelineStepOrder = []PipelineStep{
	StepVerifyCommits, StepScanStubs, StepRunGates,
	StepValidateIntegration, StepMergeAgents, StepFixGoMod,
	StepVerifyBuild, StepCleanup,
}

// StepStatus represents the status of a single pipeline step.
type StepStatus string

const (
	StepPending  StepStatus = "pending"
	StepRunning  StepStatus = "running"
	StepComplete StepStatus = "complete"
	StepFailed   StepStatus = "failed"
	StepSkipped  StepStatus = "skipped"
)

// StepState is the persisted state of one pipeline step.
type StepState struct {
	Status    StepStatus `json:"status"`
	Error     string     `json:"error,omitempty"`
	Timestamp time.Time  `json:"timestamp"`
}

// PipelineState is the persisted state for a wave's finalization pipeline.
type PipelineState struct {
	Slug      string                    `json:"slug"`
	Wave      int                       `json:"wave"`
	Steps     map[PipelineStep]StepState `json:"steps"`
	UpdatedAt time.Time                 `json:"updated_at"`
}

// pipelineTracker manages per-slug pipeline state. Provides thread-safe
// read/write of step-level status for the finalization pipeline.
type pipelineTracker struct {
	mu     sync.Mutex
	states map[string]*PipelineState // keyed by slug
}

func newPipelineTracker() *pipelineTracker {
	return &pipelineTracker{states: make(map[string]*PipelineState)}
}

func (pt *pipelineTracker) Read(slug string) *PipelineState {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	return pt.states[slug]
}

func (pt *pipelineTracker) Start(slug string, wave int, step PipelineStep) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	state := pt.getOrCreate(slug, wave)
	state.Steps[step] = StepState{Status: StepRunning, Timestamp: time.Now()}
	state.UpdatedAt = time.Now()
}

func (pt *pipelineTracker) Complete(slug string, wave int, step PipelineStep) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	state := pt.getOrCreate(slug, wave)
	state.Steps[step] = StepState{Status: StepComplete, Timestamp: time.Now()}
	state.UpdatedAt = time.Now()
}

func (pt *pipelineTracker) Fail(slug string, wave int, step PipelineStep, errMsg string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	state := pt.getOrCreate(slug, wave)
	state.Steps[step] = StepState{Status: StepFailed, Error: errMsg, Timestamp: time.Now()}
	state.UpdatedAt = time.Now()
}

func (pt *pipelineTracker) Skip(slug string, wave int, step PipelineStep, reason string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	state := pt.getOrCreate(slug, wave)
	state.Steps[step] = StepState{Status: StepSkipped, Error: reason, Timestamp: time.Now()}
	state.UpdatedAt = time.Now()
}

func (pt *pipelineTracker) Clear(slug string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()
	delete(pt.states, slug)
}

func (pt *pipelineTracker) getOrCreate(slug string, wave int) *PipelineState {
	if s, ok := pt.states[slug]; ok {
		return s
	}
	s := &PipelineState{
		Slug:  slug,
		Wave:  wave,
		Steps: make(map[PipelineStep]StepState),
	}
	pt.states[slug] = s
	return s
}

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
	StepCleanup:             true,
}

// skippableSteps are steps that can be skipped via handleStepSkip.
// run_gates is conditionally skippable (only when block_on_failure=false),
// handled separately in the skip handler.
var skippableSteps = map[PipelineStep]bool{
	StepScanStubs:           true,
	StepValidateIntegration: true,
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
			defaultPipelineTracker.Start(slug, wave, step)
		}

		publish("step_retry_started", map[string]interface{}{
			"slug": slug,
			"wave": wave,
			"step": string(step),
		})

		err := executeStep(step, implPath, repoPath, wave)

		if err != nil {
			// Non-fatal steps: log but treat as success.
			if step == StepValidateIntegration || step == StepFixGoMod {
				log.Printf("step %s non-fatal error: %v", step, err)
				if defaultPipelineTracker != nil {
					defaultPipelineTracker.Complete(slug, wave, step)
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
				defaultPipelineTracker.Fail(slug, wave, step, err.Error())
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
			defaultPipelineTracker.Complete(slug, wave, step)
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
		defaultPipelineTracker.Skip(slug, req.Wave, step, req.Reason)
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
