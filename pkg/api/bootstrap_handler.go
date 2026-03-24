package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// bootstrapRunRequest is the JSON body for POST /api/bootstrap/run.
type bootstrapRunRequest struct {
	Description string `json:"description"`
	Repo        string `json:"repo,omitempty"`
}

// bootstrapRunResponse is the JSON body returned by POST /api/bootstrap/run.
type bootstrapRunResponse struct {
	RunID string `json:"run_id"`
}

// validateRepoRequest is the JSON body for POST /api/config/validate-repo.
type validateRepoRequest struct {
	Path string `json:"path"`
}

// validateRepoResponse is the JSON body returned by POST /api/config/validate-repo.
type validateRepoResponse struct {
	Valid     bool   `json:"valid"`
	Error     string `json:"error,omitempty"`
	ErrorCode string `json:"error_code,omitempty"` // "not_found" | "not_git" | "no_commits"
}

// handleBootstrapRun handles POST /api/bootstrap/run.
// Launches the bootstrap scout (architect mode) for a greenfield project.
// Re-uses the same SSE infrastructure as the standard scout — events are
// published under "scout-{runID}" so the frontend can subscribe via
// GET /api/scout/{runID}/events.
func (s *Server) handleBootstrapRun(w http.ResponseWriter, r *http.Request) {
	var req bootstrapRunRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Description == "" {
		http.Error(w, "description is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.scoutRuns.Store(runID, cancel)

	go func() {
		defer s.scoutRuns.Delete(runID)
		defer cancel()
		s.runBootstrapAgent(ctx, runID, req.Description, req.Repo)
	}()

	respondJSON(w, http.StatusAccepted, bootstrapRunResponse{RunID: runID})
}

// runBootstrapAgent is similar to runScoutAgent but:
// - Uses "[BOOTSTRAP] " prefix to distinguish the feature
// - Names the output IMPL-bootstrap.yaml
// - Uses slug "bootstrap" (fixed, not slugified from description)
// Re-uses the publish/onChunk/finalize pattern from runScoutAgent exactly.
func (s *Server) runBootstrapAgent(ctx context.Context, runID, description, repoOverride string) {
	brokerKey := "scout-" + runID

	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	// Resolve repoRoot.
	repoRoot := repoOverride
	if repoRoot == "" {
		repoRoot = s.cfg.RepoPath
	}

	// Bootstrap uses a fixed slug and fixed IMPL output path.
	slug := "bootstrap"
	implOut := filepath.Join(repoRoot, "docs", "IMPL", "IMPL-bootstrap.yaml")

	// Locate SAW repo for prompt files.
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			publish("scout_failed", map[string]string{
				"run_id": runID,
				"error":  "cannot determine home directory: " + err.Error(),
			})
			return
		}
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	// Read config to pick up the configured scout model.
	scoutModel := ""
	if sawCfg := config.LoadOrDefault(repoRoot); sawCfg != nil {
		scoutModel = sawCfg.Agent.ScoutModel
	}

	onChunk := func(chunk string) {
		publish("scout_output", map[string]string{
			"run_id": runID,
			"chunk":  chunk,
		})
	}

	// Inject "[BOOTSTRAP] " prefix so the engine knows this is a design-first
	// architect run. If the engine ever adds explicit bootstrap support this
	// prefix can be replaced with a dedicated flag.
	feature := "[BOOTSTRAP] " + description

	execErr := engine.RunScout(ctx, engine.RunScoutOpts{
		Feature:             feature,
		RepoPath:            repoRoot,
		SAWRepoPath:         sawRepo,
		IMPLOutPath:         implOut,
		ScoutModel:          scoutModel,
		UseStructuredOutput: true,
	}, onChunk)

	if execErr != nil {
		if ctx.Err() != nil {
			publish("scout_cancelled", map[string]string{"run_id": runID})
		} else {
			publish("scout_failed", map[string]string{
				"run_id": runID,
				"error":  execErr.Error(),
			})
			s.notificationBus.Notify(NotificationEvent{
				Type:     NotifyRunFailed,
				Slug:     slug,
				Title:    "Bootstrap Failed",
				Message:  fmt.Sprintf("Bootstrap scout run failed: %s", execErr.Error()),
				Severity: "error",
			})
		}
		return
	}

	// Finalize IMPL doc (M4: populate verification gates)
	publish("scout_finalize", map[string]string{
		"run_id": runID,
		"status": "running",
	})

	finalizeResult, finalizeErr := engine.FinalizeIMPLEngine(ctx, implOut, repoRoot)
	if finalizeErr != nil {
		publish("scout_failed", map[string]string{
			"run_id": runID,
			"error":  "finalize-impl failed: " + finalizeErr.Error(),
		})
		return
	}

	// Finalize warnings are non-fatal — IMPL doc still usable.
	if !finalizeResult.IsSuccess() {
		publish("scout_finalize", map[string]string{
			"run_id":  runID,
			"status":  "warning",
			"message": "Verification gates not fully populated (H2 data unavailable or validation issues)",
		})
	} else {
		publish("scout_finalize", map[string]string{
			"run_id":         runID,
			"status":         "complete",
			"agents_updated": fmt.Sprintf("%d", finalizeResult.GetData().GatePopulation.AgentsUpdated),
		})
	}

	publish("scout_complete", map[string]string{
		"run_id":    runID,
		"slug":      slug,
		"impl_path": implOut,
	})

	// Notify that Bootstrap completed successfully.
	s.notificationBus.Notify(NotificationEvent{
		Type:     NotifyIMPLComplete,
		Slug:     slug,
		Title:    "Bootstrap IMPL Ready",
		Message:  fmt.Sprintf("Bootstrap scout completed: %s", description),
		Severity: "success",
	})
}

// handleValidateRepoPath handles POST /api/config/validate-repo.
// Validates that the provided path is an existing git repository with at least
// one commit. Returns {"valid": true} on success, or {"valid": false,
// "error": "...", "error_code": "not_found|not_git|no_commits"} on failure.
func (s *Server) handleValidateRepoPath(w http.ResponseWriter, r *http.Request) {
	var req validateRepoRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	resp := validatePath(req.Path)
	respondJSON(w, http.StatusOK, resp)
}

// validatePath performs the three-step repo validation checks.
// Extracted for testability.
func validatePath(path string) validateRepoResponse {
	// 1. Check the path exists.
	if _, err := os.Stat(path); err != nil {
		return validateRepoResponse{
			Valid:     false,
			Error:     "Path does not exist",
			ErrorCode: "not_found",
		}
	}

	// 2. Check for .git directory.
	if _, err := os.Stat(filepath.Join(path, ".git")); err != nil {
		return validateRepoResponse{
			Valid:     false,
			Error:     "Not a git repository (run `git init` first)",
			ErrorCode: "not_git",
		}
	}

	// 3. Verify the repo has at least one commit.
	cmd := exec.Command("git", "-C", path, "log", "--oneline", "-1")
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return validateRepoResponse{
			Valid:     false,
			Error:     "Repository has no commits (run `git commit --allow-empty -m 'init'` first)",
			ErrorCode: "no_commits",
		}
	}

	return validateRepoResponse{Valid: true}
}
