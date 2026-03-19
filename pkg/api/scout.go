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

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// ScoutRunRequest is the JSON body for POST /api/scout/run.
type ScoutRunRequest struct {
	Feature string `json:"feature"`
	Repo    string `json:"repo,omitempty"`
}

// ScoutRunResponse is the JSON body returned by POST /api/scout/run.
type ScoutRunResponse struct {
	RunID string `json:"run_id"`
}

// scoutSlugify converts a feature description to a URL-safe slug.
// Named distinctly to avoid collision with the slugify function in cmd/saw/commands.go.
func scoutSlugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// handleScoutRun handles POST /api/scout/run.
// Parses the JSON body, generates a unique runID, stores it, launches a
// background goroutine to execute the Scout agent, and returns 202 with
// JSON {"run_id": "<runID>"}.
func (s *Server) handleScoutRun(w http.ResponseWriter, r *http.Request) {
	var req ScoutRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Feature == "" {
		http.Error(w, "feature is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.scoutRuns.Store(runID, cancel)

	go func() {
		defer s.scoutRuns.Delete(runID)
		defer cancel()
		s.runScoutAgent(ctx, runID, req.Feature, req.Repo)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(ScoutRunResponse{RunID: runID}) //nolint:errcheck
}

// handleScoutEvents handles GET /api/scout/{runID}/events.
// Upgrades the connection to SSE and streams scout output events until
// the client disconnects or the scout run completes.
func (s *Server) handleScoutEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	brokerKey := "scout-" + runID
	ch := s.broker.subscribe(brokerKey)
	defer s.broker.unsubscribe(brokerKey, ch)

	for {
		select {
		case ev := <-ch:
			data, err := json.Marshal(ev.Data)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handleScoutCancel handles POST /api/scout/{runID}/cancel.
func (s *Server) handleScoutCancel(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if v, ok := s.scoutRuns.Load(runID); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleScoutRerun handles POST /api/scout/{slug}/rerun.
// Re-runs the Scout agent for an existing slug, reusing the feature title from
// the IMPL manifest (or falling back to the slug itself). Returns 202 with a
// run_id that callers can use to subscribe via GET /api/scout/{runID}/events.
func (s *Server) handleScoutRerun(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Try to load feature title from manifest; fall back to slug.
	feature := slug
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	if data, err := os.ReadFile(implPath); err == nil {
		// Quick extraction: look for "title:" line in YAML front matter.
		for _, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "title:") {
				val := strings.TrimPrefix(trimmed, "title:")
				val = strings.TrimSpace(val)
				val = strings.Trim(val, `"'`)
				if val != "" {
					feature = val
				}
				break
			}
		}
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.scoutRuns.Store(runID, cancel)

	go func() {
		defer s.scoutRuns.Delete(runID)
		defer cancel()
		s.runScoutAgent(ctx, runID, feature, "")
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(ScoutRunResponse{RunID: runID}) //nolint:errcheck
}

// runScoutAgent executes the Scout agent in a background goroutine.
// Publishes scout_output, scout_complete, and scout_failed SSE events.
func (s *Server) runScoutAgent(ctx context.Context, runID, feature, repoOverride string) {
	brokerKey := "scout-" + runID

	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	// Resolve repoRoot.
	repoRoot := repoOverride
	if repoRoot == "" {
		repoRoot = s.cfg.RepoPath
	}

	// Compute slug and IMPL output path.
	slug := scoutSlugify(feature)
	implOut := filepath.Join(repoRoot, "docs", "IMPL", "IMPL-"+slug+".yaml")

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

	// Read saw.config.json to pick up the configured scout model.
	scoutModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(repoRoot, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			scoutModel = sawCfg.Agent.ScoutModel
		}
	}

	onChunk := func(chunk string) {
		publish("scout_output", map[string]string{
			"run_id": runID,
			"chunk":  chunk,
		})
	}

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
				Title:    "Scout Failed",
				Message:  fmt.Sprintf("Scout run failed: %s", execErr.Error()),
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

	// Finalize warnings are non-fatal - IMPL doc still usable
	if !finalizeResult.Success {
		publish("scout_finalize", map[string]string{
			"run_id":  runID,
			"status":  "warning",
			"message": "Verification gates not fully populated (H2 data unavailable or validation issues)",
		})
	} else {
		publish("scout_finalize", map[string]string{
			"run_id":        runID,
			"status":        "complete",
			"agents_updated": fmt.Sprintf("%d", finalizeResult.GatePopulation.AgentsUpdated),
		})
	}

	publish("scout_complete", map[string]string{
		"run_id":    runID,
		"slug":      slug,
		"impl_path": implOut,
	})

	// Notify that Scout completed successfully
	s.notificationBus.Notify(NotificationEvent{
		Type:     NotifyIMPLComplete,
		Slug:     slug,
		Title:    "IMPL Document Ready",
		Message:  fmt.Sprintf("Scout completed: %s", feature),
		Severity: "success",
	})
}
