package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// PlannerRunRequest is the JSON body for POST /api/planner/run.
type PlannerRunRequest struct {
	Description string `json:"description"`
	Repo        string `json:"repo,omitempty"`
}

// PlannerRunResponse is the JSON body returned by POST /api/planner/run.
type PlannerRunResponse struct {
	RunID string `json:"run_id"`
}

// plannerSlugify converts a project description to a URL-safe slug.
func plannerSlugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// handlePlannerRun handles POST /api/planner/run.
func (s *Server) handlePlannerRun(w http.ResponseWriter, r *http.Request) {
	var req PlannerRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Description == "" {
		http.Error(w, "description is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.plannerRuns.Store(runID, cancel)

	go func() {
		defer s.plannerRuns.Delete(runID)
		defer cancel()
		s.runPlannerAgent(ctx, runID, req.Description, req.Repo)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(PlannerRunResponse{RunID: runID}) //nolint:errcheck
}

// handlePlannerEvents handles GET /api/planner/{runID}/events.
func (s *Server) handlePlannerEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	brokerKey := "planner-" + runID
	ch := s.broker.subscribe(brokerKey)
	defer s.broker.unsubscribe(brokerKey, ch)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case ev := <-ch:
			data, err := json.Marshal(ev.Data)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handlePlannerCancel handles POST /api/planner/{runID}/cancel.
func (s *Server) handlePlannerCancel(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if v, ok := s.plannerRuns.Load(runID); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// runPlannerAgent executes the Planner agent and publishes SSE events.
func (s *Server) runPlannerAgent(ctx context.Context, runID, description, repoOverride string) {
	brokerKey := "planner-" + runID

	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	repoRoot := repoOverride
	if repoRoot == "" {
		repoRoot = s.cfg.RepoPath
	}

	slug := plannerSlugify(description)
	programOut := filepath.Join(repoRoot, "docs", "PROGRAM-"+slug+".yaml")

	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			publish("planner_failed", map[string]string{
				"run_id": runID,
				"error":  "cannot determine home directory: " + err.Error(),
			})
			return
		}
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	// Read planner model from config.
	plannerModel := ""
	if sawCfg := config.LoadOrDefault(repoRoot); sawCfg != nil {
		plannerModel = sawCfg.Agent.PlannerModel
	}

	onChunk := func(chunk string) {
		publish("planner_output", map[string]string{
			"run_id": runID,
			"chunk":  chunk,
		})
	}

	execErr := engine.RunPlanner(ctx, engine.RunPlannerOpts{
		Description:    description,
		RepoPath:       repoRoot,
		SAWRepoPath:    sawRepo,
		ProgramOutPath: programOut,
		PlannerModel:   plannerModel,
	}, onChunk)

	if execErr != nil {
		if ctx.Err() != nil {
			publish("planner_cancelled", map[string]string{"run_id": runID})
		} else {
			publish("planner_failed", map[string]string{
				"run_id": runID,
				"error":  execErr.Error(),
			})
			s.notificationBus.Notify(NotificationEvent{
				Type:     NotifyRunFailed,
				Slug:     slug,
				Title:    "Planner Failed",
				Message:  fmt.Sprintf("Planner run failed: %s", execErr.Error()),
				Severity: "error",
			})
		}
		return
	}

	publish("planner_complete", map[string]string{
		"run_id":       runID,
		"slug":         slug,
		"program_path": programOut,
	})

	// Refresh programs list for connected clients.
	s.globalBroker.broadcastJSON("program_list_updated", map[string]string{"slug": slug})

	s.notificationBus.Notify(NotificationEvent{
		Type:     NotifyIMPLComplete,
		Slug:     slug,
		Title:    "Program Plan Ready",
		Message:  fmt.Sprintf("Planner completed: %s", description),
		Severity: "success",
	})
}
